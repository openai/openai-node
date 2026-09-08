/* oxlint-disable max-classes-per-file -- Request subclasses and SDK hooks exercise separate platform boundaries. */
import OpenAI from 'openai';
import type { Request as ForeignRequestImplementation } from 'undici';
import { test } from 'vitest';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.skipIf(Number(process.versions.node.split('.')[0]) < 24).each(['independent', 'workload'] as const)(
  'uses defining foreign Request headers beneath a named subclass: %s',
  async (credential) => {
    const { Request: ForeignRequest, Headers: ForeignHeaders } = await import('undici');
    let shadowReads = 0;
    let authorization = '';
    const ShadowRequest = class Request extends ForeignRequest {};
    Object.defineProperties(ShadowRequest.prototype, {
      [Symbol.toStringTag]: { value: 'Request' },
      headers: {
        get() {
          shadowReads += 1;
          return new ForeignHeaders({
            Authorization: credential === 'independent' ? authorization : 'Bearer independent',
          });
        },
      },
    });
    const requests: InstanceType<typeof ShadowRequest>[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, controller, context] = args;
        authorization = new Headers(init?.headers).get('Authorization') ?? '';
        const request = new ShadowRequest(String(url), {
          headers: { Authorization: credential === 'independent' ? 'Bearer independent' : authorization },
        });
        requests.push(request);
        return super.fetchWithTimeout(
          request as unknown as RequestInfo,
          undefined,
          timeout,
          controller,
          context,
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      expect(url).toBe(requests[sent.length]);
      if (!(url instanceof ForeignRequest)) {
        throw new Error('Expected the foreign Request from the hook');
      }
      // Constructing the transport request exercises the platform's internal header storage.
      const dispatched = new ForeignRequest(url, init?.headers ? { headers: new Headers(init.headers) } : {});
      sent.push(dispatched.headers.get('Authorization'));
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
    const outcome = await client.models.list().then(
      () => ({ ok: true }),
      (error: unknown) => ({ error }),
    );

    expect(sent).toEqual(
      credential === 'independent'
        ? ['Bearer independent']
        : ['Bearer access-token-1', 'Bearer access-token-2'],
    );
    expect(shadowReads).toBe(0);
    expect(transport.exchanges).toBe(credential === 'independent' ? 1 : 2);
    expect(outcome).toMatchObject(credential === 'independent' ? { error: { status: 401 } } : { ok: true });
  },
);

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
          let headers: Headers = readHeaders.call(url);
          if (realm === 'foreign') {
            expect(init?.headers).toBeInstanceOf(Headers);
            const dispatched = new Headers(init?.headers);
            expect([...dispatched]).toEqual([...headers]);
            headers = dispatched;
          } else {
            expect(init?.headers).toBeUndefined();
          }
          sent.push(headers.get('Authorization'));
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
