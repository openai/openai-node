/* oxlint-disable max-classes-per-file -- Independent fixtures exercise preparation and build ownership. */
import { test } from 'vitest';
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s prepared headers', (realm) => {
  test.skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24).each([false, true])(
    'substitutes a prepared placeholder (frozen request: %s)',
    async (frozen) => {
      const implementation = realm === 'foreign' ? await import('undici') : { Headers };
      class PreparedClient extends OpenAI {
        prepared: RequestInit[] = [];

        protected override async prepareRequest(request: RequestInit) {
          if (!(request.headers instanceof Headers)) {
            throw new Error('Expected native request headers');
          }
          // Genuine foreign Headers are supported despite differing iterator declarations.
          request.headers = new implementation.Headers([...request.headers]) as unknown as Headers;
          request.headers.set('Authorization', 'Bearer workload-identity-auth');
          request.headers.set('X-Custom', 'synthetic-prepared');
          this.prepared.push(request);
          if (frozen) {
            Object.freeze(request);
          }
        }
      }
      const extension = Symbol('caller extension');
      const sent: (string | null)[] = [];
      let cancelled = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const headers = new Headers(init?.headers);
        sent.push(headers.get('Authorization'));
        expect(headers.get('X-Custom')).toBe('synthetic-prepared');
        expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
        expect(Object.getOwnPropertySymbols(init)).toEqual([extension]);
        expect(Object.getOwnPropertyDescriptor(init, extension)?.value).toBe('synthetic-extension');
        return sent.length === 1
          ? new Response(
              new ReadableStream({
                cancel: () => {
                  cancelled += 1;
                },
              }),
              { status: 401 },
            )
          : Response.json({ data: [] });
      });
      const fetchOptions = {
        cache: 'no-store' as const,
        redirect: 'error' as const,
        [extension]: 'synthetic-extension',
      };
      const client = new PreparedClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        fetchOptions,
        maxRetries: 0,
      });

      await client.models.list();

      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
      expect(cancelled).toBe(1);
      expect(client.prepared).toHaveLength(2);
      if (frozen) {
        for (const [index, request] of client.prepared.entries()) {
          expect(Object.isFrozen(request)).toBe(true);
          expect(new Headers(request.headers).get('Authorization')).toBe(`Bearer access-token-${index + 1}`);
        }
      }
    },
  );
});

describe.each([
  ['native', 'frozen'],
  ['foreign', 'mutable'],
  ['foreign', 'frozen'],
  ['foreign', 'getter-only'],
] as const)('%s Headers in a %s build result', (realm, shape) => {
  test.skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)(
    'normalizes without requiring a writable hook result',
    async () => {
      const implementation = realm === 'foreign' ? await import('undici') : { Headers };
      class BuiltClient extends OpenAI {
        results: { request: RequestInit; headers: Headers }[] = [];
        preparations = 0;

        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const built = await super.buildRequest(...args);
          // The hook accepts genuine foreign Headers at runtime despite different iterator declarations.
          const headers = new implementation.Headers([...built.req.headers]) as unknown as Headers;
          const request = { ...built.req, headers };
          if (shape === 'frozen') {
            Object.freeze(request);
          } else if (shape === 'getter-only') {
            Object.defineProperty(request, 'headers', { get: () => headers, enumerable: true });
          }
          this.results.push({ request, headers });
          return { ...built, req: request };
        }

        protected override async prepareRequest(request: RequestInit) {
          this.preparations += 1;
          expect(new Headers(request.headers).get('X-Custom')).toBe('synthetic-built');
        }
      }
      const extension = Symbol('caller extension');
      const sent: (string | null)[] = [];
      let cancelled = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const headers = new Headers(init?.headers);
        sent.push(headers.get('Authorization'));
        expect(headers.get('X-Custom')).toBe('synthetic-built');
        expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
        expect(Object.getOwnPropertySymbols(init)).toEqual([extension]);
        expect(Object.getOwnPropertyDescriptor(init, extension)?.value).toBe('synthetic-extension');
        return sent.length === 1
          ? new Response(
              new ReadableStream({
                cancel: () => {
                  cancelled += 1;
                },
              }),
              { status: 401 },
            )
          : Response.json({ data: [] });
      });
      const fetchOptions = {
        cache: 'no-store' as const,
        redirect: 'error' as const,
        [extension]: 'synthetic-extension',
      };
      const client = new BuiltClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        fetchOptions,
        maxRetries: 0,
      });

      await client.models.list({ headers: { 'X-Custom': 'synthetic-built' } });

      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
      expect(cancelled).toBe(1);
      expect(client.preparations).toBe(2);
      expect(client.results).toHaveLength(2);
      if (shape !== 'mutable') {
        for (const { request, headers } of client.results) {
          expect(request.headers).toBe(headers);
          expect(Object.isFrozen(request)).toBe(shape === 'frozen');
          if (shape === 'getter-only') {
            expect(Object.getOwnPropertyDescriptor(request, 'headers')?.set).toBeUndefined();
          }
        }
      }
    },
  );
});
