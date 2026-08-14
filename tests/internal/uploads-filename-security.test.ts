import { vi } from 'vitest';

import { buildHeaders } from 'openai/internal/headers';
import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

async function* chunks(content = 'content') {
  yield content;
}

async function parseMultipart(options: Awaited<ReturnType<typeof multipartFormRequestOptions>>): Promise<FormData> {
  const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
  return new Response(options.body as ReadableStream, {
    headers: { 'content-type': contentType },
  }).formData();
}

function withStatefulBrand<T extends object>(value: T, states: boolean[]): T {
  let checks = 0;
  return new Proxy(value, {
    has(target, key) {
      if (typeof key === 'symbol' && key.description === 'brand.privateStreamingFile') {
        const state = states[checks] ?? states.at(-1) ?? false;
        checks += 1;
        return state;
      }
      return Reflect.has(target, key);
    },
  });
}

describe('streaming multipart filename security', () => {
  test.each([
    ['an empty string', ''],
    ['a boxed string', new Object('upload.txt')],
    ['a plain object', { replace: vi.fn(), toString: vi.fn() }],
    ['a number', 42],
    ['a symbol', Symbol('upload.txt')],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects %s without coercing it', (_, name) => {
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(/file.?name/iu);
    if (name && typeof name === 'object') {
      expect('replace' in name ? name.replace : undefined).not.toHaveBeenCalled();
      expect('toString' in name ? name.toString : undefined).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['empty', ''],
    ['object', { toString: vi.fn() }],
    ['number', 42],
  ] as const)('rejects a filename mutated to an %s value before the first boundary', async (_, name) => {
    const upload = toStreamingFile(chunks('secret bytes'), 'safe.txt');
    Object.defineProperty(upload, 'name', { value: name });

    const options = await multipartFormRequestOptions({ body: { secret: 'metadata', upload } }, fetch);
    const reader = (options.body as ReadableStream<Uint8Array>).getReader();

    await expect(reader.read()).rejects.toThrow(/file.?name/iu);
  });

  test('upgrades a false-first branded async iterable before optional multipart emits bytes', async () => {
    const emitted: Uint8Array[] = [];
    const earlier = new File(['earlier bytes'], 'earlier.txt');
    const readEarlier = vi.spyOn(earlier, 'stream');
    const incidentalIterator = vi.fn(() => chunks('incidental bytes'));
    const upload = toStreamingFile(chunks('authoritative bytes'), 'safe.txt');
    Object.defineProperties(upload, {
      name: { value: { toString: vi.fn() } },
      [Symbol.asyncIterator]: { value: incidentalIterator },
    });
    const hostile = withStatefulBrand(upload, [false, true]);

    const options = await maybeMultipartFormRequestOptions(
      { body: { secret: 'metadata', earlier, upload: hostile } },
      fetch,
    );
    const reader = (options.body as ReadableStream<Uint8Array>).getReader();
    const firstRead = reader.read().then(({ done, value }) => {
      if (!done) emitted.push(value);
    });

    await expect(firstRead).rejects.toThrow(/file.?name/iu);
    expect(emitted).toEqual([]);
    expect(readEarlier).not.toHaveBeenCalled();
    expect(incidentalIterator).not.toHaveBeenCalled();
  });

  test('uses authoritative data after upgrading a false-first branded async iterable', async () => {
    const incidentalIterator = vi.fn(() => chunks('incidental bytes'));
    const upload = toStreamingFile(chunks('authoritative bytes'), 'upload.txt');
    Object.defineProperty(upload, Symbol.asyncIterator, { value: incidentalIterator });
    const hostile = withStatefulBrand(upload, [false, true]);

    const form = await parseMultipart(
      await maybeMultipartFormRequestOptions({ body: { upload: hostile } }, fetch),
    );
    const file = form.get('upload') as File;

    expect(file.name).toBe('upload.txt');
    await expect(file.text()).resolves.toBe('authoritative bytes');
    expect(incidentalIterator).not.toHaveBeenCalled();
  });

  test('snapshots every earlier upload before reading a later filename getter', async () => {
    const namedBlob = Object.assign(new Blob(['blob bytes'], { type: 'text/original' }), {
      name: 'original-blob.txt',
    });
    const streaming = toStreamingFile(chunks('stream bytes'), 'original-stream.txt', {
      type: 'text/original',
    });
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', {
      get() {
        Object.defineProperties(namedBlob, { name: { value: 'changed-blob.txt' } });
        Object.defineProperties(streaming, {
          name: { value: 'changed-stream.txt' },
          data: { value: chunks('changed bytes') },
          type: { value: 'text/changed' },
        });
        return 'later.txt';
      },
    });

    const form = await parseMultipart(
      await multipartFormRequestOptions({ body: { files: [namedBlob, streaming, later] } }, fetch),
    );
    const files = form.getAll('files[]') as File[];

    expect(files.map((file) => file.name)).toEqual([
      'original-blob.txt',
      'original-stream.txt',
      'later.txt',
    ]);
    expect(files.map((file) => file.type)).toEqual(['text/original', 'text/original', '']);
    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'blob bytes',
      'stream bytes',
      'later bytes',
    ]);
  });

  test('captures valid filenames before lazily reading file data', async () => {
    const readChunk = vi.fn();
    async function* trackedChunks() {
      readChunk();
      yield 'stream bytes';
    }

    const getName = vi.fn().mockReturnValueOnce('safe.txt').mockReturnValue({ replace: vi.fn() });
    const upload = toStreamingFile(trackedChunks(), 'original.txt');
    Object.defineProperty(upload, 'name', { get: getName });

    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);
    expect(readChunk).not.toHaveBeenCalled();

    const form = await parseMultipart(options);
    const file = form.get('upload') as File;

    expect(file.name).toBe('safe.txt');
    await expect(file.text()).resolves.toBe('stream bytes');
    expect(getName).toHaveBeenCalledTimes(1);
    expect(readChunk).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['default basename stripping', undefined, 'report.txt'],
    ['logical path preservation', { stripFilenames: false }, 'skill/assets/report.txt'],
  ] as const)('applies %s to streaming filenames', async (_, options, expected) => {
    const form = await parseMultipart(
      await multipartFormRequestOptions(
        { body: { upload: toStreamingFile(chunks(), 'skill\\assets/report.txt') } },
        fetch,
        options,
      ),
    );

    expect((form.get('upload') as File).name).toBe(expected);
  });

  test.each([
    ['quotes', '"', '%22'],
    ['backslashes', '\\', '%5C'],
    ['newlines', '\r\n', '%0D%0A'],
    ['NUL', '\0', '%00'],
    ['DEL', '\u007F', '%7F'],
  ] as const)('escapes %s in field names and filenames', async (_, character, escaped) => {
    const field = `upload${character}field`;
    const options = await multipartFormRequestOptions(
      { body: { [field]: toStreamingFile(chunks('bytes'), `file${character}name.txt`) } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain(`name="upload${escaped}field"; filename="file${escaped}name.txt"`);
    expect(body).not.toContain(character);
  });
});
