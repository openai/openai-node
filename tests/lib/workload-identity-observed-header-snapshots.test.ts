/* oxlint-disable max-classes-per-file -- The structural collection and client are independent fixtures. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(['record', 'array', 'structural'] as const)(
  'retains an observed independent %s credential through later restoration of SDK bytes',
  async (kind) => {
    let reads = 0;
    let getCalls = 0;
    const StructuralHeaders = class Headers {
      // oxlint-disable-next-line class-methods-use-this -- The diagnostic getter must not participate in serialization.
      get() {
        getCalls += 1;
        throw new Error('Do not attribute an unverified collection through its get method');
      }

      // oxlint-disable-next-line class-methods-use-this -- The structural fixture shares a counted iterator.
      *entries() {
        reads += 1;
        yield ['Authorization', 'Bearer independent'];
      }
    };
    Object.defineProperties(StructuralHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: StructuralHeaders.prototype.entries },
    });
    let supplied: RequestInit['headers'];
    let originalAuthorization = '';
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- The fixture overrides a protected instance hook.
      protected override async prepareRequest(request: RequestInit) {
        originalAuthorization = new Headers(request.headers).get('Authorization') ?? '';
        if (kind === 'record') {
          supplied = { Authorization: 'Bearer independent' };
        } else if (kind === 'array') {
          supplied = [['Authorization', 'Bearer independent']];
        } else {
          supplied = new StructuralHeaders() as unknown as Headers;
        }
        request.headers = supplied;
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected a request');
        }
        if (kind === 'structural') {
          expect(request.headers).not.toBe(supplied);
          expect(request.headers).toBeInstanceOf(Headers);
        } else {
          expect(request.headers).toBe(supplied);
        }
        const headers = new Headers(request.headers);
        headers.set('Authorization', originalAuthorization);
        request.headers = headers;
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual(['Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
    expect(getCalls).toBe(0);
    expect(reads).toBe(kind === 'structural' ? 1 : 0);
  },
);

test.each(['getter', 'iterator'] as const)('preserves an SDK copy through an observed %s', async (kind) => {
  let reads = 0;
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- The fixture overrides a protected instance hook.
    protected override async prepareRequest(request: RequestInit) {
      const authorization = new Headers(request.headers).get('Authorization') ?? '';
      request.headers =
        kind === 'getter'
          ? {
              get Authorization() {
                reads += 1;
                return authorization;
              },
            }
          : ((function* copiedHeaders() {
              reads += 1;
              yield ['Authorization', authorization];
            })() as unknown as Headers);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return sent.length === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list();

  expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
  expect(reads).toBe(2);
  expect(transport.exchanges).toBe(2);
});
