import OpenAI, { RateLimitError } from 'openai';
import { vi } from 'vitest';

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
