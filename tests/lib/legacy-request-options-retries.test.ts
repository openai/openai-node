import OpenAI, { InternalServerError, RateLimitError } from 'openai';
import { vi } from 'vitest';

test.each([-1, '-1', '2', 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 2 ** 54, null])(
  'rejects legacy maxRetries=%s before dispatch',
  (maxRetries) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    const client = new OpenAI({ apiKey: 'synthetic', fetch });
    const options = { maxRetries };

    // @ts-expect-error Deliberately exercise invalid values from untyped query data at the public boundary.
    expect(() => client.files.list(options)).toThrow(/maxRetries/u);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each([0, 1, 2])('exhausts a valid legacy retry budget of %s', async (maxRetries) => {
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

  await expect(client.files.list({ maxRetries })).rejects.toThrow(RateLimitError);

  expect(fetch).toHaveBeenCalledTimes(maxRetries + 1);
});

test('accepts the largest safe retry budget without imposing an arbitrary cap', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const client = new OpenAI({ apiKey: 'synthetic', fetch });

  await client.files.list({ maxRetries: Number.MAX_SAFE_INTEGER });

  expect(fetch).toHaveBeenCalledTimes(1);
});

test('validates and consumes the same retry budget snapshot', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(
      { error: { message: 'synthetic unavailable' } },
      {
        status: 503,
        headers: { 'retry-after-ms': '0' },
      },
    ),
  );
  const client = new OpenAI({ apiKey: 'synthetic', fetch });
  let reads = 0;
  const options = {
    get maxRetries() {
      reads += 1;
      return reads === 1 ? 1 : -1;
    },
  };

  await expect(client.files.list(options)).rejects.toThrow(InternalServerError);

  expect(reads).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
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

  // @ts-expect-error Explicit undefined exercises JavaScript callers under exactOptionalPropertyTypes.
  await expect(client.files.list({ ...options, headers: { 'X-Test': 'retry' } })).rejects.toThrow(
    RateLimitError,
  );

  expect(fetch).toHaveBeenCalledTimes(2);
});
