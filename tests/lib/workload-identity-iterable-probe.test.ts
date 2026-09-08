import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(['throw', 'change'] as const)(
  'uses one iterable membership observation when a repeated probe would %s',
  async (behavior) => {
    const probes: number[] = [];
    const supplied: NonNullable<RequestInit['headers']>[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected a request');
        }
        const index = probes.push(0) - 1;
        const headers = new Proxy(Object.fromEntries(new Headers(request.headers)), {
          has(target, key) {
            if (key === Symbol.iterator) {
              probes[index] = (probes[index] ?? 0) + 1;
              if (probes[index] !== 1) {
                if (behavior === 'throw') {
                  throw new Error('Iterable membership was checked twice');
                }
                return true;
              }
            }
            return Reflect.has(target, key);
          },
        });
        supplied.push(headers);
        request.headers = headers;
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.headers).toBe(supplied[sent.length]);
      const headers = new Headers(init?.headers);
      sent.push(headers.get('Authorization'));
      expect(headers.get('X-Custom')).toBe('synthetic-preserved');
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers: { 'X-Custom': 'synthetic-preserved' } });

    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(probes).toEqual([1, 1]);
    expect(transport.exchanges).toBe(2);
  },
);
