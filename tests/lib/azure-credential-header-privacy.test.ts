import { vi } from 'vitest';

import { APIConnectionError, AzureOpenAI, OpenAIError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildAzureAuthenticationHeaders, buildHeaders } from 'openai/internal/headers';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

type Authentication = 'static-api-key' | 'rotating-entra-token';
type PublicRoute = 'generic-request' | 'models-list' | 'chat-completion';
type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;
type CarrierAuthenticationScheme = 'auth' | 'bearer' | 'admin';

class ProtectedHookAzure extends AzureOpenAI {
  injectedHeaders: Record<string, string> | undefined;
  bearerCalls = 0;
  adminCalls = 0;
  fetchFailures = 0;
  mutation: 'auth' | 'auth-null' | 'bearer' | 'admin' | undefined;
  mutationScheme: CarrierAuthenticationScheme = 'auth';
  mutateCarrier: ((headers: Headers) => void) | undefined;
  inspectAuthenticationCarrier: ((carrier: NullableHeaders) => void) | undefined;

  protected override async prepareRequest(request: RequestInit): Promise<void> {
    if (this.injectedHeaders) {
      request.headers = this.injectedHeaders;
    }
  }

  protected override fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    return super
      .fetchWithAuth(url, init, timeout, controller, schemes)
      .catch(this.recordFetchFailure.bind(this));
  }

  private recordFetchFailure(error: unknown): never {
    this.fetchFailures += 1;
    throw error;
  }

  invokeProtectedFetch(headers: Record<string, string>): Promise<Response> {
    return this.fetchWithAuth(
      'https://azure-resource.example.com/openai/models',
      { headers },
      1000,
      new AbortController(),
    );
  }

  inspectDeferredDefaultHeaders(defaults: Record<string, string>, inspect: (headers: Headers) => void): void {
    const carrier = buildAzureAuthenticationHeaders(defaults);
    this._options.defaultHeaders = carrier;
    inspect(carrier.values);
  }

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    const carrier = await super.authHeaders(options, schemes);
    if (this.mutation === 'auth') {
      carrier?.values.set('API-KEY', 'mutated-static-token');
    } else if (this.mutation === 'auth-null') {
      carrier?.nulls.add('api-key');
    }
    if (carrier && this.mutationScheme === 'auth') {
      this.mutateCarrier?.(carrier.values);
      this.inspectAuthenticationCarrier?.(carrier);
    }
    return carrier;
  }

  protected override async bearerAuth(options: FinalRequestOptions): Promise<NullableHeaders> {
    this.bearerCalls += 1;
    if (this.mutation === 'bearer' || (this.mutationScheme === 'bearer' && this.mutateCarrier)) {
      const carrier = await super.bearerAuth(options);
      if (!carrier) {
        throw new Error('Expected a deferred bearer authentication carrier.');
      }
      if (this.mutation === 'bearer') {
        carrier.values.set('AUTHORIZATION', 'Bearer mutated-bearer-token');
      } else {
        this.mutateCarrier?.(carrier.values);
      }
      return carrier;
    }
    return buildHeaders([{ Authorization: 'Bearer custom-bearer-token' }]);
  }

  protected override async adminAPIKeyAuth(options: FinalRequestOptions): Promise<NullableHeaders> {
    this.adminCalls += 1;
    if (this.mutation === 'admin' || (this.mutationScheme === 'admin' && this.mutateCarrier)) {
      const carrier = await super.adminAPIKeyAuth(options);
      if (!carrier) {
        throw new Error('Expected a deferred admin authentication carrier.');
      }
      if (this.mutation === 'admin') {
        carrier.values.set('authorization', 'Bearer mutated-admin-token');
      } else {
        this.mutateCarrier?.(carrier.values);
      }
      return carrier;
    }
    return buildHeaders([{ Authorization: 'Bearer custom-admin-token' }]);
  }
}

const BASE_URL = 'https://azure-resource.example.com/openai';
const API_VERSION = '2024-02-15-preview';
const PRIVATE_CREDENTIAL = 'azure-private-credential-75da';
const PRIVATE_SUFFIX = 'private-patient-record-21f8';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';

const authenticationModes: readonly Authentication[] = ['static-api-key', 'rotating-entra-token'];
const publicRoutes: readonly PublicRoute[] = ['generic-request', 'models-list', 'chat-completion'];
const malformedCredentials = [
  ...Array.from({ length: 0x20 }, (_, code) => code)
    .filter((code) => code !== 0x09)
    .map((code) => ({
      format: `forbidden control byte U+${code.toString(16).padStart(4, '0').toUpperCase()}`,
      character: String.fromCodePoint(code),
    })),
  { format: 'DEL U+007F', character: String.fromCodePoint(0x7f) },
  { format: 'non-ByteString Unicode', character: '\u{1F680}' },
  { format: 'unpaired Unicode surrogate', character: String.fromCodePoint(0xd8_00) },
  { format: 'carriage-return line-feed', character: '\r\n' },
] as const;

const malformedCases = authenticationModes.flatMap((authentication) =>
  publicRoutes.flatMap((route) =>
    malformedCredentials.map(({ format, character }) => ({ authentication, route, format, character })),
  ),
);

const validCredentials = [
  { format: 'plain', credential: 'valid-azure-credential-9c54' },
  { format: 'horizontal-tab', credential: 'valid\tazure-credential' },
  { format: 'space', credential: 'valid azure-credential' },
  { format: 'lowest obs-text', credential: `valid${String.fromCodePoint(0x80)}azure-credential` },
  { format: 'highest obs-text', credential: `valid${String.fromCodePoint(0xff)}azure-credential` },
] as const;

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

type TestLogger = ReturnType<typeof createLogger>;

function createClient({
  authentication,
  credential,
  fetch,
  tokenProvider = async () => credential,
  logger,
  redirect,
}: {
  authentication: Authentication;
  credential: string;
  fetch: Fetch;
  tokenProvider?: () => Promise<string>;
  logger?: TestLogger;
  redirect?: RequestInit['redirect'];
}): AzureOpenAI {
  return new AzureOpenAI({
    baseURL: BASE_URL,
    apiVersion: API_VERSION,
    deployment: 'test-deployment',
    maxRetries: 0,
    logLevel: 'debug',
    fetch,
    ...(logger ? { logger } : {}),
    ...(redirect ? { fetchOptions: { redirect } } : {}),
    ...(authentication === 'static-api-key'
      ? { apiKey: credential }
      : { azureADTokenProvider: tokenProvider }),
  });
}

function invokePublicRoute(client: AzureOpenAI, route: PublicRoute): Promise<unknown> {
  switch (route) {
    case 'generic-request': {
      return client.request({ method: 'get', path: '/models' });
    }
    case 'models-list': {
      return client.models.list();
    }
    case 'chat-completion': {
      return client.chat.completions.create({
        model: 'test-deployment',
        messages: [{ role: 'user', content: 'hello' }],
      });
    }
    default: {
      throw new Error('Unknown Azure public request route.');
    }
  }
}

async function expectPrivateCredentialFailure(
  operation: () => Promise<unknown>,
  credential: string,
): Promise<TypeError> {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(TypeError);
  if (!(failure instanceof TypeError)) {
    throw new Error('Invalid Azure credentials must preserve their native TypeError class.');
  }

  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();
  for (const diagnostic of [failure.message, failure.stack ?? '']) {
    expect(diagnostic).not.toContain(credential);
    expect(diagnostic).not.toContain(PRIVATE_CREDENTIAL);
    expect(diagnostic).not.toContain(PRIVATE_SUFFIX);
  }
  return failure;
}

async function expectPrivateTransportCredentialFailure(
  operation: () => Promise<unknown>,
  credential: string,
): Promise<void> {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(APIConnectionError);
  if (!(failure instanceof APIConnectionError)) {
    throw new Error('Protected Azure transport failures must retain their connection wrapper.');
  }
  const { cause } = failure as APIConnectionError & { cause?: unknown };
  expect(cause).toBeInstanceOf(TypeError);
  if (!(cause instanceof TypeError)) {
    throw new Error('Invalid Azure transport credentials require a sanitized TypeError cause.');
  }
  expect(cause.message).toBe(SAFE_ERROR);
  expect((cause as TypeError & { cause?: unknown }).cause).toBeUndefined();
  for (const diagnostic of [failure.message, failure.stack ?? '', cause.message, cause.stack ?? '']) {
    expect(diagnostic).not.toContain(credential);
    expect(diagnostic).not.toContain(PRIVATE_CREDENTIAL);
    expect(diagnostic).not.toContain(PRIVATE_SUFFIX);
  }
}

function expectPrivateLogs(logger: TestLogger, credential: string): void {
  const calls = [
    ...logger.debug.mock.calls,
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
  ];
  for (const argumentsList of calls) {
    const serialized = JSON.stringify(argumentsList);
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain(PRIVATE_CREDENTIAL);
    expect(serialized).not.toContain(PRIVATE_SUFFIX);
  }
}

describe('Azure credential header diagnostic privacy', () => {
  beforeEach(() => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test.each(malformedCases)(
    '$authentication $route rejects $format before exposing or sending the credential',
    async ({ authentication, route, character }) => {
      const credential = `${PRIVATE_CREDENTIAL}${character}${PRIVATE_SUFFIX}`;
      const logger = createLogger();
      const fetch = vi.fn(async () => Response.json({ data: [] }));
      const tokenProvider = vi.fn(async () => credential);
      const client = createClient({ authentication, credential, fetch, tokenProvider, logger });

      await expectPrivateCredentialFailure(() => invokePublicRoute(client, route), credential);

      expect(fetch).not.toHaveBeenCalled();
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
      expectPrivateLogs(logger, credential);
    },
  );

  test.each(authenticationModes)(
    'keeps the real default logger free of a malformed %s credential',
    async (authentication) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const spies = [
        vi.spyOn(console, 'debug'),
        vi.spyOn(console, 'info'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = createClient({ authentication, credential, fetch });

      await expectPrivateCredentialFailure(
        () => client.request({ method: 'get', path: '/models' }),
        credential,
      );

      expect(fetch).not.toHaveBeenCalled();
      for (const spy of spies) {
        for (const argumentsList of spy.mock.calls) {
          expect(JSON.stringify(argumentsList)).not.toContain(PRIVATE_CREDENTIAL);
          expect(JSON.stringify(argumentsList)).not.toContain(PRIVATE_SUFFIX);
        }
      }
    },
  );

  test.each(authenticationModes)(
    'preserves unrelated invalid caller-header diagnostics for %s authentication',
    async (authentication) => {
      const callerValue = 'caller-header\nunrelated-invalid-value';
      const credential = 'valid-azure-credential';
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = createClient({ authentication, credential, fetch, logger: createLogger() });

      let failure: unknown;
      try {
        await client.request({
          method: 'get',
          path: '/models',
          headers: { 'x-caller': callerValue },
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TypeError);
      expect((failure as Error).message).toContain(callerValue);
      expect((failure as Error).message).not.toBe(SAFE_ERROR);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['SDK provider error', new OpenAIError('The real credential provider failed.')],
    ['generic provider error', new Error('The real credential provider failed.')],
  ] as const)(
    'preserves %s and the existing provider failure contract',
    async (_description, originalFailure) => {
      const tokenProvider = vi.fn(async (): Promise<string> => {
        throw originalFailure;
      });
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = createClient({
        authentication: 'rotating-entra-token',
        credential: 'unused-valid-credential',
        tokenProvider,
        fetch,
        logger: createLogger(),
      });

      let failure: unknown;
      try {
        await client.request({ method: 'get', path: '/models' });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(OpenAIError);
      if (originalFailure instanceof OpenAIError) {
        expect(failure).toBe(originalFailure);
      } else {
        expect(failure).not.toBe(originalFailure);
        expect((failure as Error & { cause?: unknown }).cause).toBe(originalFailure);
      }
      expect(tokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(
    authenticationModes.flatMap((authentication) =>
      validCredentials.map(({ format, credential }) => ({ authentication, format, credential })),
    ),
  )(
    'preserves valid $format $authentication credentials and redirect behavior',
    async ({ authentication, credential }) => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        Response.json({ data: [], object: 'list' }),
      );
      const tokenProvider = vi.fn(async () => credential);
      const client = createClient({
        authentication,
        credential,
        fetch,
        tokenProvider,
        logger: createLogger(),
        redirect: 'follow',
      });

      await client.request({ method: 'get', path: '/models' });

      const [, request] = fetch.mock.calls[0] ?? [];
      const headers = new Headers(request?.headers);
      if (authentication === 'static-api-key') {
        expect(headers.get('api-key')).toBe(credential);
        expect(headers.has('authorization')).toBe(false);
        expect(request?.redirect).toBe('manual');
      } else {
        expect(headers.get('authorization')).toBe(`Bearer ${credential}`);
        expect(headers.has('api-key')).toBe(false);
        expect(request?.redirect).toBe('follow');
      }
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(authenticationModes)(
    'does not validate or resolve a %s credential when bearer authentication is disabled',
    async (authentication) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const tokenProvider = vi.fn(async () => credential);
      const client = createClient({
        authentication,
        credential,
        fetch,
        tokenProvider,
        logger: createLogger(),
      });

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: false, adminAPIKeyAuth: false },
        headers: { authorization: null, 'api-key': null },
      });

      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('validates credentials loaded from the Azure environment', async () => {
    const credential = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
    vi.stubEnv('AZURE_OPENAI_API_KEY', credential);
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      fetch,
      maxRetries: 0,
      logger: createLogger(),
    });

    await expectPrivateCredentialFailure(
      () => client.request({ method: 'get', path: '/models' }),
      credential,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects malformed static credentials through direct public request building', async () => {
    const credential = `${PRIVATE_CREDENTIAL}\u0001${PRIVATE_SUFFIX}`;
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = createClient({
      authentication: 'static-api-key',
      credential,
      fetch,
      logger: createLogger(),
    });

    await expectPrivateCredentialFailure(
      () => client.buildRequest({ method: 'get', path: '/models' }),
      credential,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(
    authenticationModes.flatMap((authentication) =>
      (['default', 'request'] as const).flatMap((source) =>
        (['api-key', 'Authorization'] as const).map((header) => ({ authentication, source, header })),
      ),
    ),
  )(
    '$authentication rejects the effective $source $header override without exposing it',
    async ({ authentication, source, header }) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const tokenProvider = vi.fn(async () => 'valid-entra-token');
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'valid-azure-key' }
          : { azureADTokenProvider: tokenProvider }),
        ...(source === 'default' ? { defaultHeaders: { [header]: credential } } : {}),
        fetch,
      });
      await expectPrivateCredentialFailure(
        () =>
          client.request({
            method: 'get',
            path: '/models',
            ...(source === 'request' ? { headers: { [header]: credential } } : {}),
          }),
        credential,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each(
    authenticationModes.flatMap((authentication) =>
      (['valid', 'null'] as const).map((override) => ({ authentication, override })),
    ),
  )(
    '$authentication accepts a malformed configured credential replaced by a $override override',
    async ({ authentication, override }) => {
      const configured = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const tokenProvider = vi.fn(async () => configured);
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: configured }
          : { azureADTokenProvider: tokenProvider }),
        fetch,
      });
      const name = authentication === 'static-api-key' ? 'API-KEY' : 'AUTHORIZATION';
      const replacement = override === 'null' ? null : 'safe-replacement';
      await client.request({ method: 'get', path: '/models', headers: { [name]: replacement } });
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe(replacement);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each(authenticationModes)(
    '%s preserves case-insensitive last-write authentication header precedence',
    async (authentication) => {
      const configured = 'safe-configured-credential';
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: configured }
          : { azureADTokenProvider: async () => configured }),
        fetch,
      });
      const name = authentication === 'static-api-key' ? 'api-key' : 'authorization';
      await client.request({
        method: 'get',
        path: '/models',
        headers: {
          [name.toUpperCase()]: `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`,
          [name]: 'safe-final-credential',
        },
      });
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('safe-final-credential');
    },
  );

  test.each(['valid', 'null'] as const)(
    'does not append an invalid default credential superseded by a %s request override',
    async (override) => {
      const unsafe = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-key',
        defaultHeaders: { 'API-KEY': unsafe },
        fetch,
      });
      const replacement = override === 'null' ? null : 'safe-final-key';
      await client.request({
        method: 'get',
        path: '/models',
        headers: { 'api-key': replacement },
      });
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe(replacement);
    },
  );

  test.each([
    {
      name: 'duplicate tuple values',
      headers: [
        ['Authorization', 'safe-first'],
        ['authorization', `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`],
      ],
    },
    {
      name: 'multiple object values',
      headers: {
        Authorization: ['safe-first', `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`],
      },
    },
  ])('rejects unsafe retained $name without invoking native header diagnostics', async ({ headers }) => {
    const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = createClient({
      authentication: 'static-api-key',
      credential: 'safe-key',
      fetch,
    });
    await expectPrivateCredentialFailure(
      () => client.request({ method: 'get', path: '/models', headers }),
      credential,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves a valid Headers default and a case-insensitive request replacement', async () => {
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'safe-configured-key',
      defaultHeaders: new Headers({ 'API-KEY': 'safe-default-key' }),
      fetch,
    });
    await client.request({
      method: 'get',
      path: '/models',
      headers: { 'api-KEY': 'safe-final-key' },
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('safe-final-key');
  });

  test.each(authenticationModes)(
    '%s preserves the existing explicitly enabled admin authentication precedence',
    async (authentication) => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const provider = vi.fn(async () => 'safe-provider-token');
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'safe-static-key' }
          : { azureADTokenProvider: provider }),
        adminAPIKey: 'safe-admin-key',
        fetch,
      });
      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: true },
      });
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      if (authentication === 'static-api-key') {
        expect(headers.get('api-key')).toBe('safe-static-key');
        expect(headers.has('authorization')).toBe(false);
      } else {
        expect(headers.get('authorization')).toBe('Bearer safe-admin-key');
        expect(headers.has('api-key')).toBe(false);
      }
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test('sanitizes explicit credential overrides without resolving a disabled provider', async () => {
    const unsafe = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const provider = vi.fn(async () => 'unused-provider-token');
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      azureADTokenProvider: provider,
      fetch,
    });
    await expectPrivateCredentialFailure(
      () =>
        client.request({
          method: 'get',
          path: '/models',
          __security: { bearerAuth: false, adminAPIKeyAuth: false },
          headers: { AUTHORIZATION: unsafe },
        }),
      unsafe,
    );
    expect(provider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('continues refreshing valid Entra credentials for each public request', async () => {
    const tokenProvider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('valid-entra-token-one')
      .mockResolvedValueOnce('valid-entra-token-two');
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = createClient({
      authentication: 'rotating-entra-token',
      credential: 'unused-valid-credential',
      tokenProvider,
      fetch,
      logger: createLogger(),
    });

    await client.request({ method: 'get', path: '/models' });
    await client.request({ method: 'get', path: '/models' });

    const firstRequest = fetch.mock.calls[0]?.[1];
    const secondRequest = fetch.mock.calls[1]?.[1];
    expect(new Headers(firstRequest?.headers).get('authorization')).toBe('Bearer valid-entra-token-one');
    expect(new Headers(secondRequest?.headers).get('authorization')).toBe('Bearer valid-entra-token-two');
    expect(tokenProvider).toHaveBeenCalledTimes(2);
  });

  test.each(
    authenticationModes.flatMap((authentication) =>
      (['api-key', 'Authorization'] as const).flatMap((header) =>
        (['ambient', 'default'] as const).map((source) => ({ authentication, header, source })),
      ),
    ),
  )(
    '$authentication protects $source $header while preprocessing ambient headers',
    async ({ authentication, header, source }) => {
      const credential = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
      vi.stubEnv(
        'OPENAI_CUSTOM_HEADERS',
        source === 'ambient' ? `${header}: ${credential}` : 'X-Ambient: safe',
      );
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      await expectPrivateCredentialFailure(
        async () =>
          new AzureOpenAI({
            baseURL: BASE_URL,
            apiVersion: API_VERSION,
            ...(authentication === 'static-api-key'
              ? { apiKey: 'safe-key' }
              : { azureADTokenProvider: async () => 'safe-token' }),
            ...(source === 'default' ? { defaultHeaders: { [header]: credential } } : {}),
            fetch,
          }),
        credential,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['valid', 'null'] as const)(
    'applies the %s default before an unsafe ambient credential',
    async (override) => {
      const credential = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
      vi.stubEnv('OPENAI_CUSTOM_HEADERS', `API-KEY: ${credential}\nX-Ambient: preserved`);
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const value = override === 'null' ? null : 'safe-default-key';
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-key',
        defaultHeaders: { 'api-key': value },
        fetch,
      });
      await client.request({ method: 'get', path: '/models' });
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('api-key')).toBe(value);
      expect(headers.get('x-ambient')).toBe('preserved');
    },
  );

  test('preserves an explicitly null static Azure api-key', async () => {
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new AzureOpenAI({ baseURL: BASE_URL, apiVersion: API_VERSION, apiKey: 'safe-key', fetch });
    client.apiKey = null;
    await client.request({ method: 'get', path: '/models' });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('api-key')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(
    authenticationModes.flatMap((authentication) =>
      (['api-key', 'Authorization'] as const).map((header) => ({ authentication, header })),
    ),
  )('$authentication sanitizes $header injected by prepareRequest', async ({ authentication, header }) => {
    const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      ...(authentication === 'static-api-key'
        ? { apiKey: 'safe-key' }
        : { azureADTokenProvider: async () => 'safe-token' }),
      fetch,
      maxRetries: 0,
    });
    client.injectedHeaders = { [header]: credential };
    await expectPrivateTransportCredentialFailure(
      () => client.request({ method: 'get', path: '/models' }),
      credential,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['bearer', 'admin'] as const)(
    'preserves the protected %s authentication override',
    async (scheme) => {
      const provider = vi.fn(async () => 'safe-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        azureADTokenProvider: provider,
        adminAPIKey: 'default-admin-token',
        fetch,
      });
      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
        scheme === 'admin' ? 'Bearer custom-admin-token' : 'Bearer custom-bearer-token',
      );
      expect(client.bearerCalls).toBe(1);
      expect(client.adminCalls).toBe(scheme === 'admin' ? 1 : 0);
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  test('keeps only the effective case-variant post-hook credential', async () => {
    const credential = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'safe-key',
      fetch,
      maxRetries: 0,
    });
    client.injectedHeaders = { AUTHORIZATION: credential, authorization: 'safe-final' };
    await client.request({ method: 'get', path: '/models' });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('safe-final');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('preserves safe protected-hook header object identity and redirects', async () => {
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'safe-key',
      fetch,
    });
    const injected = { 'API-KEY': 'safe\tupdated-key', 'X-Custom': 'preserved' };
    client.injectedHeaders = injected;
    await client.request({ method: 'get', path: '/models' });
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.headers).toBeInstanceOf(Headers);
    expect(request?.headers).not.toBe(injected);
    expect(new Headers(request?.headers).get('api-key')).toBe('safe\tupdated-key');
    expect(new Headers(request?.headers).get('x-custom')).toBe('preserved');
    expect(request?.redirect).toBe('manual');
  });

  test.each(['Headers', 'tuple'] as const)(
    'preserves safe ambient precedence with %s Azure default headers',
    async (kind) => {
      vi.stubEnv('OPENAI_CUSTOM_HEADERS', 'X-Ambient: original\nX-Override: ambient');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const defaults =
        kind === 'Headers' ? new Headers({ 'x-override': 'default' }) : [['x-override', 'default']];
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-key',
        defaultHeaders: defaults,
        fetch,
      });
      await client.request({ method: 'get', path: '/models' });
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('x-ambient')).toBe('original');
      expect(headers.get('x-override')).toBe('default');
    },
  );

  test.each(['getter', 'proxy'] as const)(
    'snapshots a mutable %s credential once across validation, redirect, and dispatch',
    async (kind) => {
      const credential = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
      let reads = 0;
      const readValue = () => {
        reads += 1;
        return reads === 1 ? 'safe-first-token' : credential;
      };
      const getterHeaders: Record<string, string> = {};
      Object.defineProperty(getterHeaders, 'api-key', {
        enumerable: true,
        get: readValue,
      });
      const headers =
        kind === 'getter'
          ? getterHeaders
          : new Proxy(
              { 'api-key': 'placeholder' },
              {
                get(target, property, receiver) {
                  return property === 'api-key' ? readValue() : Reflect.get(target, property, receiver);
                },
              },
            );
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-key',
        fetch,
        maxRetries: 0,
      });
      await client.invokeProtectedFetch(headers);
      expect(reads).toBe(1);
      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBeInstanceOf(Headers);
      expect(new Headers(request?.headers).get('api-key')).toBe('safe-first-token');
      expect(request?.redirect).toBe('manual');
      expect(client.fetchFailures).toBe(0);
    },
  );

  test('keeps protected Azure credential failures asynchronous and catchable', async () => {
    const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'safe-key',
      fetch,
      maxRetries: 0,
    });
    const failure = client.invokeProtectedFetch({ authorization: credential });
    expect(failure).toBeInstanceOf(Promise);
    await expect(failure).rejects.toThrow(SAFE_ERROR);
    await expect(failure.catch((error: unknown) => error)).resolves.not.toHaveProperty('cause');
    expect(client.fetchFailures).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('exposes deferred Azure authentication tombstones through a genuine observable Set', async () => {
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-static-token',
      fetch,
      maxRetries: 0,
    });
    client.apiKey = null;
    client.inspectAuthenticationCarrier = (carrier) => {
      expect(carrier.nulls).toBeInstanceOf(Set);
      expect(carrier.nulls.has('api-key')).toBe(true);
      expect(carrier.nulls.size).toBe(1);
      expect([...carrier.nulls]).toEqual(['api-key']);
      expect([...carrier.nulls.keys()]).toEqual(['api-key']);
      expect([...carrier.nulls.values()]).toEqual(['api-key']);
      expect([...carrier.nulls.entries()]).toEqual([['api-key', 'api-key']]);
      const observed: string[] = [];
      const visitNulls = carrier.nulls.forEach.bind(carrier.nulls);
      visitNulls((value, key, parent) => {
        observed.push(value, key);
        expect(parent).toBe(carrier.nulls);
      });
      expect(observed).toEqual(['api-key', 'api-key']);
      expect(carrier.values.has('api-key')).toBe(false);
    };

    await client.request({ method: 'get', path: '/models' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('api-key')).toBe(false);
  });

  test.each(['delete', 'clear'] as const)(
    'restores missing-authentication validation when an inherited Azure tombstone is removed with %s',
    async (operation) => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-static-token',
        fetch,
        maxRetries: 0,
      });
      client.apiKey = null;
      client.inspectAuthenticationCarrier = (carrier) => {
        expect(carrier.nulls.has('api-key')).toBe(true);
        if (operation === 'delete') {
          expect(carrier.nulls.delete('api-key')).toBe(true);
        } else {
          carrier.nulls.clear();
        }
        expect(carrier.nulls.size).toBe(0);
        expect(carrier.values.has('api-key')).toBe(false);
      };

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
        'Could not resolve authentication method.',
      );

      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['delete', 'clear'] as const)(
    'restores a deferred static Azure credential when a caller-added tombstone is removed with %s',
    async (operation) => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-static-token',
        fetch,
        maxRetries: 0,
      });
      client.inspectAuthenticationCarrier = (carrier) => {
        expect(carrier.nulls.has('api-key')).toBe(false);
        expect(carrier.nulls.add('api-key')).toBe(carrier.nulls);
        expect(carrier.nulls.has('api-key')).toBe(true);
        if (operation === 'delete') {
          expect(carrier.nulls.delete('api-key')).toBe(true);
        } else {
          carrier.nulls.clear();
        }
        expect(carrier.nulls.size).toBe(0);
        expect(carrier.values.get('api-key')).toBe('configured-static-token');
      };

      await client.request({ method: 'get', path: '/models' });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('configured-static-token');
    },
  );

  test.each(['auth', 'auth-null', 'bearer', 'admin'] as const)(
    'preserves a subclass mutation of the super %s authentication carrier',
    async (mutation) => {
      const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const provider = vi.fn(async () => (mutation === 'bearer' ? malformed : 'safe-provider-token'));
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const isStatic = mutation === 'auth' || mutation === 'auth-null';
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(isStatic ? { apiKey: malformed } : { azureADTokenProvider: provider, adminAPIKey: malformed }),
        fetch,
        maxRetries: 0,
      });
      client.mutation = mutation;
      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: mutation === 'admin' },
      });
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      if (mutation === 'auth') {
        expect(headers.get('api-key')).toBe('mutated-static-token');
      } else if (mutation === 'auth-null') {
        expect(headers.has('api-key')).toBe(false);
      } else {
        expect(headers.get('authorization')).toBe(`Bearer mutated-${mutation}-token`);
      }
      expect(provider).toHaveBeenCalledTimes(isStatic ? 0 : 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    {
      name: 'deletes a configured static key before setting bearer authentication',
      scheme: 'auth',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.delete('API-KEY');
        headers.set('Authorization', 'Bearer replacement-token');
      },
      apiKey: null,
      authorization: 'Bearer replacement-token',
    },
    {
      name: 'deletes a malformed static key without ever validating it',
      scheme: 'auth',
      configured: 'malformed',
      mutate: (headers: Headers) => {
        headers.delete('aPi-KeY');
        headers.set('AUTHORIZATION', 'Bearer replacement-token');
      },
      apiKey: null,
      authorization: 'Bearer replacement-token',
    },
    {
      name: 'appends to the deferred configured static credential',
      scheme: 'auth',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.append('API-KEY', 'appended-token');
        headers.append('api-key', 'second-token');
      },
      apiKey: 'configured-token, appended-token, second-token',
      authorization: null,
    },
    {
      name: 'does not revive a deleted malformed key when appending a replacement',
      scheme: 'auth',
      configured: 'malformed',
      mutate: (headers: Headers) => {
        headers.delete('API-KEY');
        headers.append('api-key', 'appended-token');
      },
      apiKey: 'appended-token',
      authorization: null,
    },
    {
      name: 'deletes an appended key before replacing its authentication scheme',
      scheme: 'auth',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.append('api-key', 'discarded-token');
        headers.delete('API-KEY');
        headers.set('Authorization', 'Bearer replacement-token');
      },
      apiKey: null,
      authorization: 'Bearer replacement-token',
    },
    {
      name: 'replaces an invalid intermediate protected-hook value safely',
      scheme: 'auth',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.set('api-key', [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\n'));
        headers.set('API-KEY', 'safe-final-token');
      },
      apiKey: 'safe-final-token',
      authorization: null,
    },
    {
      name: 'deletes an invalid appended protected-hook value safely',
      scheme: 'auth',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.append('API-KEY', [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\r'));
        headers.delete('api-key');
        headers.set('authorization', 'Bearer safe-final-token');
      },
      apiKey: null,
      authorization: 'Bearer safe-final-token',
    },
    {
      name: 'deletes a malformed rotating bearer credential',
      scheme: 'bearer',
      configured: 'malformed',
      mutate: (headers: Headers) => {
        headers.delete('AUTHORIZATION');
        headers.set('api-key', 'safe-bearer-replacement');
      },
      apiKey: 'safe-bearer-replacement',
      authorization: null,
    },
    {
      name: 'appends to the deferred rotating bearer credential',
      scheme: 'bearer',
      configured: 'valid',
      mutate: (headers: Headers) => {
        headers.append('authorization', 'Bearer appended-token');
      },
      apiKey: null,
      authorization: 'Bearer configured-token, Bearer appended-token',
    },
    {
      name: 'deletes a malformed administrator credential without losing bearer auth',
      scheme: 'admin',
      configured: 'malformed',
      mutate: (headers: Headers) => {
        headers.delete('Authorization');
        headers.set('API-KEY', 'safe-admin-replacement');
      },
      apiKey: 'safe-admin-replacement',
      authorization: 'Bearer custom-bearer-token',
    },
  ] as const)('preserves subclass carrier mutation: $name', async (scenario) => {
    const credential =
      scenario.configured === 'malformed'
        ? [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\n')
        : 'configured-token';
    const provider = vi.fn(async () => (scenario.scheme === 'admin' ? 'safe-provider-token' : credential));
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      ...(scenario.scheme === 'auth'
        ? { apiKey: credential }
        : { azureADTokenProvider: provider, adminAPIKey: credential }),
      fetch,
      maxRetries: 0,
    });
    client.mutationScheme = scenario.scheme;
    client.mutateCarrier = scenario.mutate;
    await client.request({
      method: 'get',
      path: '/models',
      __security: { bearerAuth: true, adminAPIKeyAuth: scenario.scheme === 'admin' },
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('api-key')).toBe(scenario.apiKey);
    expect(headers.get('authorization')).toBe(scenario.authorization);
    expect(provider).toHaveBeenCalledTimes(scenario.scheme === 'auth' ? 0 : 1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['set', 'append'] as const)(
    'rejects an effective malformed protected-carrier %s without leaking it',
    async (operation) => {
      const credential = [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\n');
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });
      client.mutateCarrier = (headers) => {
        headers[operation]('api-key', credential);
      };
      await expectPrivateCredentialFailure(
        () => client.request({ method: 'get', path: '/models' }),
        credential,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  const deferredHeaderReadScenarios = (['auth', 'bearer', 'admin'] as const).flatMap((scheme) =>
    (['get', 'has', 'entries', 'keys', 'values', 'iterator', 'forEach'] as const).map((method) => ({
      scheme,
      method,
    })),
  );

  test.each(deferredHeaderReadScenarios)(
    'preserves deferred $scheme authentication through Headers.$method',
    async ({ scheme, method }) => {
      const configured = 'configured-token';
      const expectedName = scheme === 'auth' ? 'api-key' : 'authorization';
      const expectedValue = scheme === 'auth' ? configured : `Bearer ${configured}`;
      const provider = vi.fn(async () => configured);
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(scheme === 'auth'
          ? { apiKey: configured }
          : { azureADTokenProvider: provider, adminAPIKey: configured }),
        fetch,
        maxRetries: 0,
      });
      client.mutationScheme = scheme;
      client.mutateCarrier = (headers) => {
        expect(headers).toBeInstanceOf(Headers);
        let observed: string | null = null;
        switch (method) {
          case 'get': {
            observed = headers.get(expectedName.toUpperCase());
            break;
          }
          case 'has': {
            observed = headers.has(expectedName.toUpperCase()) ? expectedValue : null;
            break;
          }
          case 'entries': {
            observed = [...headers.entries()].find(([name]) => name === expectedName)?.[1] ?? null;
            break;
          }
          case 'keys': {
            observed = [...headers.keys()].includes(expectedName) ? expectedValue : null;
            break;
          }
          case 'values': {
            observed = [...headers.values()].find((value) => value === expectedValue) ?? null;
            break;
          }
          case 'iterator': {
            observed = [...headers].find(([name]) => name === expectedName)?.[1] ?? null;
            break;
          }
          case 'forEach': {
            const callbackContext = { trusted: true };
            const iterate = headers.forEach;
            iterate.call(
              headers,
              function collectHeader(
                this: typeof callbackContext,
                value: string,
                name: string,
                owner: Headers,
              ) {
                expect(this).toBe(callbackContext);
                expect(owner).toBe(headers);
                if (name === expectedName) {
                  observed = value;
                }
              },
              callbackContext,
            );
            break;
          }
          default: {
            throw new Error('Unknown deferred header reader.');
          }
        }
        expect(observed).toBe(expectedValue);
      };

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });
      expect(provider).toHaveBeenCalledTimes(scheme === 'auth' ? 0 : 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('keeps deferred Headers reads coherent across malformed shadows and visible mutations', async () => {
    const malformed = [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\n');
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: malformed,
      fetch,
      maxRetries: 0,
    });
    client.mutateCarrier = (headers) => {
      expect(headers.get('API-KEY')).toBe(malformed);
      expect([...headers.entries()]).toEqual([['api-key', malformed]]);

      headers.set('API-KEY', 'safe-shadow');
      headers.append('api-key', 'safe-suffix');
      expect(headers.get('api-key')).toBe('safe-shadow, safe-suffix');

      headers.set('Z-Extra', 'last');
      headers.set('A-Extra', 'first');
      expect([...headers.keys()]).toEqual(['a-extra', 'api-key', 'z-extra']);

      headers.delete('aPi-KeY');
      expect(headers.has('API-KEY')).toBe(false);

      headers.set('api-key', malformed);
      expect(headers.get('API-KEY')).toBe(malformed);
      headers.set('API-KEY', 'safe-final');
      expect([...headers]).toEqual([
        ['a-extra', 'first'],
        ['api-key', 'safe-final'],
        ['z-extra', 'last'],
      ]);
    };

    await client.request({ method: 'get', path: '/models' });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('api-key')).toBe('safe-final');
    expect(headers.get('a-extra')).toBe('first');
    expect(headers.get('z-extra')).toBe('last');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('snapshots a deferred Azure default-header getter once across reads and final dispatch', async () => {
    const malformed = [PRIVATE_CREDENTIAL, PRIVATE_SUFFIX].join('\n');
    let reads = 0;
    const defaults: Record<string, string> = {};
    Object.defineProperty(defaults, 'API-KEY', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'safe-snapshot-token' : malformed;
      },
    });
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });
    client.inspectDeferredDefaultHeaders(defaults, (headers) => {
      expect(headers.get('api-key')).toBe('safe-snapshot-token');
      expect(headers.has('API-KEY')).toBe(true);
      expect([...headers.entries()]).toEqual([['api-key', 'safe-snapshot-token']]);
    });
    expect(reads).toBe(1);

    await client.request({ method: 'get', path: '/models' });
    expect(reads).toBe(1);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('safe-snapshot-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
