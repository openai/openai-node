import OpenAI from 'openai';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(
  [401, 500].flatMap((status) =>
    (['request', 'default'] as const).flatMap((layer) =>
      [false, true].map((body) => ({ status, layer, body })),
    ),
  ),
)(
  'retains aliased one-shot headers after a layer replacement and retry: %j',
  async ({ status, layer, body }) => {
    let reads = 0;
    const iterator = (function* headers() {
      reads += 1;
      yield ['X-Shared', 'preserved'];
    })();
    const shared = { [Symbol.iterator]: () => iterator } as unknown as Headers;
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const result = await super.authHeaders(...args);
        const headers = { 'X-Replacement': 'replacement' };
        if (layer === 'request') {
          args[0].headers = headers;
        } else {
          this._options.defaultHeaders = headers;
        }
        return result;
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Shared')).toBe('preserved');
      expect(headers.get('X-Replacement')).toBe('replacement');
      return calls === 1
        ? Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      defaultHeaders: shared,
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await (body
      ? client.post('/synthetic', { headers: shared, body: { synthetic: true } })
      : client.models.list({ headers: shared }));

    expect(calls).toBe(2);
    expect(reads).toBe(1);
    expect(transport.exchanges).toBe(status === 401 ? 2 : 1);
  },
);
