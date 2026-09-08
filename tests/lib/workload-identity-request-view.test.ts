/* oxlint-disable max-classes-per-file -- Each fixture exercises a separate protected request hook. */
import OpenAI from 'openai';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('normalized request ownership', () => {
  test.each(['ignored', 'forwarded', 'unreadable verification'] as const)(
    'passes resolved headers to a custom transport after proxy writes: %s',
    async (write) => {
      const server = createServer((_request, response) => {
        response.setHeader('Authorization', 'Bearer workload-identity-auth');
        response.setHeader('X-Trace', 'preserved');
        response.end('synthetic');
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected loopback address');
        }
        const response = await fetch(`http://127.0.0.1:${address.port}`);
        await response.text();
        const immutable = response.headers;
        expect(() => immutable.set('X-Trace', 'changed')).toThrow(TypeError);
        let definitions = 0;
        let rejectRead = false;
        const transport = createWorkloadIdentityTransport((url, init) => {
          const request = new Request(String(url), init);
          expect(request.headers.get('Authorization')).toBe('Bearer access-token-1');
          expect(request.headers.get('X-Trace')).toBe('preserved');
          return Response.json({ data: [] });
        });
        class HookClient extends OpenAI {
          // oxlint-disable-next-line class-methods-use-this -- This fixture defers authentication to transport.
          protected override bearerAuth() {
            // oxlint-disable-next-line unicorn/no-useless-undefined -- The hook requires Promise<undefined>.
            return Promise.resolve<undefined>(undefined);
          }
          protected override fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
            args[1] = new Proxy(
              { ...args[1], headers: immutable },
              {
                defineProperty(target, key, descriptor) {
                  if (key === 'headers') {
                    definitions += 1;
                    rejectRead = write === 'unreadable verification';
                    if (write !== 'forwarded') {
                      return true;
                    }
                  }
                  return Reflect.defineProperty(target, key, descriptor);
                },
                get(target, key, receiver) {
                  if (key === 'headers' && rejectRead) {
                    rejectRead = false;
                    throw new Error('Synthetic membrane rejects verification');
                  }
                  return Reflect.get(target, key, receiver);
                },
              },
            );
            return super.fetchWithAuth(...args);
          }
          // oxlint-disable-next-line class-methods-use-this -- This hook supplies its own transport.
          override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
            // A custom transport can send directly after fetchWithAuth resolves its credential.
            return transport.fetch(args[0], args[1]);
          }
        }
        await new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          fetch: transport.fetch,
          maxRetries: 0,
        }).models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });
        expect(definitions).toBe(1);
        expect(transport.exchanges).toBe(1);
      } finally {
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test.each(['accessor', 'configurable headers', 'data control'] as const)(
    'keeps %s state aligned with replaced headers',
    async (shape) => {
      let prepared: RequestInit | undefined;
      let dispatched: RequestInit | undefined;
      class HookClient extends OpenAI {
        protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
          await super.prepareRequest(...args);
          const [request] = args;
          const authorization = new Headers(request.headers).get('Authorization');
          if (authorization === null) {
            throw new Error('Expected workload Authorization');
          }
          request.headers = {
            get Authorization() {
              return authorization;
            },
            'X-Cache': 'default',
          };
          if (shape === 'configurable headers') {
            Object.defineProperty(request, 'headers', { writable: false, configurable: true });
          }
          prepared = request;
          Object.defineProperty(
            request,
            'cache',
            shape === 'data control'
              ? { value: 'default', writable: true, configurable: true, enumerable: true }
              : {
                  configurable: true,
                  enumerable: true,
                  get(this: RequestInit) {
                    return new Headers(this.headers).get('X-Cache');
                  },
                },
          );
        }
        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          const [, request] = args;
          if (!request) {
            throw new Error('Expected normalized request');
          }
          const headers = new Headers(request.headers);
          headers.set('X-Cache', 'no-store');
          if (shape === 'configurable headers') {
            Object.defineProperty(request, 'headers', { value: headers });
          } else {
            request.headers = headers;
          }
          dispatched = request;
          if (shape === 'data control') {
            request.cache = 'no-store';
          }
          return super.fetchWithTimeout(...args);
        }
      }
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('X-Cache')).toBe('no-store');
        expect(init?.cache).toBe('no-store');
        return Response.json({ data: [] });
      });
      await new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      }).models.list();
      expect(dispatched).toBe(prepared);
    },
  );

  test.each(['inherited', 'non-enumerable', 'enumerable control'] as const)(
    'preserves a %s custom build method',
    async (shape) => {
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const built = await super.buildRequest(...args);
          const { headers } = built.req;
          built.req.headers = {
            *[Symbol.iterator]() {
              yield* headers;
            },
          } as unknown as Headers;
          if (shape === 'inherited') {
            delete built.req.method;
            Object.setPrototypeOf(built.req, { method: 'PUT' });
          } else {
            Object.defineProperty(built.req, 'method', {
              value: 'PUT',
              enumerable: shape === 'enumerable control',
            });
          }
          return built;
        }
      }
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(init?.method).toBe('PUT');
        return Response.json({ data: [] });
      });
      await new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      }).models.list();
    },
  );

  test.each(['mutable', 'frozen outer', 'frozen headers'] as const)(
    'updates native placeholder headers reused after delegation (%s)',
    async (shape) => {
      class HookClient extends OpenAI {
        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          const [, request] = args;
          request.headers = new Headers(request.headers);
          request.headers.set('Authorization', 'Bearer workload-identity-auth');
          if (shape !== 'mutable') {
            Object.freeze(request);
          }
          if (shape === 'frozen headers') {
            Object.freeze(request.headers);
          }
          await super.fetchWithAuth(...args);
          return super.fetchWithTimeout(args[0], request, args[2], args[3], args[5]);
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      });
      await new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      }).models.list();
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-1']);
    },
  );
});
