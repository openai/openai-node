import { vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError } from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import { sleep } from 'openai/internal/utils/sleep';

vi.mock('openai/internal/utils/sleep', () => ({
  sleep: vi.fn(async () => {}),
}));

const mockedSleep = vi.mocked(sleep);

function fileClient(statuses: (string | undefined)[], onFetch?: () => void) {
  let index = 0;
  const fetch = vi.fn<Fetch>(async () => {
    if (index >= statuses.length) {
      throw new Error('Unexpected extra file retrieval');
    }
    const status = statuses[index];
    index += 1;
    onFetch?.();
    return Response.json({ id: 'file_123', ...(status === undefined ? {} : { status }) });
  });
  return { client: new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch }), fetch };
}

beforeEach(() => {
  mockedSleep.mockReset();
  mockedSleep.mockImplementation(async () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('file processing compatibility', () => {
  test.each(['processed', 'error', 'deleted'])(
    'returns an initially %s file even after maxWait has elapsed',
    async (status) => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const { client, fetch } = fileClient([status], () => {
        now = 1000;
      });
      const retrieve = vi.spyOn(client.files, 'retrieve');

      const file = await client.files.waitForProcessing('file_123', { maxWait: 0 });

      expect(file).toBe(await retrieve.mock.results[0]?.value);
      expect(file).toMatchObject({ id: 'file_123', status });
      expect(retrieve).toHaveBeenCalledWith('file_123');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockedSleep).not.toHaveBeenCalled();
    },
  );

  test.each([
    { interval: undefined, expected: 5000 },
    { interval: 0, expected: 0 },
    { interval: -2, expected: -2 },
    { interval: Number.NaN, expected: Number.NaN },
  ])('preserves pollInterval $interval', async ({ interval, expected }) => {
    const { client, fetch } = fileClient(['uploaded', 'processed']);
    const options = interval === undefined ? {} : { pollInterval: interval };

    await expect(client.files.waitForProcessing('file_123', options)).resolves.toMatchObject({
      status: 'processed',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockedSleep).toHaveBeenCalledTimes(1);
    expect(mockedSleep).toHaveBeenCalledWith(expected);
  });

  test('keeps polling missing and unknown statuses', async () => {
    const { client, fetch } = fileClient([undefined, 'future_status', 'processed']);

    await expect(client.files.waitForProcessing('file_123')).resolves.toMatchObject({ status: 'processed' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(mockedSleep.mock.calls).toEqual([[5000], [5000]]);
  });

  test.each([
    { clockChange: 60_000, elapsed: 50, fails: false },
    { clockChange: -60_000, elapsed: 150, fails: true },
  ])(
    'uses elapsed time when the system clock moves by $clockChange ms',
    async ({ clockChange, elapsed, fails }) => {
      let wallTime = 100_000;
      let monotonicTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
      vi.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
      mockedSleep.mockImplementation(async () => {
        wallTime += clockChange;
        monotonicTime = elapsed;
      });
      const { client, fetch } = fileClient(['uploaded', 'processed']);
      const promise = client.files.waitForProcessing('file_123', { pollInterval: 50, maxWait: 100 });

      await (fails
        ? expect(promise).rejects.toBeInstanceOf(APIConnectionTimeoutError)
        : expect(promise).resolves.toMatchObject({ status: 'processed' }));
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each([
    { maxWait: undefined, elapsed: 1_800_000, fails: false },
    { maxWait: undefined, elapsed: 1_800_001, fails: true },
    { maxWait: 0, elapsed: 0, fails: false },
    { maxWait: 0, elapsed: 1, fails: true },
    { maxWait: 10, elapsed: 10, fails: false },
    { maxWait: 10, elapsed: 11, fails: true },
  ])('checks maxWait $maxWait after retrieval at $elapsed ms', async ({ maxWait, elapsed, fails }) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    mockedSleep.mockImplementation(async () => {
      now = elapsed;
    });
    const { client, fetch } = fileClient(['uploaded', 'processed']);
    const options = { pollInterval: 7, ...(maxWait === undefined ? {} : { maxWait }) };
    const promise = client.files.waitForProcessing('file_123', options);

    if (fails) {
      const failure: unknown = await promise.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(APIConnectionTimeoutError);
      expect(failure).toMatchObject({
        message: `Giving up on waiting for file file_123 to finish processing after ${maxWait ?? 1_800_000} milliseconds.`,
      });
    } else {
      await expect(promise).resolves.toMatchObject({ status: 'processed' });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockedSleep.mock.calls).toEqual([[7]]);
  });

  test.each([1, 2])('preserves a failure from retrieval %s', async (failureOn) => {
    const { client } = fileClient(['uploaded']);
    const originalRetrieve = client.files.retrieve.bind(client.files);
    const failure = new Error('synthetic retrieval failure');
    let count = 0;
    vi.spyOn(client.files, 'retrieve').mockImplementation((...args) => {
      count += 1;
      if (count === failureOn) {
        throw failure;
      }
      return originalRetrieve(...args);
    });

    await expect(client.files.waitForProcessing('file_123')).rejects.toBe(failure);
    expect(count).toBe(failureOn);
    expect(mockedSleep).toHaveBeenCalledTimes(failureOn - 1);
  });
});
