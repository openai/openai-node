/* oxlint-disable max-classes-per-file -- Independent fixtures exercise ownership and retry selection. */
import OpenAI from 'openai';
import type { HeadersInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['context', 'original', 'discarded'] as const)('%s request ownership', (ownership) => {
  test.each([
    { authorization: undefined, status: 401 },
    { authorization: undefined, status: 500 },
    { authorization: null, status: 500 },
    { authorization: '', status: 500 },
    { authorization: 'Bearer independent', status: 500 },
  ])(
    'retries a custom build that ignores its original header source: %j',
    async ({ authorization, status }) => {
      let reads = 0;
      const headers = {
        get [Symbol.iterator]() {
          reads += 1;
          throw new Error('An ignored header source was read');
        },
      } as unknown as Headers;
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const replacement = authorization === undefined ? {} : { Authorization: authorization };
          if (ownership === 'original') {
            args[0].headers = replacement;
            return super.buildRequest(args[0]);
          }
          return super.buildRequest(
            { ...args[0], headers: replacement },
            ownership === 'context' ? args[1] : {},
          );
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 1,
      });

      const request = client.models.list({ headers });
      if (ownership === 'discarded') {
        await expect(request).rejects.toThrow('forward credentialContext');
        expect(sent).toHaveLength(1);
        expect(reads).toBe(0);
        expect(transport.exchanges).toBe(authorization === undefined ? 1 : 0);
        return;
      }
      await request;

      expect(reads).toBe(0);
      expect(sent).toEqual(
        authorization === undefined
          ? ['Bearer access-token-1', `Bearer access-token-${status === 401 ? 2 : 1}`]
          : [authorization, authorization],
      );
      const expectedExchanges = status === 401 ? 2 : 1;
      expect(transport.exchanges).toBe(authorization === undefined ? expectedExchanges : 0);
    },
  );
});

test.each(['lost context', 'copied default'] as const)(
  'does not dispatch an upgraded retry after %s',
  async (kind) => {
    const rows = [['Authorization', '']][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const source = kind === 'copied default' ? this._options.defaultHeaders : args[0].headers;
        const selected = new Headers(source as HeadersInit);
        return super.buildRequest(
          { ...args[0], headers: selected },
          kind === 'lost context' && args[1]?.retryCount ? {} : args[1],
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      ...(kind === 'copied default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await expect(client.models.list(kind === 'copied default' ? {} : { headers })).rejects.toThrow(
      kind === 'lost context' ? 'forward credentialContext' : 'must retain parsed headers',
    );
    expect(sent).toEqual(['']);
    expect(transport.exchanges).toBe(kind === 'lost context' ? 1 : 0);
  },
);

test.each(['nested', 'default'] as const)(
  'retains the effective retry credential boundary: %s',
  async (kind) => {
    const rows = [['Authorization', 'Bearer independent']][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const retry = args[1]?.retryCount;
        if (retry && kind === 'nested') {
          await super.buildRequest({ ...args[0], headers: { Authorization: 'Bearer nested' } }, args[1]);
        }
        return super.buildRequest(
          { ...args[0], headers: retry ? {} : { Authorization: 'Bearer independent' } },
          args[1],
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      ...(kind === 'default' ? { defaultHeaders: { Authorization: 'Bearer default' } } : {}),
      fetch: transport.fetch,
      maxRetries: 1,
    });
    const request = client.models.list({ headers });
    if (kind === 'nested') {
      await expect(request).rejects.toThrow('must retain parsed headers');
      expect(sent).toEqual(['Bearer independent']);
    } else {
      await request;
      expect(sent).toEqual(['Bearer independent', 'Bearer default']);
    }
    expect(transport.exchanges).toBe(0);
  },
);
