/* oxlint-disable max-classes-per-file -- Each fixture exercises a separate protected request hook. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('normalized request ownership', () => {
  test.each(['accessor', 'data control'] as const)(
    'keeps %s state aligned with replaced headers',
    async (shape) => {
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
          Object.defineProperty(
            request,
            'cache',
            shape === 'accessor'
              ? {
                  configurable: true,
                  enumerable: true,
                  get(this: RequestInit) {
                    return new Headers(this.headers).get('X-Cache');
                  },
                }
              : { value: 'default', writable: true, configurable: true, enumerable: true },
          );
        }
        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          const [, request] = args;
          if (!request) {
            throw new Error('Expected normalized request');
          }
          request.headers = new Headers(request.headers);
          request.headers.set('X-Cache', 'no-store');
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
