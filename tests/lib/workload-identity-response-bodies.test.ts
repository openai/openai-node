/* oxlint-disable max-classes-per-file -- Fixtures distinguish delegated platform responses from independent structural results. */
import OpenAI from 'openai';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s response-body ownership', (realm) => {
  describe.each(['sdk', 'independent'] as const)('%s credential', (credential) => {
    test
      .skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)
      .each(['ordinary', 'own shadow', 'inherited shadow'] as const)(
      'retains attribution through a body wrapper with %s',
      async (placement) => {
        const foreign = realm === 'foreign' ? await import('undici') : undefined;
        const ResponseClass = foreign?.Response ?? Response;
        const readBody = Object.getOwnPropertyDescriptor(ResponseClass.prototype, 'body')?.get;
        if (!readBody) {
          throw new Error('The Response implementation must expose its platform body getter');
        }
        const readPlatformBody = readBody;
        let shadowReads = 0;
        const shadowBody = () => {
          shadowReads += 1;
          throw new Error('Bookkeeping must not evaluate a shadowed body getter');
        };
        const shadow = (response: Response) => {
          if (placement === 'ordinary') {
            return;
          }
          const target = placement === 'own shadow' ? response : Object.create(ResponseClass.prototype);
          Object.defineProperty(target, 'body', { get: shadowBody });
          if (placement === 'inherited shadow') {
            const Response = function Response() {
              return target;
            };
            Object.defineProperty(Response, 'prototype', { value: target });
            Object.defineProperty(target, 'constructor', { value: Response });
            Object.defineProperty(target, Symbol.toStringTag, { value: 'Response' });
            for (const name of ['clone', 'status', 'headers']) {
              const descriptor = Object.getOwnPropertyDescriptor(ResponseClass.prototype, name);
              if (!descriptor) {
                throw new Error(`Missing Response protocol descriptor: ${name}`);
              }
              Object.defineProperty(target, name, descriptor);
            }
            Object.setPrototypeOf(response, target);
          } else {
            Object.defineProperty(target, Symbol.toStringTag, { get: shadowBody });
          }
        };
        class HookClient extends OpenAI {
          override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
            if (credential === 'independent' && args[1]) {
              args[1].headers = { Authorization: 'Bearer independent' };
            }
            const response = await super.fetchWithTimeout(...args);
            const wrapped = new ResponseClass(readPlatformBody.call(response), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }) as Response;
            return wrapped;
          }
        }
        let sends = 0;
        const transport = createWorkloadIdentityTransport(() => {
          sends += 1;
          const response = new ResponseClass(
            JSON.stringify(sends === 1 ? { error: 'synthetic unauthorized' } : { ok: true }),
            { status: sends === 1 ? 401 : 200, headers: { 'Content-Type': 'application/json' } },
          ) as Response;
          shadow(response);
          return response;
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          adminAPIKey: null,
          fetch: transport.fetch,
          maxRetries: 0,
        });

        const response = client.post('/synthetic', { body: { synthetic: true } });
        if (credential === 'sdk') {
          await expect(response).resolves.toEqual({ ok: true });
          expect({ sends, exchanges: transport.exchanges }).toEqual({ sends: 2, exchanges: 2 });
        } else {
          await expect(response).rejects.toMatchObject({ status: 401 });
          expect({ sends, exchanges: transport.exchanges }).toEqual({ sends: 1, exchanges: 1 });
        }
        expect(shadowReads).toBe(0);
      },
    );
  });
});

test('does not inspect accessors on an independently returned structural response', async () => {
  let reads = 0;
  const unexpectedRead = () => {
    reads += 1;
    throw new Error('A structural response must not be inspected as a platform response');
  };
  const prototype = {};
  for (const key of ['body', 'constructor', Symbol.toStringTag]) {
    Object.defineProperty(prototype, key, { get: unexpectedRead });
  }
  const independent = Object.assign(Object.create(prototype), {
    status: 401,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => JSON.stringify({ error: 'independent unauthorized' }),
  }) as Response;
  let sends = 0;
  class IndependentResponseClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const response = await super.fetchWithTimeout(...args);
      await response.body?.cancel();
      return independent;
    }
  }
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return Response.json({ ok: true });
  });
  const client = new IndependentResponseClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { synthetic: true } })).rejects.toMatchObject({
    status: 401,
  });
  expect(reads).toBe(0);
  expect({ sends, exchanges: transport.exchanges }).toEqual({ sends: 1, exchanges: 1 });
});
