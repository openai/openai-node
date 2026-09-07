import OpenAI from 'openai';
import { vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([100, 200])(
  'captures %s accessor Set-Cookie values with linear header traversal',
  async (count) => {
    const cookies = Array.from({ length: count }, (_, index) => `synthetic-${index}=value; Path=/`);
    const read = vi.fn(() => cookies);
    const headers = {
      get 'Set-Cookie'() {
        return read();
      },
    };
    let visits = 0;
    const { entries } = Headers.prototype;
    const capture = vi
      .spyOn(Headers.prototype, 'entries')
      .mockImplementation(function countEntries(this: Headers) {
        const iterator = entries.call(this);
        const advance = iterator.next.bind(iterator);
        iterator.next = () => {
          const result = advance();
          if (!result.done) {
            visits += 1;
          }
          return result;
        };
        return iterator;
      });
    try {
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).getSetCookie()).toEqual(cookies);
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.post('/synthetic', { body: { synthetic: true }, headers });

      expect(read).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(1);
      expect(visits).toBeLessThanOrEqual(count * 25);
    } finally {
      capture.mockRestore();
    }
  },
);
