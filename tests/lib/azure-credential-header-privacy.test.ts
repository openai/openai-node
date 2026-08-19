import { vi } from 'vitest';

import { APIConnectionError, AzureOpenAI, OpenAIError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

type Authentication = 'static-api-key' | 'rotating-entra-token';
type PublicRoute = 'generic-request' | 'models-list' | 'chat-completion';
type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

class ProtectedHookAzure extends AzureOpenAI {
  injectedHeaders: Record<string, string> | undefined;
  bearerCalls = 0;
  adminCalls = 0;
  fetchFailures = 0;
  mutation: 'auth' | 'auth-null' | 'bearer' | 'admin' | undefined;

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
    return carrier;
  }

  protected override async bearerAuth(options: FinalRequestOptions): Promise<NullableHeaders> {
    this.bearerCalls += 1;
    if (this.mutation === 'bearer') {
      const carrier = await super.bearerAuth(options);
      if (!carrier) {
        throw new Error('Expected a deferred bearer authentication carrier.');
      }
      carrier.values.set('AUTHORIZATION', 'Bearer mutated-bearer-token');
      return carrier;
    }
    return buildHeaders([{ Authorization: 'Bearer custom-bearer-token' }]);
  }

  protected override async adminAPIKeyAuth(options: FinalRequestOptions): Promise<NullableHeaders> {
    this.adminCalls += 1;
    if (this.mutation === 'admin') {
      const carrier = await super.adminAPIKeyAuth(options);
      if (!carrier) {
        throw new Error('Expected a deferred admin authentication carrier.');
      }
      carrier.values.set('authorization', 'Bearer mutated-admin-token');
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
});
