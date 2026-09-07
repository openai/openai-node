import OpenAI from 'openai';
import type { Request as ForeignRequestImplementation } from 'undici';
import { test } from 'vitest';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s Request header accessors', (realm) => {
  describe.each(['own', 'inherited'] as const)('%s shadowing accessor', (placement) => {
    test
      .skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)
      .each(['throwing', 'stateful'] as const)(
      'does not evaluate a %s accessor before dispatch',
      async (behavior) => {
        let RequestConstructor: typeof Request | typeof ForeignRequestImplementation = Request;
        if (realm === 'foreign') {
          const { Request: ForeignRequest } = await import('undici');
          RequestConstructor = ForeignRequest;
        }
        const readHeaders = Object.getOwnPropertyDescriptor(RequestConstructor.prototype, 'headers')?.get;
        if (!readHeaders) {
          throw new Error('The Request implementation must expose its platform header getter');
        }
        const requests: Request[] = [];
        let reads = 0;
        class HookClient extends OpenAI {
          override async fetchWithTimeout(
            url: RequestInfo,
            init: RequestInit | undefined,
            timeout: number,
            controller: AbortController,
            context?: object,
          ) {
            const request = new RequestConstructor(url as string, init as never) as unknown as Request;
            const target = placement === 'own' ? request : Object.create(RequestConstructor.prototype);
            Object.defineProperty(target, 'headers', {
              get() {
                reads += 1;
                if (behavior === 'throwing') {
                  throw new Error('Shadowed header accessor must not run');
                }
                return new Headers({ Authorization: `Bearer shadow-${reads}` });
              },
            });
            if (placement === 'inherited') {
              Object.setPrototypeOf(request, target);
            }
            Object.defineProperty(request, Symbol.toStringTag, {
              get() {
                throw new Error('Unrelated tag accessor must not run');
              },
            });
            requests.push(request);
            return super.fetchWithTimeout(request, undefined, timeout, controller, context);
          }
        }
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((url, init) => {
          expect(url).toBe(requests[sent.length]);
          expect(init?.headers).toBeUndefined();
          sent.push((readHeaders.call(url) as Headers).get('Authorization'));
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
        expect(reads).toBe(0);
        expect(transport.exchanges).toBe(2);
      },
    );
  });
});
