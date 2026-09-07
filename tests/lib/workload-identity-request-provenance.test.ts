/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected SDK hooks. */
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { RequestCredentialContext } from 'openai/internal/request-credentials';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { vi } from 'vitest';

const clientOptions = {
  apiKey: null,
  adminAPIKey: null,
  workloadIdentity: {
    identityProviderId: 'test-identity-provider-id',
    serviceAccountId: 'test-service-account-id',
    provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
  },
  organization: 'test-org-id',
  project: 'test-project-id',
  maxRetries: 0,
};

function deferred() {
  let resolveGate!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- Tests control concurrent authentication hook completion.
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return { promise, resolve: resolveGate };
}

function createTransport(reject: (path: string, call: number) => boolean) {
  const requests: { path: string; authorization: string | null }[] = [];
  let exchanges = 0;
  const fetch: Fetch = async (url, init) => {
    const path = new URL(url.toString()).pathname;
    if (path.endsWith('/oauth/token')) {
      exchanges += 1;
      return Response.json({
        access_token: `access-token-${exchanges}`,
        issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    requests.push({ path, authorization: new Headers(init?.headers).get('Authorization') });
    return reject(path, requests.filter((request) => request.path === path).length)
      ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
      : Response.json({ data: [] });
  };
  return {
    fetch,
    requests,
    get exchanges() {
      return exchanges;
    },
  };
}

describe('workload identity request provenance', () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each([false, true])(
    "does not attribute another request's copied-option credential (frozen: %s)",
    async (frozen) => {
      const independentReady = deferred();
      const releaseIndependent = deferred();
      class HookClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          context?: RequestCredentialContext,
        ) {
          if (options.path === '/independent') {
            independentReady.resolve();
            await releaseIndependent.promise;
            return buildHeaders([{ Authorization: 'Bearer access-token-1' }]);
          }
          return super.authHeaders({ ...options }, schemes, context);
        }
      }
      const transport = createTransport((path) => path.endsWith('/independent'));
      vi.stubGlobal('fetch', transport.fetch);
      const client = new HookClient(clientOptions);
      const independent = expect(
        client.request({ method: 'get', path: '/independent' }),
      ).rejects.toMatchObject({ status: 401 });
      await independentReady.promise;
      const options: FinalRequestOptions = { method: 'get', path: '/models' };
      try {
        await client.request(frozen ? Object.freeze(options) : options);
      } finally {
        releaseIndependent.resolve();
      }
      await independent;

      expect(transport.requests.filter((request) => request.path.endsWith('/independent'))).toEqual([
        { path: '/v1/independent', authorization: 'Bearer access-token-1' },
      ]);
      expect(transport.exchanges).toBe(1);
    },
  );

  test('a stalled request does not acquire credentials from subsequent token rotations', async () => {
    const stalledReady = deferred();
    const releaseStalled = deferred();
    const rotations = 12;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        if (args[0].path === '/stalled') {
          stalledReady.resolve();
          await releaseStalled.promise;
          built.req.headers.set('Authorization', `Bearer access-token-${rotations + 1}`);
        }
        return built;
      }
    }
    const transport = createTransport((path, call) => path.endsWith('/stalled') || call % 2 === 1);
    vi.stubGlobal('fetch', transport.fetch);
    const client = new HookClient(clientOptions);
    const stalled = expect(client.request({ method: 'get', path: '/stalled' })).rejects.toMatchObject({
      status: 401,
    });
    await stalledReady.promise;
    try {
      for (let rotation = 0; rotation < rotations; rotation += 1) {
        // oxlint-disable-next-line no-await-in-loop -- Each 401 rotates the token used by the next request.
        await client.models.list();
      }
    } finally {
      releaseStalled.resolve();
    }
    await stalled;

    expect(transport.exchanges).toBe(rotations + 1);
    expect(transport.requests.filter((request) => request.path.endsWith('/stalled'))).toEqual([
      { path: '/v1/stalled', authorization: `Bearer access-token-${rotations + 1}` },
    ]);
  });

  describe.each([false, true])('custom fetch (copied options: %s)', (copyOptions) => {
    test.each([null, '', 'Bearer independent'])(
      'does not refresh after the wrapper replaces Authorization with %j',
      async (authorization) => {
        const transport = createTransport(() => true);
        const customFetch: Fetch = (url, init) => {
          if (url.toString().endsWith('/oauth/token')) {
            return transport.fetch(url, init);
          }
          const forwarded = copyOptions ? { ...init, headers: new Headers(init?.headers) } : init;
          if (!(forwarded?.headers instanceof Headers)) {
            throw new Error('Expected normalized headers');
          }
          if (authorization === null) {
            forwarded.headers.delete('Authorization');
          } else {
            forwarded.headers.set('Authorization', authorization);
          }
          return transport.fetch(url, forwarded);
        };
        const client = new OpenAI({ ...clientOptions, fetch: customFetch });

        await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

        expect(transport.requests).toEqual([{ path: '/v1/models', authorization }]);
        expect(transport.exchanges).toBe(1);
      },
    );
  });
});
