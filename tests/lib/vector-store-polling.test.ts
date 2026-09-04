import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import { sleep } from 'openai/internal/utils/sleep';
import type { RequestOptions } from 'openai/internal/request-options';

vi.mock('openai/internal/utils/sleep', () => ({
  sleep: vi.fn(async () => {}),
}));

const mockedSleep = vi.mocked(sleep);

beforeEach(() => {
  mockedSleep.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { name: 'file', id: 'file_123', segment: 'files' },
  { name: 'batch', id: 'batch_123', segment: 'file_batches' },
] as const)('vector store $name polling compatibility', ({ name, id, segment }) => {
  test.each([
    { label: 'zero explicit interval', interval: 0, header: '17', expected: 0 },
    { label: 'zero interval without a server interval', interval: 0, header: '', expected: 0 },
    { label: 'negative explicit interval', interval: -2, header: '17', expected: -2 },
    { label: 'NaN explicit interval', interval: Number.NaN, header: '0x10', expected: 16 },
    { label: 'numeric header prefix', interval: undefined, header: '12ms', expected: 12 },
    { label: 'zero server interval', interval: undefined, header: '0', expected: 0 },
    { label: 'empty server interval', interval: undefined, header: '', expected: 5000 },
  ])('preserves $label and helper-header precedence', async ({ interval, header, expected }) => {
    const requests: { url: string; headers: Headers }[] = [];
    const fetch = vi.fn<Fetch>(async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json(
        { id, status: requests.length === 1 ? 'in_progress' : 'completed' },
        { headers: { 'openai-poll-after-ms': header } },
      );
    });
    const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', fetch });
    const resource = name === 'file' ? client.vectorStores.files : client.vectorStores.fileBatches;
    const headers = {
      'X-Test': 'kept',
      'X-Stainless-Poll-Helper': 'caller',
      'X-Stainless-Custom-Poll-Interval': 'caller',
    };
    const options: RequestOptions & { pollIntervalMs?: number } = { headers };
    if (interval !== undefined) {
      options.pollIntervalMs = interval;
    }
    const originalOptions = { ...options, headers: { ...headers } };

    await expect(resource.poll('vs_123', id, options)).resolves.toMatchObject({ id, status: 'completed' });
    expect(mockedSleep).toHaveBeenCalledTimes(1);
    expect(mockedSleep).toHaveBeenCalledWith(expected);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe(`https://example.com/v1/vector_stores/vs_123/${segment}/${id}`);
      expect(request.headers.get('X-Test')).toBe('kept');
      expect(request.headers.get('OpenAI-Beta')).toBe('assistants=v2');
      expect(request.headers.get('X-Stainless-Poll-Helper')).toBe('true');
      expect(request.headers.get('X-Stainless-Custom-Poll-Interval')).toBe(
        interval === undefined ? 'caller' : String(interval),
      );
    }
    expect(options).toEqual(originalOptions);
  });

  test('retries an unknown status without adding a delay', async () => {
    let count = 0;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async () => {
        count += 1;
        return Response.json({ id, status: count === 1 ? 'future_status' : 'completed' });
      },
    });
    const resource = name === 'file' ? client.vectorStores.files : client.vectorStores.fileBatches;

    await expect(resource.poll('vs_123', id)).resolves.toMatchObject({ id, status: 'completed' });
    expect(count).toBe(2);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  test('stops polling a resource that stays cancelled', async () => {
    let count = 0;
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () => {
        count += 1;
        if (count > 10) {
          throw new Error(`poll re-requested the ${name} after ${count - 1} cancelled responses`);
        }
        return Response.json({ id, status: 'cancelled' });
      },
    });
    const resource = name === 'file' ? client.vectorStores.files : client.vectorStores.fileBatches;

    await expect(resource.poll('vs_123', id)).resolves.toMatchObject({ id, status: 'cancelled' });
    expect(count).toBe(1);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  test('preserves retrieval failures without wrapping them', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const resource = name === 'file' ? client.vectorStores.files : client.vectorStores.fileBatches;
    const failure = new Error('synthetic retrieval failure');
    vi.spyOn(resource, 'retrieve').mockImplementation(() => {
      throw failure;
    });

    await expect(resource.poll('vs_123', id)).rejects.toBe(failure);
    expect(mockedSleep).not.toHaveBeenCalled();
  });
});
