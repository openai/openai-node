import OpenAI, { RateLimitError } from 'openai';
import { vi } from 'vitest';

test.each([0, 1, 2, Number.MAX_SAFE_INTEGER, -1, '-1', 0.5, Number.NaN, Infinity, null])(
  'rejects legacy retry controls (%s) before dispatch',
  (maxRetries) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    const client = new OpenAI({ apiKey: 'synthetic', fetch });
    const options = { maxRetries };

    // @ts-expect-error Retry controls require the explicit request options argument.
    expect(() => client.files.list(options)).toThrow(/explicit request options argument/u);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test('rejects retry controls in reusable legacy options across GET surfaces', () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const client = new OpenAI({ apiKey: 'synthetic', fetch });
  const options: OpenAI.RequestOptions = {
    headers: { 'X-Test': 'retry' },
    maxRetries: Number.MAX_SAFE_INTEGER,
  };

  for (const request of [
    () => client.files.list(options),
    () => client.responses.retrieve('resp_test', options),
    () => client.beta.assistants.list(options),
    () => client.beta.agents.environments.files.list('env_test', options),
  ]) {
    expect(request).toThrow(/explicit request options argument/u);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('rejects legacy retry getters before reading or dispatching', () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const client = new OpenAI({ apiKey: 'synthetic', fetch });
  let reads = 0;
  const options: OpenAI.RequestOptions = {
    headers: { 'X-Test': 'retry' },
    get maxRetries() {
      reads += 1;
      return Number.MAX_SAFE_INTEGER;
    },
  };

  expect(() => client.files.list(options)).toThrow(/explicit request options argument/u);

  expect(reads).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([0, 1, 2])('exhausts an explicit retry budget of %s', async (maxRetries) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(
      { error: { message: 'synthetic rate limit' } },
      {
        status: 429,
        headers: { 'retry-after-ms': '0' },
      },
    ),
  );
  const client = new OpenAI({ apiKey: 'synthetic', fetch });

  await expect(client.files.list({}, { maxRetries })).rejects.toThrow(RateLimitError);

  expect(fetch).toHaveBeenCalledTimes(maxRetries + 1);
});

test('preserves large explicitly configured retry budgets', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const client = new OpenAI({ apiKey: 'synthetic', fetch });

  await client.files.list({}, { maxRetries: Number.MAX_SAFE_INTEGER });

  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([{}, { maxRetries: undefined }])('preserves an omitted legacy retry budget', async (options) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(
      { error: { message: 'synthetic rate limit' } },
      {
        status: 429,
        headers: { 'retry-after-ms': '0' },
      },
    ),
  );
  const client = new OpenAI({ apiKey: 'synthetic', maxRetries: 1, fetch });

  await expect(client.files.list({ ...options, headers: { 'X-Test': 'retry' } })).rejects.toThrow(
    RateLimitError,
  );

  expect(fetch).toHaveBeenCalledTimes(2);
});
