/* oxlint-disable max-classes-per-file -- Independent fixtures exercise genuine and structural collections. */
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

test.each(['', 'Bearer independent'])(
  'guards exhausted Headers-shaped retry inputs: %j',
  async (authorization) => {
    class ForeignHeaders {
      private readonly authorization = authorization;
      private readonly rows = [['Authorization', authorization]][Symbol.iterator]();
      *entries() {
        yield* this.rows;
      }
      get() {
        return this.authorization;
      }
    }
    Object.defineProperty(ForeignHeaders, 'name', { value: 'Headers' });
    Object.defineProperty(ForeignHeaders.prototype, Symbol.toStringTag, { value: 'Headers' });
    Object.defineProperty(ForeignHeaders.prototype, Symbol.iterator, {
      value: ForeignHeaders.prototype.entries,
    });
    class CopyClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        return super.buildRequest(
          { ...args[0], headers: new Headers(args[0].headers as HeadersInit) },
          args[1],
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } });
    });
    const client = new CopyClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await expect(client.models.list({ headers: new ForeignHeaders() as unknown as Headers })).rejects.toThrow(
      'must retain parsed headers',
    );

    expect(sent).toEqual([authorization]);
    expect(transport.exchanges).toBe(0);
  },
);
