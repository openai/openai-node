import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import OpenAI from 'openai';
import { AssistantStream } from 'openai/lib/AssistantStream';
import { sleep } from 'openai/internal/utils/sleep';
import type { NullableHeaders } from 'openai/internal/headers';

vi.mock('openai/internal/utils/sleep', () => ({
  sleep: vi.fn(async () => {}),
}));

const mockedSleep = sleep as MockedFunction<typeof sleep>;

function createClient(): OpenAI {
  return new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' });
}

function withResponse(data: object, headers: Record<string, string> = {}) {
  return {
    withResponse: async () => ({ data, response: new Response(null, { headers }) }),
  } as any;
}

beforeEach(() => {
  mockedSleep.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vector store file helpers', () => {
  test('creates a file and forwards polling options', async () => {
    const files = createClient().vectorStores.files;
    const created = { id: 'file_created', status: 'in_progress' };
    const completed = { id: 'file_created', status: 'completed' };
    const create = vi.spyOn(files, 'create').mockImplementation(() => Promise.resolve(created) as any);
    const poll = vi.spyOn(files, 'poll').mockResolvedValue(completed as any);
    const options = { pollIntervalMs: 12, headers: { 'X-Test': 'yes' } };

    await expect(files.createAndPoll('vs_123', { file_id: 'file_123' }, options)).resolves.toBe(completed);
    expect(create).toHaveBeenCalledWith('vs_123', { file_id: 'file_123' }, options);
    expect(poll).toHaveBeenCalledWith('vs_123', 'file_created', options);
  });

  test.each([
    { name: 'explicit interval', interval: 7, header: '12', expected: 7 },
    { name: 'server-provided interval', interval: undefined, header: '12', expected: 12 },
    { name: 'invalid server interval', interval: undefined, header: 'invalid', expected: 5000 },
    { name: 'default interval', interval: undefined, header: undefined, expected: 5000 },
  ])('polls an in-progress file using the $name', async ({ interval, header, expected }) => {
    const files = createClient().vectorStores.files;
    const completed = { id: 'file_123', status: 'completed' };
    const retrieve = vi
      .spyOn(files, 'retrieve')
      .mockReturnValueOnce(
        withResponse(
          { id: 'file_123', status: 'in_progress' },
          header ? { 'openai-poll-after-ms': header } : {},
        ),
      )
      .mockReturnValueOnce(withResponse(completed));

    await expect(
      files.poll('vs_123', 'file_123', interval ? { pollIntervalMs: interval } : {}),
    ).resolves.toEqual(completed);
    expect(mockedSleep).toHaveBeenCalledWith(expected);

    const headers = (retrieve.mock.calls[0]?.[2]?.headers as NullableHeaders | undefined)?.values;
    expect(headers?.get('X-Stainless-Poll-Helper')).toBe('true');
    expect(headers?.get('X-Stainless-Custom-Poll-Interval')).toBe(interval ? String(interval) : null);
  });

  test.each(['completed', 'failed'] as const)('returns a file in the %s terminal state', async (status) => {
    const files = createClient().vectorStores.files;
    const result = { id: 'file_123', status };
    vi.spyOn(files, 'retrieve').mockReturnValue(withResponse(result));

    await expect(files.poll('vs_123', 'file_123')).resolves.toEqual(result);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  test('uploads a file before attaching it to the vector store', async () => {
    const client = createClient();
    const resource = client.vectorStores.files;
    const file = new File(['contents'], 'sample.txt');
    const uploaded = { id: 'file_uploaded' };
    const attached = { id: 'file_attached', status: 'completed' };
    const upload = vi
      .spyOn(client.files, 'create')
      .mockImplementation(() => Promise.resolve(uploaded) as any);
    const create = vi.spyOn(resource, 'create').mockImplementation(() => Promise.resolve(attached) as any);

    await expect(resource.upload('vs_123', file)).resolves.toBe(attached);
    expect(upload).toHaveBeenCalledWith({ file, purpose: 'assistants' }, undefined);
    expect(create).toHaveBeenCalledWith('vs_123', { file_id: 'file_uploaded' }, undefined);
  });

  test('uploads, attaches, and polls a vector-store file', async () => {
    const files = createClient().vectorStores.files;
    const file = new File(['contents'], 'sample.txt');
    const attached = { id: 'file_attached', status: 'in_progress' };
    const completed = { ...attached, status: 'completed' };
    const options = { pollIntervalMs: 5 };
    const upload = vi.spyOn(files, 'upload').mockResolvedValue(attached as any);
    const poll = vi.spyOn(files, 'poll').mockResolvedValue(completed as any);

    await expect(files.uploadAndPoll('vs_123', file, options)).resolves.toBe(completed);
    expect(upload).toHaveBeenCalledWith('vs_123', file, options);
    expect(poll).toHaveBeenCalledWith('vs_123', 'file_attached', options);
  });
});

describe('vector store file batch helpers', () => {
  test('creates a batch and forwards request options through polling', async () => {
    const batches = createClient().vectorStores.fileBatches;
    const created = { id: 'batch_123', status: 'in_progress' };
    const completed = { ...created, status: 'completed' };
    const create = vi.spyOn(batches, 'create').mockImplementation(() => Promise.resolve(created) as any);
    const poll = vi.spyOn(batches, 'poll').mockResolvedValue(completed as any);
    const options = { pollIntervalMs: 5, headers: { 'X-Test': 'yes' } };

    await expect(batches.createAndPoll('vs_123', { file_ids: ['file_123'] }, options)).resolves.toBe(
      completed,
    );
    expect(create).toHaveBeenCalledWith('vs_123', { file_ids: ['file_123'] }, options);
    expect(poll).toHaveBeenCalledWith('vs_123', 'batch_123', options);
  });

  test.each([
    { name: 'explicit interval', interval: 7, header: '12', expected: 7 },
    { name: 'server interval', interval: undefined, header: '12', expected: 12 },
    { name: 'invalid server interval', interval: undefined, header: 'invalid', expected: 5000 },
  ])('polls in-progress batches with the $name', async ({ interval, header, expected }) => {
    const batches = createClient().vectorStores.fileBatches;
    const completed = { id: 'batch_123', status: 'completed' };
    const retrieve = vi
      .spyOn(batches, 'retrieve')
      .mockReturnValueOnce(
        withResponse({ id: 'batch_123', status: 'in_progress' }, { 'openai-poll-after-ms': header }),
      )
      .mockReturnValueOnce(withResponse(completed));

    await expect(
      batches.poll('vs_123', 'batch_123', interval ? { pollIntervalMs: interval } : {}),
    ).resolves.toEqual(completed);
    expect(mockedSleep).toHaveBeenCalledWith(expected);
    const headers = (retrieve.mock.calls[0]?.[2]?.headers as NullableHeaders | undefined)?.values;
    expect(headers?.get('X-Stainless-Poll-Helper')).toBe('true');
  });

  test.each(['completed', 'failed', 'cancelled'] as const)(
    'returns a %s batch without waiting',
    async (status) => {
      const batches = createClient().vectorStores.fileBatches;
      const result = { id: 'batch_123', status };
      vi.spyOn(batches, 'retrieve').mockReturnValue(withResponse(result));

      await expect(batches.poll('vs_123', 'batch_123')).resolves.toEqual(result);
      expect(mockedSleep).not.toHaveBeenCalled();
    },
  );

  test('rejects an empty batch before uploading any files', async () => {
    const batches = createClient().vectorStores.fileBatches;

    await expect(batches.uploadAndPoll('vs_123', { files: [] })).rejects.toThrow('No `files` provided');
  });

  test('uploads files concurrently, forwards options, and preserves existing identifiers', async () => {
    const client = createClient();
    const batches = client.vectorStores.fileBatches;
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt'), new File(['c'], 'c.txt')];
    let nextIdentifier = 0;
    const upload = vi
      .spyOn(client.files, 'create')
      .mockImplementation((async () => ({ id: `file_${++nextIdentifier}` })) as any);
    const result = { id: 'batch_123', status: 'completed' };
    const createAndPoll = vi.spyOn(batches, 'createAndPoll').mockResolvedValue(result as any);
    const options = { maxConcurrency: 2, pollIntervalMs: 7, headers: { 'X-Test': 'yes' } };

    await expect(batches.uploadAndPoll('vs_123', { files, fileIds: ['existing'] }, options)).resolves.toBe(
      result,
    );
    expect(upload).toHaveBeenCalledTimes(3);

    for (const file of files) {
      expect(upload).toHaveBeenCalledWith({ file, purpose: 'assistants' }, options);
    }

    expect(createAndPoll).toHaveBeenCalledWith(
      'vs_123',
      { file_ids: expect.arrayContaining(['existing', 'file_1', 'file_2', 'file_3']) },
      options,
    );
  });

  test('preserves custom headers throughout batch uploads, creation, and polling', async () => {
    const requests: { pathname: string; headers: Headers }[] = [];
    const completed = {
      id: 'batch_123',
      object: 'vector_store.files_batch',
      created_at: 0,
      vector_store_id: 'vs_123',
      status: 'completed',
      file_counts: { in_progress: 0, completed: 1, failed: 0, cancelled: 0, total: 1 },
    };
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1/',
      fetch: async (url, init) => {
        const pathname = new URL(String(url)).pathname;

        if (pathname.startsWith('/v1/')) {
          requests.push({ pathname, headers: new Headers(init?.headers) });
        }

        return Response.json(pathname === '/v1/files' ? { id: 'file_123' } : completed);
      },
    });

    const result = await client.vectorStores.fileBatches.uploadAndPoll(
      'vs_123',
      { files: [new File(['contents'], 'sample.txt')] },
      { pollIntervalMs: 7, headers: { 'X-Test': 'yes' } },
    );

    expect(result.id).toBe('batch_123');
    expect(requests.map(({ pathname }) => pathname)).toEqual([
      '/v1/files',
      '/v1/vector_stores/vs_123/file_batches',
      '/v1/vector_stores/vs_123/file_batches/batch_123',
    ]);

    for (const request of requests) {
      expect(request.headers.get('X-Test')).toBe('yes');
    }

    expect(requests[2]?.headers.get('X-Stainless-Custom-Poll-Interval')).toBe('7');
  });

  test('propagates upload failures before creating a batch', async () => {
    const client = createClient();
    const batches = client.vectorStores.fileBatches;
    vi.spyOn(client.files, 'create').mockImplementation(
      () => Promise.reject(new Error('upload failed')) as any,
    );
    const createAndPoll = vi.spyOn(batches, 'createAndPoll');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(batches.uploadAndPoll('vs_123', { files: [new File(['a'], 'a.txt')] })).rejects.toThrow(
      '1 promise(s) failed',
    );
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: 'upload failed' }));
    expect(createAndPoll).not.toHaveBeenCalled();
  });
});

describe('assistant run helpers', () => {
  test('creates a run and polls the resulting run identifier', async () => {
    const runs = createClient().beta.threads.runs;
    const run = { id: 'run_123', status: 'queued' };
    const completed = { ...run, status: 'completed' };
    const create = vi.spyOn(runs, 'create').mockImplementation(() => Promise.resolve(run) as any);
    const poll = vi.spyOn(runs, 'poll').mockResolvedValue(completed as any);
    const options = { pollIntervalMs: 3 };

    await expect(runs.createAndPoll('thread_123', { assistant_id: 'assistant_123' }, options)).resolves.toBe(
      completed,
    );
    expect(create).toHaveBeenCalledWith('thread_123', { assistant_id: 'assistant_123' }, options);
    expect(poll).toHaveBeenCalledWith('run_123', { thread_id: 'thread_123' }, options);
  });

  test.each(['queued', 'in_progress', 'cancelling'] as const)(
    'waits while runs are %s and respects server-provided polling intervals',
    async (status) => {
      const runs = createClient().beta.threads.runs;
      const completed = { id: 'run_123', status: 'completed' };
      const retrieve = vi
        .spyOn(runs, 'retrieve')
        .mockReturnValueOnce(withResponse({ id: 'run_123', status }, { 'openai-poll-after-ms': '9' }))
        .mockReturnValueOnce(withResponse(completed));

      await expect(runs.poll('run_123', { thread_id: 'thread_123' })).resolves.toEqual(completed);
      expect(mockedSleep).toHaveBeenCalledWith(9);
      const headers = (retrieve.mock.calls[0]?.[2]?.headers as NullableHeaders | undefined)?.values;
      expect(headers?.get('X-Stainless-Poll-Helper')).toBe('true');
    },
  );

  test.each(['requires_action', 'incomplete', 'cancelled', 'completed', 'failed', 'expired'] as const)(
    'returns runs in the %s terminal state',
    async (status) => {
      const runs = createClient().beta.threads.runs;
      const run = { id: 'run_123', status };
      vi.spyOn(runs, 'retrieve').mockReturnValue(withResponse(run));

      await expect(runs.poll('run_123', { thread_id: 'thread_123' })).resolves.toEqual(run);
      expect(mockedSleep).not.toHaveBeenCalled();
    },
  );

  test('uses explicit and fallback polling intervals', async () => {
    const runs = createClient().beta.threads.runs;
    const completed = { id: 'run_123', status: 'completed' };
    const retrieve = vi.spyOn(runs, 'retrieve');

    retrieve
      .mockReturnValueOnce(
        withResponse({ id: 'run_123', status: 'queued' }, { 'openai-poll-after-ms': '99' }),
      )
      .mockReturnValueOnce(withResponse(completed));
    await runs.poll('run_123', { thread_id: 'thread_123' }, { pollIntervalMs: 4 });
    expect(mockedSleep).toHaveBeenLastCalledWith(4);

    retrieve
      .mockReturnValueOnce(
        withResponse({ id: 'run_123', status: 'queued' }, { 'openai-poll-after-ms': 'invalid' }),
      )
      .mockReturnValueOnce(withResponse(completed));
    await runs.poll('run_123', { thread_id: 'thread_123' });
    expect(mockedSleep).toHaveBeenLastCalledWith(5000);
  });

  test('submits tool outputs before polling the run', async () => {
    const runs = createClient().beta.threads.runs;
    const run = { id: 'run_123', status: 'in_progress' };
    const completed = { ...run, status: 'completed' };
    const params = { thread_id: 'thread_123', tool_outputs: [{ tool_call_id: 'tool_123', output: 'done' }] };
    const submit = vi.spyOn(runs, 'submitToolOutputs').mockImplementation(() => Promise.resolve(run) as any);
    const poll = vi.spyOn(runs, 'poll').mockResolvedValue(completed as any);
    const options = { pollIntervalMs: 3 };

    await expect(runs.submitToolOutputsAndPoll('run_123', params, options)).resolves.toBe(completed);
    expect(submit).toHaveBeenCalledWith('run_123', params, options);
    expect(poll).toHaveBeenCalledWith('run_123', params, options);
  });

  test('routes deprecated and current run streams through the same stream helper', () => {
    const runs = createClient().beta.threads.runs;
    const stream = {} as AssistantStream;
    const createStream = vi.spyOn(AssistantStream, 'createAssistantStream').mockReturnValue(stream);
    const body = { assistant_id: 'assistant_123' };
    const options = { headers: { 'X-Test': 'yes' } };

    expect(runs.createAndStream('thread_123', body, options)).toBe(stream);
    expect(runs.stream('thread_123', body, options)).toBe(stream);
    expect(createStream).toHaveBeenNthCalledWith(1, 'thread_123', runs, body, options);
    expect(createStream).toHaveBeenNthCalledWith(2, 'thread_123', runs, body, options);
  });

  test('creates a streaming tool-output runner', () => {
    const runs = createClient().beta.threads.runs;
    const stream = {} as AssistantStream;
    const createStream = vi.spyOn(AssistantStream, 'createToolAssistantStream').mockReturnValue(stream);
    const params = { thread_id: 'thread_123', tool_outputs: [{ tool_call_id: 'tool_123', output: 'done' }] };

    expect(runs.submitToolOutputsStream('run_123', params)).toBe(stream);
    expect(createStream).toHaveBeenCalledWith('run_123', runs, params, undefined);
  });
});

describe('assistant thread helpers', () => {
  test('creates and runs a thread before polling the returned run', async () => {
    const threads = createClient().beta.threads;
    const run = { id: 'run_123', thread_id: 'thread_123', status: 'queued' };
    const completed = { ...run, status: 'completed' };
    const createAndRun = vi
      .spyOn(threads, 'createAndRun')
      .mockImplementation(() => Promise.resolve(run) as any);
    const poll = vi.spyOn(threads.runs, 'poll').mockResolvedValue(completed as any);
    const body = { assistant_id: 'assistant_123' };
    const options = { pollIntervalMs: 2 };

    await expect(threads.createAndRunPoll(body, options)).resolves.toBe(completed);
    expect(createAndRun).toHaveBeenCalledWith(body, options);
    expect(poll).toHaveBeenCalledWith('run_123', { thread_id: 'thread_123' }, options);
  });

  test('creates a streamed thread and assistant run', () => {
    const threads = createClient().beta.threads;
    const stream = {} as AssistantStream;
    const createStream = vi.spyOn(AssistantStream, 'createThreadAssistantStream').mockReturnValue(stream);
    const body = { assistant_id: 'assistant_123' };
    const options = { headers: { 'X-Test': 'yes' } };

    expect(threads.createAndRunStream(body, options)).toBe(stream);
    expect(createStream).toHaveBeenCalledWith(body, threads, options);
  });
});
