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

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['request', 'defaults', 'shared'] as const).flatMap((source) =>
        [false, true].map((forward) => ({ method, source, forward })),
      ),
    ),
  )(
    'guards copied nested builds immediately after direct parser reads: %j',
    async ({ method, source, forward }) => {
      let rows = [['Authorization', null] as const][Symbol.iterator]();
      const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
      let nested = false;
      const nestedAuthorizations: (string | null)[] = [];
      class HookClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          _schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          credentialContext?: RequestCredentialContext,
        ) {
          if (!nested) {
            nested = true;
            expect(
              buildHeaders([
                source === 'defaults' ? this._options.defaultHeaders : options.headers,
              ]).nulls.has('authorization'),
            ).toBe(true);
            const built = await this.buildRequest({ ...options }, forward ? { credentialContext } : {});
            nestedAuthorizations.push(built.req.headers.get('Authorization'));
          }
          return buildHeaders([{ Authorization: 'Bearer synthetic-hook-credential' }]);
        }
      }
      const transport = createTransport(() => false);
      const client = new HookClient({
        ...clientOptions,
        fetch: transport.fetch,
        ...(source === 'request' ? {} : { defaultHeaders: headers }),
      });
      const options: FinalRequestOptions = {
        method,
        path: '/models',
        ...(method === 'post' ? { body: {} } : {}),
        ...(source === 'defaults' ? {} : { headers }),
      };
      const request = client.request(options);
      if (forward) {
        await request;
        expect(nestedAuthorizations).toEqual([null]);
        expect(transport.requests.map((entry) => entry.authorization)).toEqual([null]);
      } else {
        await expect(request).rejects.toThrow('must forward credentialContext');
        expect(transport.requests).toHaveLength(0);
      }
      expect(transport.exchanges).toBe(0);

      rows = [['Authorization', null] as const][Symbol.iterator]();
      const next = await client.buildRequest({ ...options });
      expect(next.req.headers.get('Authorization')).toBeNull();
    },
  );

  test.each(
    (['request', 'defaults', 'shared'] as const).flatMap((source) =>
      (['omitted', 'forwarded', 'retained'] as const).map((mode) => ({ source, mode })),
    ),
  )('guards direct parser consumption after an await: %j', async ({ source, mode }) => {
    let rows = [['Authorization', null] as const][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    let nested = false;
    class HookClient extends OpenAI {
      protected override async authHeaders(
        options: FinalRequestOptions,
        _schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        credentialContext?: RequestCredentialContext,
      ) {
        if (!nested) {
          nested = true;
          await Promise.resolve();
          const parsed = buildHeaders([
            source === 'defaults' ? this._options.defaultHeaders : options.headers,
          ]);
          expect(parsed.nulls.has('authorization')).toBe(true);
          if (mode === 'retained') {
            if (source !== 'defaults') {
              options.headers = parsed;
            }
            if (source !== 'request') {
              this._options.defaultHeaders = parsed;
            }
          }
          const built = await this.buildRequest(
            { ...options },
            mode === 'omitted' ? {} : { credentialContext },
          );
          expect(built.req.headers.get('Authorization')).toBeNull();
        }
        return buildHeaders([{ Authorization: 'Bearer synthetic-hook-credential' }]);
      }
    }
    const transport = createTransport(() => false);
    const client = new HookClient({
      ...clientOptions,
      fetch: transport.fetch,
      ...(source === 'request' ? {} : { defaultHeaders: headers }),
    });
    const options: FinalRequestOptions = {
      method: 'get',
      path: '/models',
      ...(source === 'defaults' ? {} : { headers }),
    };
    const request = client.request(options);
    if (mode === 'retained') {
      await request;
      expect(transport.requests.map((entry) => entry.authorization)).toEqual([null]);
    } else {
      await expect(request).rejects.toThrow(
        mode === 'omitted' ? 'must forward credentialContext' : 'must retain parsed headers',
      );
      expect(transport.requests).toHaveLength(0);
    }
    expect(transport.exchanges).toBe(0);

    rows = [['Authorization', null] as const][Symbol.iterator]();
    const next = await client.buildRequest({ ...options });
    expect(next.req.headers.get('Authorization')).toBeNull();
  });

  test.each([false, true])(
    'guards a one-shot source parsed with additional header layers (retained: %s)',
    async (retain) => {
      const rows = [['Authorization', null] as const][Symbol.iterator]();
      const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
      let nested = false;
      class HookClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          _schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          credentialContext?: RequestCredentialContext,
        ) {
          if (!nested) {
            nested = true;
            const parsed = buildHeaders([options.headers, { 'X-Extra': 'preserved' }]);
            if (retain) {
              options.headers = parsed;
            }
            const built = await this.buildRequest({ ...options }, retain ? { credentialContext } : {});
            expect(built.req.headers.get('Authorization')).toBeNull();
          }
          return buildHeaders([{ Authorization: 'Bearer synthetic-hook-credential' }]);
        }
      }
      const transport = createTransport(() => false);
      const client = new HookClient({ ...clientOptions, fetch: transport.fetch });
      const request = client.request({ method: 'get', path: '/models', headers });
      if (retain) {
        await request;
        expect(transport.requests.map((entry) => entry.authorization)).toEqual([null]);
      } else {
        await expect(request).rejects.toThrow('must forward credentialContext');
        expect(transport.requests).toHaveLength(0);
      }
      expect(transport.exchanges).toBe(0);
    },
  );

  test.each(
    (['request', 'defaults', 'shared'] as const).flatMap((source) =>
      [false, true].flatMap((forward) =>
        [false, true].map((readInHook) => ({ source, forward, readInHook })),
      ),
    ),
  )(
    'guards copied nested builds after deferred headers materialize: %j',
    async ({ source, forward, readInHook }) => {
      let rows = [['Authorization', null] as const][Symbol.iterator]();
      const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
      class HookClient extends OpenAI {
        private materializing = false;

        protected override async authHeaders(
          options: FinalRequestOptions,
          _schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          credentialContext?: object,
        ) {
          if (!this.materializing) {
            this.materializing = true;
            const settings = credentialContext ? { credentialContext } : {};
            const first = await this.buildRequest(options, settings);
            expect(first.req.headers.get('Authorization')).toBeNull();
            await this.buildRequest({ ...options }, forward ? settings : {});
          } else if (readInHook) {
            buildHeaders([source === 'defaults' ? this._options.defaultHeaders : options.headers]);
          }
          return buildHeaders([{ Authorization: 'Bearer synthetic-hook-credential' }]);
        }
      }
      const transport = createTransport(() => false);
      const client = new HookClient({
        ...clientOptions,
        fetch: transport.fetch,
        ...(source === 'request' ? {} : { defaultHeaders: headers }),
      });
      const options: FinalRequestOptions = {
        method: 'get',
        path: '/models',
        ...(source === 'defaults' ? {} : { headers }),
      };

      const request = client.request(options);
      if (forward) {
        await request;
        expect(transport.requests.map((entry) => entry.authorization)).toEqual([null]);
      } else {
        await expect(request).rejects.toThrow('must forward credentialContext');
        expect(transport.requests).toHaveLength(0);
      }
      expect(transport.exchanges).toBe(0);

      // Disposing either a successful or failed request releases consumed-source ownership.
      rows = [['Authorization', null] as const][Symbol.iterator]();
      const next = await client.buildRequest({ ...options });
      expect(next.req.headers.get('Authorization')).toBeNull();
    },
  );

  test.each([false, true])(
    "does not attribute another request's copied-option credential (frozen: %s)",
    async (frozen) => {
      const independentReady = deferred();
      const releaseIndependent = deferred();
      class HookClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          context?: object,
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

  test.each(['implicit', 'explicit', 'wrapper'] as const)(
    'refreshes through an authentication-preserving %s transport',
    async (mode) => {
      const transport = createTransport((_path, call) => call === 1);
      vi.stubGlobal('fetch', transport.fetch);
      const fetch =
        mode === 'wrapper'
          ? (url: Parameters<Fetch>[0], init: Parameters<Fetch>[1]) => transport.fetch(url, init)
          : globalThis.fetch;
      const client = new OpenAI({ ...clientOptions, ...(mode === 'implicit' ? {} : { fetch }) });

      await client.models.list();

      expect(transport.requests).toEqual([
        { path: '/v1/models', authorization: 'Bearer access-token-1' },
        { path: '/v1/models', authorization: 'Bearer access-token-2' },
      ]);
      expect(transport.exchanges).toBe(2);
    },
  );

  describe.each([false, true])('configured fetch (private header copy: %s)', (copyOptions) => {
    test.each([null, '', 'Bearer independent'])(
      'distinguishes observable and private Authorization mutations to %j',
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
          expect(forwarded.headers === init?.headers).toBe(!copyOptions);
          if (authorization === null) {
            forwarded.headers.delete('Authorization');
          } else {
            forwarded.headers.set('Authorization', authorization);
          }
          return transport.fetch(url, forwarded);
        };
        const client = new OpenAI({ ...clientOptions, fetch: customFetch });

        await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

        // Shared-header mutations are observable when fetch returns; private copies remain unobservable.
        const expected = [{ path: '/v1/models', authorization }];
        if (copyOptions) {
          expected.push({ path: '/v1/models', authorization });
        }
        expect(transport.requests).toEqual(expected);
        expect(transport.exchanges).toBe(copyOptions ? 2 : 1);
      },
    );
  });
});
