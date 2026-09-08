/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct protected transport hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(['inherited method', 'non-enumerable method', 'one-read headers'] as const)(
  'preserves %s while normalizing a frozen prepared request',
  async (kind) => {
    let reads = 0;
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        const [request] = args;
        const values = new Headers(request.headers);
        // The platform accepts iterable header pairs beyond the narrower DOM HeadersInit declaration.
        const headers = (function* headers() {
          yield* values;
        })() as unknown as NonNullable<RequestInit['headers']>;
        if (kind === 'inherited method') {
          delete request.method;
          Object.setPrototypeOf(request, { method: 'POST' });
          request.headers = headers;
        } else if (kind === 'non-enumerable method') {
          Object.defineProperty(request, 'method', { value: 'POST', enumerable: false });
          request.headers = headers;
        } else {
          Object.defineProperty(request, 'headers', {
            enumerable: true,
            get() {
              reads += 1;
              if (reads > 1) {
                throw new Error('Prepared header getter was consumed twice');
              }
              return headers;
            },
          });
        }
        Object.freeze(request);
        return super.prepareRequest(...args);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.method).toBe(kind === 'one-read headers' ? 'GET' : 'POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });
    await client.models.list();
    expect(transport.exchanges).toBe(1);
    expect(reads).toBe(kind === 'one-read headers' ? 1 : 0);
  },
);

describe.each(['prepareRequest', 'fetchWithAuth'] as const)('%s immutable dispatch input', (hook) => {
  describe.each(['foreign', 'one-shot'] as const)('%s headers', (kind) => {
    test
      .skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)
      .each(
        (['frozen', 'getter-only'] as const).flatMap((shape) =>
          (['workload', 'independent'] as const).map((credential) => ({ shape, credential })),
        ),
      )(
      'normalizes a $shape request with $credential credentials without mutating it',
      async ({ shape, credential }) => {
        const inputs: { request: RequestInit; headers: NonNullable<RequestInit['headers']> }[] = [];
        let iterations = 0;
        const prepare = async (request: RequestInit) => {
          const values = new Headers(request.headers);
          if (credential === 'independent') {
            values.set('Authorization', 'Bearer independent');
          }
          const foreign = kind === 'foreign' ? await import('undici') : undefined;
          const headers = foreign
            ? new foreign.Headers([...values])
            : (function* headers() {
                iterations += 1;
                yield* values;
              })();
          const supplied = headers as NonNullable<RequestInit['headers']>;
          request.headers = supplied;
          if (shape === 'frozen') {
            Object.freeze(request);
          } else {
            Object.defineProperty(request, 'headers', { get: () => supplied });
          }
          inputs.push({ request, headers: supplied });
        };
        class HookClient extends OpenAI {
          protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
            await super.prepareRequest(...args);
            if (hook === 'prepareRequest') {
              await prepare(args[0]);
            }
          }

          protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
            if (hook === 'fetchWithAuth') {
              await prepare(args[1]);
            }
            return super.fetchWithAuth(...args);
          }
        }
        let sends = 0;
        const transport = createWorkloadIdentityTransport((_url, init) => {
          const original = inputs[sends];
          if (!original) {
            throw new Error('Expected the prepared request');
          }
          expect(original.request.headers).toBe(original.headers);
          expect(init?.headers).toBeInstanceOf(Headers);
          expect(init?.headers).not.toBe(original.headers);
          sends += 1;
          expect(new Headers(init?.headers).get('Authorization')).toBe(
            credential === 'workload' ? `Bearer access-token-${sends}` : 'Bearer independent',
          );
          return sends === 1
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
        if (credential === 'workload') {
          await client.models.list();
          expect(sends).toBe(2);
        } else {
          await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
          expect(sends).toBe(1);
        }
        expect(transport.exchanges).toBe(sends);
        if (kind === 'one-shot') {
          expect(iterations).toBe(sends);
        }
      },
    );
  });
});

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
      'preserves trusted collection identity and materializes unverified iterables through workload refresh',
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

        await client.models.list();

        expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
        expect(transport.exchanges).toBe(2);
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
