import OpenAI from 'openai';
import { vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([100, 200])('captures %i stateful Set-Cookie values with linear entry iteration', async (count) => {
  const cookies = Array.from({ length: count }, (_, index) => `synthetic-${index}=value`);
  const read = vi.fn(() => cookies);
  const originalEntries = Headers.prototype.entries;
  let visited = 0;
  const entries = vi.spyOn(Headers.prototype, 'entries').mockImplementation(function entries(this: Headers) {
    const iterator = Reflect.apply(originalEntries, this, []);
    const advance = iterator.next.bind(iterator);
    iterator.next = (...args) => {
      const result = advance(...args);
      if (!result.done) {
        visited += 1;
      }
      return result;
    };
    return iterator;
  });
  const sent: string[][] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).getSetCookie());
    return sent.length === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  try {
    await client.models.list({
      headers: {
        get 'Set-Cookie'() {
          return read();
        },
      },
    });
  } finally {
    entries.mockRestore();
  }

  expect(sent).toEqual([cookies, cookies]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(transport.exchanges).toBe(2);
  expect(visited).toBeLessThan(16 * count);
});
