import { vi } from 'vitest';

import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { Uploadable } from 'openai/uploads';
import type { VectorStoreFileBatch } from 'openai/resources/vector-stores/file-batches';

interface UploadedFile {
  id: string;
}
type UploadPromise = ReturnType<OpenAI['files']['create']>;

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (reason: unknown) => void;
  // oxlint-disable-next-line promise/avoid-new -- Tests control the order in which concurrent uploads settle.
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

function createClient() {
  return new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' });
}

function createFiles(count: number) {
  return Array.from({ length: count }, (_, index) => new File([String(index)], `${index}.txt`));
}

function createControlledUpload(name: string) {
  return { file: new File([name], `${name}.txt`), ...deferred<UploadedFile>() };
}

function mockControlledUploads(client: OpenAI, uploads: ReturnType<typeof createControlledUpload>[]) {
  const pending = new Map<Uploadable, (typeof uploads)[number]>(
    uploads.map((upload) => [upload.file, upload]),
  );
  return vi.spyOn(client.files, 'create').mockImplementation(({ file }) => {
    const upload = pending.get(file);
    if (!upload) {
      throw new Error('Unexpected upload');
    }
    return upload.promise as UploadPromise;
  });
}

const completed = { id: 'batch_123', status: 'completed' } as VectorStoreFileBatch;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vector-store batch upload orchestration', () => {
  test.each([
    { name: 'default', maxConcurrency: undefined, expected: 5 },
    { name: 'null default', maxConcurrency: null, expected: 5 },
    { name: 'configured', maxConcurrency: 2, expected: 2 },
    { name: 'file-count cap', maxConcurrency: Infinity, expected: 6 },
  ])('preserves the $name worker limit', async ({ maxConcurrency, expected }) => {
    const client = createClient();
    const files = createFiles(6);
    const gate = deferred<boolean>();
    let active = 0;
    let peak = 0;
    let nextID = 0;
    const upload = vi.spyOn(client.files, 'create').mockImplementation(() => {
      active += 1;
      peak = Math.max(peak, active);
      nextID += 1;
      const id = `file_${nextID}`;
      return gate.promise.then(() => {
        active -= 1;
        return { id };
      }) as UploadPromise;
    });
    const createAndPoll = vi
      .spyOn(client.vectorStores.fileBatches, 'createAndPoll')
      .mockResolvedValue(completed);
    const options = maxConcurrency === undefined ? undefined : { maxConcurrency: maxConcurrency as number };

    const result = client.vectorStores.fileBatches.uploadAndPoll('vs_123', { files }, options);
    expect(upload).toHaveBeenCalledTimes(expected);
    expect(createAndPoll).not.toHaveBeenCalled();
    gate.resolve(true);

    await expect(result).resolves.toBe(completed);
    expect(upload).toHaveBeenCalledTimes(files.length);
    expect(peak).toBe(expected);
    expect(active).toBe(0);
  });

  test.each([
    { name: 'zero with existing IDs', limit: 0, fileIds: ['existing'] },
    { name: 'negative zero with existing IDs', limit: -0, fileIds: ['existing'] },
    { name: 'zero without existing IDs', limit: 0, fileIds: undefined },
  ])('rejects $name before any request', async ({ limit, fileIds }) => {
    const fetch = vi.fn<Fetch>(async () => Response.json(completed));
    const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', fetch });
    const originalFileIds = fileIds === undefined ? undefined : [...fileIds];
    const options = { maxConcurrency: limit };

    const result = client.vectorStores.fileBatches.uploadAndPoll(
      'vs_123',
      { files: createFiles(1), ...(fileIds === undefined ? {} : { fileIds }) },
      options,
    );

    await expect(result).rejects.toBeInstanceOf(RangeError);
    await expect(result).rejects.toThrow('maxConcurrency must be greater than 0');
    expect(fetch).not.toHaveBeenCalled();
    expect(fileIds).toEqual(originalFileIds);
  });

  test.each([-1, Number.NaN, 1.5, Number.NEGATIVE_INFINITY])(
    'preserves the invalid array-length error for concurrency %s',
    async (limit) => {
      const client = createClient();
      const upload = vi.spyOn(client.files, 'create');
      const createAndPoll = vi.spyOn(client.vectorStores.fileBatches, 'createAndPoll');

      const result = client.vectorStores.fileBatches.uploadAndPoll(
        'vs_123',
        { files: createFiles(3) },
        { maxConcurrency: limit },
      );
      await expect(result).rejects.toBeInstanceOf(RangeError);
      await expect(result).rejects.toThrow('Invalid array length');
      expect(upload).not.toHaveBeenCalled();
      expect(createAndPoll).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, null, []])('rejects missing uploads even with existing IDs: %s', async (files) => {
    const client = createClient();
    const upload = vi.spyOn(client.files, 'create');
    const createAndPoll = vi.spyOn(client.vectorStores.fileBatches, 'createAndPoll');

    await expect(
      client.vectorStores.fileBatches.uploadAndPoll('vs_123', {
        files: files as unknown as Uploadable[],
        fileIds: ['existing'],
      }),
    ).rejects.toThrow(
      "No `files` provided to process. If you've already uploaded files you should use `.createAndPoll()` instead",
    );
    expect(upload).not.toHaveBeenCalled();
    expect(createAndPoll).not.toHaveBeenCalled();
  });

  test('keeps completion-order IDs and forwards the original files and options', async () => {
    const client = createClient();
    const first = createControlledUpload('first');
    const second = createControlledUpload('second');
    const third = createControlledUpload('third');
    const uploads = [first, second, third];
    const files = uploads.map(({ file }) => file);
    const upload = mockControlledUploads(client, uploads);
    const createAndPoll = vi
      .spyOn(client.vectorStores.fileBatches, 'createAndPoll')
      .mockResolvedValue(completed);
    const fileIds = ['existing'];
    const options = { maxConcurrency: 2, pollIntervalMs: 7, headers: { 'X-Test': 'yes' } };

    const result = client.vectorStores.fileBatches.uploadAndPoll('vs_123', { files, fileIds }, options);
    fileIds.push('added-later');
    expect(upload).toHaveBeenCalledTimes(2);
    second.resolve({ id: 'second' });
    await Promise.resolve();
    expect(upload).toHaveBeenCalledTimes(3);
    third.resolve({ id: 'third' });
    await Promise.resolve();
    first.resolve({ id: 'first' });

    await expect(result).resolves.toBe(completed);
    expect(createAndPoll).toHaveBeenCalledWith(
      'vs_123',
      { file_ids: ['existing', 'second', 'third', 'first'] },
      options,
    );
    expect(fileIds).toEqual(['existing', 'added-later']);
    for (const [index, [body, uploadOptions]] of upload.mock.calls.entries()) {
      expect(body.file).toBe(files[index]);
      expect(body.purpose).toBe('assistants');
      expect(uploadOptions).toBe(options);
    }
    expect(createAndPoll.mock.calls[0]?.[2]).toBe(options);
  });

  test('waits for every worker and retains private errors in worker order', async () => {
    const client = createClient();
    const first = createControlledUpload('first');
    const second = createControlledUpload('second');
    const third = createControlledUpload('third');
    const fourth = createControlledUpload('fourth');
    const uploads = [first, second, third, fourth];
    const files = uploads.map(({ file }) => file);
    const upload = mockControlledUploads(client, uploads);
    const createAndPoll = vi.spyOn(client.vectorStores.fileBatches, 'createAndPoll');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstWorkerError = new Error('first worker');
    const secondWorkerError = new Error('second worker');
    let settled = false;
    const result = client.vectorStores.fileBatches.uploadAndPoll('vs_123', { files }, { maxConcurrency: 2 });
    async function getOutcome() {
      try {
        return await result;
      } catch (error) {
        settled = true;
        return error;
      }
    }
    const outcome = getOutcome();

    second.reject(secondWorkerError);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(upload).toHaveBeenCalledTimes(2);
    first.resolve({ id: 'first' });
    await Promise.resolve();
    expect(upload).toHaveBeenCalledTimes(3);
    third.reject(firstWorkerError);

    const error = await outcome;
    expect(error).toMatchObject({
      message: '2 promise(s) failed',
      rejections: [firstWorkerError, secondWorkerError],
    });
    expect(Object.getOwnPropertyDescriptor(error, 'rejections')?.enumerable).toBe(false);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(createAndPoll).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  test('propagates the batch creation error unchanged', async () => {
    const client = createClient();
    vi.spyOn(client.files, 'create').mockReturnValue(Promise.resolve({ id: 'file_123' }) as UploadPromise);
    const error = new Error('batch creation failed');
    vi.spyOn(client.vectorStores.fileBatches, 'createAndPoll').mockRejectedValue(error);

    await expect(
      client.vectorStores.fileBatches.uploadAndPoll('vs_123', { files: createFiles(1) }),
    ).rejects.toBe(error);
  });
});
