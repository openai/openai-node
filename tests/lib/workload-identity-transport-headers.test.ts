/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct protected transport hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test('materializes a self-deleting header getter before transport dispatch', async () => {
  let reads = 0;
  class HookClient extends OpenAI {
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, 'Authorization', {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1;
          delete headers['Authorization'];
          return 'Bearer independent';
        },
      });
      args[1].headers = headers;
      return super.fetchWithAuth(...args);
    }
  }
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
  expect(reads).toBe(1);
  expect(calls).toBe(1);
  expect(transport.exchanges).toBe(1);
});

describe.each(['prepareRequest', 'fetchWithTimeout'] as const)('%s header identity', (hook) => {
  describe.each(['record', 'array', 'native', 'foreign'] as const)('%s', (kind) => {
    test.skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)(
      'keeps preparation replacements independent and preserves transport collection identity',
      async () => {
        const supplied: NonNullable<RequestInit['headers']>[] = [];
        const retainHeaders = async (request: RequestInit) => {
          const values = new Headers(request.headers);
          let headers: NonNullable<RequestInit['headers']>;
          if (kind === 'foreign') {
            const { Headers: ForeignHeaders } = await import('undici');
            headers = new ForeignHeaders([...values]) as unknown as Headers;
          } else if (kind === 'native') {
            headers = values;
          } else {
            headers = kind === 'record' ? Object.fromEntries(values) : [...values];
          }
          if (kind === 'native' || kind === 'foreign') {
            Object.defineProperty(headers, 'get', {
              get() {
                throw new Error('Shadowed get must not run');
              },
            });
          }
          Object.defineProperty(headers, 'transportMetadata', { value: 'synthetic-extension' });
          supplied.push(headers);
          request.headers = headers;
        };
        class HookClient extends OpenAI {
          protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
            await super.prepareRequest(...args);
            if (hook === 'prepareRequest') {
              await retainHeaders(args[0]);
            }
          }

          override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
            if (hook === 'fetchWithTimeout' && args[1]) {
              await retainHeaders(args[1]);
            }
            return super.fetchWithTimeout(...args);
          }
        }
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          if (kind === 'foreign') {
            expect(init?.headers).not.toBe(supplied[sent.length]);
            expect(init?.headers).toBeInstanceOf(Headers);
          } else {
            expect(init?.headers).toBe(supplied[sent.length]);
            expect(Object.getOwnPropertyDescriptor(init?.headers, 'transportMetadata')?.value).toBe(
              'synthetic-extension',
            );
          }
          sent.push(new Headers(init?.headers).get('Authorization'));
          return sent.length === 1
            ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          adminAPIKey: null,
          maxRetries: 0,
          fetch: transport.fetch,
        });

        const request = client.models.list();
        await (hook === 'prepareRequest' ? expect(request).rejects.toMatchObject({ status: 401 }) : request);

        expect(sent).toEqual(
          hook === 'prepareRequest'
            ? ['Bearer access-token-1']
            : ['Bearer access-token-1', 'Bearer access-token-2'],
        );
        expect(transport.exchanges).toBe(hook === 'prepareRequest' ? 1 : 2);
      },
    );
  });
});

test.each(['iterator', 'getter'] as const)(
  'materializes a stateful %s exactly once before fetch',
  async (kind) => {
    let reads = 0;
    const supplied: NonNullable<RequestInit['headers']>[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected a request');
        }
        const authorization = new Headers(request.headers).get('Authorization');
        if (authorization === null) {
          throw new Error('Expected workload authorization');
        }
        const headers =
          kind === 'iterator'
            ? (function* oneShotHeaders() {
                reads += 1;
                yield ['Authorization', authorization];
              })()
            : {
                get Authorization() {
                  reads += 1;
                  return authorization;
                },
              };
        request.headers = headers as NonNullable<RequestInit['headers']>;
        supplied.push(headers as NonNullable<RequestInit['headers']>);
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.headers).not.toBe(supplied[sent.length]);
      expect(init?.headers).toBeInstanceOf(Headers);
      expect(reads).toBe(sent.length + 1);
      sent.push(new Headers(init?.headers).get('Authorization'));
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

    await client.models.list();

    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(reads).toBe(2);
  },
);

test('does not inspect or replace headers when workload attribution is unnecessary', async () => {
  let reads = 0;
  const headers = {
    get Authorization() {
      reads += 1;
      return 'Bearer independent';
    },
  };
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (args[1]) {
        args[1].headers = headers;
      }
      return super.fetchWithTimeout(...args);
    }
  }
  const client = new HookClient({
    apiKey: 'synthetic-static-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      expect(init?.headers).toBe(headers);
      expect(reads).toBe(0);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    },
  });

  await client.models.list();

  expect(reads).toBe(1);
});
