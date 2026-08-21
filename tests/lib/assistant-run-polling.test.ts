import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { RequestOptions } from 'openai/internal/request-options';
import { sleep } from 'openai/internal/utils/sleep';

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

describe('assistant run polling compatibility', () => {
  test.each([
    { label: 'zero explicit interval', interval: 0, header: '17', expected: 17 },
    { label: 'negative explicit interval', interval: -2, header: '17', expected: -2 },
    { label: 'NaN explicit interval', interval: Number.NaN, header: '0x10', expected: 16 },
    { label: 'numeric header prefix', interval: undefined, header: '12ms', expected: 12 },
    { label: 'zero server interval', interval: undefined, header: '0', expected: 0 },
    { label: 'empty server interval', interval: undefined, header: '', expected: 5000 },
  ])('preserves $label and the existing header merge', async ({ interval, header, expected }) => {
    const requests: { url: string; headers: Headers }[] = [];
    const fetch = vi.fn<Fetch>(async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json(
        { id: 'run_123', status: requests.length === 1 ? 'queued' : 'completed' },
        { headers: { 'openai-poll-after-ms': header } },
      );
    });
    const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', fetch });
    const { runs } = client.beta.threads;
    const retrieve = vi.spyOn(runs, 'retrieve');
    const params = { thread_id: 'thread_123' };
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

    const result = await runs.poll('run_123', params, options);

    expect(result).toBe(await retrieve.mock.results[1]?.value);
    expect(result).toMatchObject({ id: 'run_123', status: 'completed' });
    expect(mockedSleep).toHaveBeenCalledTimes(1);
    expect(mockedSleep).toHaveBeenCalledWith(expected);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe('https://example.com/v1/threads/thread_123/runs/run_123');
      expect(request.headers.get('X-Test')).toBe('kept');
      expect(request.headers.get('OpenAI-Beta')).toBe('assistants=v2');
      expect(request.headers.get('X-Stainless-Poll-Helper')).toBe('true');
      expect(request.headers.get('X-Stainless-Custom-Poll-Interval')).toBe(
        interval === undefined ? 'caller' : String(interval),
      );
    }
    for (const call of retrieve.mock.calls) {
      expect(call[1]).toBe(params);
      expect(call[2]?.headers).toMatchObject({ 'X-Test': 'kept' });
    }
    const firstHeaders = retrieve.mock.calls[0]?.[2]?.headers as NullableHeaders;
    const secondHeaders = retrieve.mock.calls[1]?.[2]?.headers as NullableHeaders;
    expect(firstHeaders).not.toBe(secondHeaders);
    expect(firstHeaders.values).toBe(secondHeaders.values);
    expect(firstHeaders.nulls).toBe(secondHeaders.nulls);
    expect(options).toEqual(originalOptions);
  });

  test('retries unknown statuses without adding a delay', async () => {
    let count = 0;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async () => {
        count += 1;
        return Response.json({ id: 'run_123', status: count === 1 ? 'future_status' : 'completed' });
      },
    });

    await expect(
      client.beta.threads.runs.poll('run_123', { thread_id: 'thread_123' }),
    ).resolves.toMatchObject({
      status: 'completed',
    });
    expect(count).toBe(2);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  test('preserves retrieval failures without wrapping them', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const failure = new Error('synthetic retrieval failure');
    vi.spyOn(client.beta.threads.runs, 'retrieve').mockImplementation(() => {
      throw failure;
    });

    await expect(client.beta.threads.runs.poll('run_123', { thread_id: 'thread_123' })).rejects.toBe(failure);
    expect(mockedSleep).not.toHaveBeenCalled();
  });
});
