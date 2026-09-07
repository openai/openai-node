import OpenAI from 'openai';
import type { HeadersInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s copied header inputs', (realm) => {
  const testRealm =
    realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24 ? test.skip : test;
  testRealm.each(['', 'Bearer independent'])(
    'retries an independently authenticated request: %j',
    async (authorization) => {
      const undici = realm === 'foreign' ? await import('undici') : undefined;
      const HeadersConstructor = undici?.Headers ?? Headers;
      const headers = new HeadersConstructor({ Authorization: authorization });
      class CopyClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          return super.buildRequest(
            { ...args[0], headers: new Headers(args[0].headers as HeadersInit) },
            args[1],
          );
        }
      }
      let calls = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
        return calls === 1
          ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
          : Response.json({ data: [] });
      });
      const client = new CopyClient({
        ...createTestClientOptions(),
        apiKey: null,
        fetch: transport.fetch,
        maxRetries: 1,
      });

      await client.models.list({ headers: headers as unknown as Headers });
      expect(calls).toBe(2);
      expect(transport.exchanges).toBe(0);
    },
  );
});
