import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
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
  injectedHeaders: Record<string, string> | Headers | undefined;
  bearerCalls = 0;
  adminCalls = 0;
  fetchFailures = 0;
  mutation: 'auth' | 'auth-null' | 'bearer' | 'admin' | undefined;
  mutationScheme: CarrierAuthenticationScheme = 'auth';
  mutateCarrier: ((headers: Headers) => void) | undefined;
  inspectAuthenticationCarrier: ((carrier: NullableHeaders) => void) | undefined;
  cloneAuthenticationCarrier: 'spread' | 'assign' | undefined;
  reusedAuthenticationCarrier: NullableHeaders | undefined;
  observeAuthenticationOptions: ((options: FinalRequestOptions) => Promise<void>) | undefined;
  observePreparedOptions: ((options: FinalRequestOptions) => void) | undefined;
  observeProtectedHookOptions:
    | ((hook: 'auth' | 'bearer' | 'admin' | 'request', options: FinalRequestOptions) => void)
    | undefined;

  protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    await super.prepareOptions(options);
    this.observePreparedOptions?.(options);
  }

  protected override async prepareRequest(
    request: RequestInit,
    context?: { url: string; options: FinalRequestOptions },
  ): Promise<void> {
    if (context) {
      this.observeProtectedHookOptions?.('request', context.options);
    }
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

  invokeProtectedFetch(headers: Record<string, string> | Headers): Promise<Response> {
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
    this.observeProtectedHookOptions?.('auth', options);
    if (this.observeAuthenticationOptions) {
      await this.observeAuthenticationOptions(options);
    }
    const carrier = this.reusedAuthenticationCarrier ?? (await super.authHeaders(options, schemes));
    if (this.mutation === 'auth') {
      carrier?.values.set('API-KEY', 'mutated-static-token');
    } else if (this.mutation === 'auth-null') {
      carrier?.nulls.add('api-key');
    }
    if (carrier && this.mutationScheme === 'auth') {
      this.mutateCarrier?.(carrier.values);
    }
    if (carrier) {
      this.inspectAuthenticationCarrier?.(carrier);
    }
    if (!carrier || !this.cloneAuthenticationCarrier) {
      return carrier;
    }
    if (this.cloneAuthenticationCarrier === 'spread') {
      return { ...carrier };
    }
    const copied = {};
    return Object.assign(copied, carrier);
  }

  protected override async bearerAuth(options: FinalRequestOptions): Promise<NullableHeaders> {
    this.observeProtectedHookOptions?.('bearer', options);
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
    this.observeProtectedHookOptions?.('admin', options);
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

const testRequire = createRequire(`${process.cwd()}/package.json`);
const foreignRequire = createRequire(testRequire.resolve('vitest/package.json'));
const { Headers: ForeignHeaders } = foreignRequire('undici') as { Headers: typeof Headers };
const createForeignHeaders = (values: [string, string][]): Headers =>
  runInNewContext('new ForeignHeaders(values)', { ForeignHeaders, values }) as Headers;
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

  const bodyCredentialCases = authenticationModes.flatMap((authentication) =>
    (['api-key', 'Authorization'] as const).flatMap((header) =>
      (['chat completion', 'form body', 'undefined body'] as const).map((body) => ({
        authentication,
        header,
        body,
      })),
    ),
  );

  test.each(bodyCredentialCases)(
    '$authentication protects request-level $header during $body preprocessing',
    async ({ authentication, header, body }) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const provider = vi.fn(async () => 'safe-provider-token');
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        deployment: 'test-deployment',
        ...(authentication === 'static-api-key'
          ? { apiKey: 'safe-configured-token' }
          : { azureADTokenProvider: provider }),
        fetch,
        maxRetries: 0,
      });
      const headers = { [header]: credential };
      const operation = () => {
        if (body === 'chat completion') {
          return client.chat.completions.create(
            { model: 'test-deployment', messages: [{ role: 'user', content: 'hello' }] },
            { headers },
          );
        }
        if (body === 'form body') {
          const form = new FormData();
          form.append('safe', 'payload');
          return client.request({ method: 'post', path: '/models', body: form, headers });
        }
        return client.request({ method: 'post', path: '/models', body: undefined, headers });
      };

      await expectPrivateCredentialFailure(operation, credential);
      expect(fetch).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  const statefulBodyCases = [
    { description: 'false', initial: false },
    { description: 'null', initial: null },
    { description: 'zero', initial: 0 },
    { description: 'an empty string', initial: '' },
    { description: 'undefined', initial: undefined },
  ] as const;

  test.each(
    statefulBodyCases.flatMap(({ description, initial }) =>
      (['api-key', 'Authorization'] as const).flatMap((name) =>
        (['own', 'inherited'] as const).map((representation) => ({
          description,
          initial,
          name,
          representation,
        })),
      ),
    ),
  )(
    'protects $name when an $representation body accessor changes from $description',
    async ({ initial, name, representation }) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const headers = { [name]: credential };
      const options: FinalRequestOptions = { method: 'post', path: '/models', headers };
      const owner: object =
        representation === 'own' ? options : Object.create(Object.getPrototypeOf(options));
      if (representation === 'inherited') {
        Object.setPrototypeOf(options, owner);
      }
      let reads = 0;
      Object.defineProperty(owner, 'body', {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          return reads === 1 ? initial : { safe: true };
        },
      });
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });

      await expectPrivateCredentialFailure(() => client.request(options), credential);

      expect(reads).toBe(representation === 'own' ? 2 : 1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'protects $name when a body accessor replaces itself with a truthy value',
    async (name) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        headers: { [name]: credential },
      };
      let reads = 0;
      Object.defineProperty(options, 'body', {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          Object.defineProperty(options, 'body', {
            configurable: true,
            enumerable: true,
            value: { safe: true },
          });
          return false;
        },
      });
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });

      await expectPrivateCredentialFailure(() => client.request(options), credential);

      expect(reads).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'snapshots the effective %s override once across body preprocessing and final authentication',
    async (name) => {
      const malformed = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
      let reads = 0;
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, name, {
        enumerable: true,
        get() {
          reads += 1;
          return reads === 1 ? 'safe-final-token' : malformed;
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        fetch,
        maxRetries: 0,
      });
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { safe: 'payload' },
        headers,
      };

      await client.request(options);

      expect(reads).toBe(1);
      expect(options.headers).toBe(headers);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('safe-final-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['api-key', 'Authorization'] as const).flatMap((name) => [
      { name, body: { safe: 'payload' }, description: 'a JSON body' },
      { name, body: undefined, description: 'an explicitly undefined body' },
    ]),
  )(
    'snapshots accessor-backed $name request headers once before preprocessing $description',
    async ({ name, body }) => {
      const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const firstHeaders = { [name]: 'safe-first-token', 'x-custom': 'preserved' };
      const unsafeHeaders = { [name]: malformed };
      let reads = 0;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body,
        get headers() {
          reads += 1;
          return reads === 1 ? firstHeaders : unsafeHeaders;
        },
      };
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const state = new WeakMap<FinalRequestOptions, { source: string }>();
      const marker = { source: 'accessor request options' };
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });
      client.observePreparedOptions = (prepared) => state.set(prepared, marker);
      client.observeProtectedHookOptions = (_hook, received) => {
        expect(received).toBe(options);
        expect(state.get(received)).toBe(marker);
      };

      await client.request(options);

      expect(reads).toBe(1);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('safe-first-token');
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-custom')).toBe('preserved');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'restores accessor-backed request headers after rejecting a malformed %s snapshot',
    async (name) => {
      const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      let reads = 0;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { safe: 'payload' },
        get headers() {
          reads += 1;
          return { [name]: reads === 1 ? malformed : 'safe-second-token' };
        },
      };
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });

      await expectPrivateCredentialFailure(() => client.request(options), malformed);

      expect(reads).toBe(1);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('rejects a nonconfigurable request headers accessor before reading an unsafe credential', async () => {
    const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    let reads = 0;
    const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
    Object.defineProperty(options, 'headers', {
      enumerable: true,
      get() {
        reads += 1;
        return { 'api-key': malformed };
      },
    });
    const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });

    await expectPrivateCredentialFailure(() => client.request(options), malformed);

    expect(reads).toBe(0);
    expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves protected-hook mutations of accessor-backed request headers', async () => {
    let reads = 0;
    let writes = 0;
    let headers = { 'api-key': 'first-token' };
    const replacement = { 'api-key': 'hook-replacement-token' };
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { safe: true },
      get headers() {
        reads += 1;
        return headers;
      },
      set headers(value) {
        writes += 1;
        if (!value || Array.isArray(value) || value instanceof Headers) {
          throw new Error('Expected replacement request header record.');
        }
        headers = value as { 'api-key': string };
      },
    };
    const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });
    client.observeProtectedHookOptions = (hook, received) => {
      if (hook === 'auth') {
        received.headers = replacement;
      }
    };

    await client.request(options);

    expect(reads).toBe(1);
    expect(writes).toBe(1);
    expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('hook-replacement-token');
  });

  test.each([
    ['the same Azure client', false],
    ['different Azure clients', true],
  ] as const)(
    'isolates rotating request-header accessors when %s share request options',
    async (_description, differentClients) => {
      const firstClient = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-first-client-token',
        maxRetries: 0,
      });
      const secondClient = differentClients
        ? new ProtectedHookAzure({
            baseURL: BASE_URL,
            apiVersion: API_VERSION,
            apiKey: 'configured-second-client-token',
            maxRetries: 0,
          })
        : firstClient;
      const snapshots = [
        { 'api-key': 'tenant-a-token', 'x-custom': 'preserved' },
        { 'api-key': 'tenant-b-token', 'x-custom': 'preserved' },
      ];
      let reads = 0;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { shared: true },
        get headers() {
          const snapshot = snapshots[reads];
          reads += 1;
          return snapshot;
        },
      };
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const observed: FinalRequestOptions[] = [];
      const releases = new Set<number>();
      const pauseAuthentication = async (received: FinalRequestOptions) => {
        const index = observed.length;
        observed.push(received);
        await vi.waitFor(() => expect(releases.has(index)).toBe(true), { interval: 1 });
      };
      firstClient.observeAuthenticationOptions = pauseAuthentication;
      secondClient.observeAuthenticationOptions = pauseAuthentication;

      const first = firstClient.buildRequest(options);
      const second = secondClient.buildRequest(options);
      expect(observed).toEqual([options, options]);
      expect(reads).toBe(2);

      releases.add(0);
      const firstBuilt = await first;
      releases.add(1);
      const secondBuilt = await second;

      expect(firstBuilt.req.headers.get('api-key')).toBe('tenant-a-token');
      expect(secondBuilt.req.headers.get('api-key')).toBe('tenant-b-token');
      expect(firstBuilt.req.headers.get('x-custom')).toBe('preserved');
      expect(secondBuilt.req.headers.get('x-custom')).toBe('preserved');
      expect(reads).toBe(2);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
    },
  );

  test('keeps shared request options unchanged across overlapping private authentication waits', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
    });
    let credential = 'first-token';
    let reads = 0;
    const rawHeaders = { 'api-key': 'first-token', 'x-custom': 'preserved' };
    Object.defineProperty(rawHeaders, 'api-key', {
      enumerable: true,
      get() {
        reads += 1;
        return credential;
      },
      set(value: string) {
        credential = value;
      },
    });
    const body = { safe: 'payload' };
    const metadata = { source: 'shared request options' };
    const { signal } = new AbortController();
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body,
      headers: rawHeaders,
      __metadata: metadata,
      signal,
    };
    const observed: FinalRequestOptions[] = [];
    const releases = new Set<number>();
    client.observeAuthenticationOptions = async (received) => {
      const index = observed.length;
      observed.push(received);
      await vi.waitFor(() => expect(releases.has(index)).toBe(true), { interval: 1 });
    };

    const first = client.buildRequest(options);
    const duringFirst = options.headers;
    const second = client.buildRequest(options);
    const duringSecond = options.headers;
    expect(observed).toHaveLength(2);
    releases.add(0);
    const firstBuilt = await first;
    const whileSecondWaits = options.headers;
    releases.add(1);
    const secondBuilt = await second;

    expect(duringFirst).toBe(rawHeaders);
    expect(duringSecond).toBe(rawHeaders);
    expect(whileSecondWaits).toBe(rawHeaders);
    expect(options.headers).toBe(rawHeaders);
    expect(observed).toHaveLength(2);
    expect(reads).toBe(2);
    expect(observed[0]).toBe(options);
    expect(observed[1]).toBe(options);
    expect(observed.every((received) => received.__metadata === metadata)).toBe(true);
    expect(observed.every((received) => received.body === body && received.signal === signal)).toBe(true);
    expect(firstBuilt.req.headers.get('api-key')).toBe('first-token');
    expect(secondBuilt.req.headers.get('api-key')).toBe('first-token');

    client.observeAuthenticationOptions = undefined;
    rawHeaders['api-key'] = 'updated-token';
    const reused = await client.buildRequest(options);
    expect(reused.req.headers.get('api-key')).toBe('updated-token');
    expect(reads).toBe(3);
    expect(options.headers).toBe(rawHeaders);
  });

  test.each([
    ['static authentication', 'static-api-key', false] as const,
    ['rotating bearer authentication', 'rotating-entra-token', false] as const,
    ['rotating administrator authentication', 'rotating-entra-token', true] as const,
  ])(
    'preserves prepareOptions WeakMap identity through every protected %s hook',
    async (_description, authentication, admin) => {
      const provider = vi.fn(async () => 'configured-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'configured-static-token' }
          : { azureADTokenProvider: provider, adminAPIKey: 'configured-admin-token' }),
        fetch,
        maxRetries: 0,
      });
      const state = new WeakMap<FinalRequestOptions, { secret: string }>();
      const marker = { secret: 'protected per-request state' };
      const observed: string[] = [];
      let prepared: FinalRequestOptions | undefined;
      client.observePreparedOptions = (options) => {
        prepared = options;
        state.set(options, marker);
      };
      client.observeProtectedHookOptions = (hook, options) => {
        observed.push(hook);
        expect(options).toBe(prepared);
        expect(state.get(options)).toBe(marker);
      };
      const headers = { 'x-custom': 'preserved' };

      await client.request({
        method: 'post',
        path: '/models',
        body: { safe: 'payload' },
        headers,
        __security: { bearerAuth: true, adminAPIKeyAuth: admin },
      });

      const expectedHooks = ['auth'];
      if (authentication === 'rotating-entra-token') {
        expectedHooks.push('bearer');
      }
      if (admin) {
        expectedHooks.push('admin');
      }
      expect(observed).toEqual([...expectedHooks, 'request']);
      expect(prepared?.headers).toBe(headers);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test('keeps the Azure body marker reserved across a reentrant query-header merge', async () => {
    const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const headers = { 'api-key': malformed };
    let nestedFailure: unknown;
    let queryReads = 0;
    const query = {
      get tenant() {
        queryReads += 1;
        try {
          buildHeaders([headers]);
        } catch (error) {
          nestedFailure = error;
        }
        return 'safe-tenant';
      },
    };
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });

    await expectPrivateCredentialFailure(
      () => client.request({ method: 'post', path: '/models', body: { safe: true }, headers, query }),
      malformed,
    );

    expect(queryReads).toBe(1);
    expect(nestedFailure).toBeInstanceOf(TypeError);
    expect((nestedFailure as Error).message).toBe(SAFE_ERROR);
    expect((nestedFailure as Error).message).not.toContain(PRIVATE_CREDENTIAL);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('never leaks an Azure body marker into reentrant non-Azure processing of the same raw object', async () => {
    const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    let reads = 0;
    let nestedFailure: unknown;
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, 'api-key', {
      enumerable: true,
      get() {
        reads += 1;
        if (reads === 1) {
          try {
            buildHeaders([headers]);
          } catch (error) {
            nestedFailure = error;
          }
          return 'safe-outer-token';
        }
        return malformed;
      },
    });
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });

    await client.request({ method: 'post', path: '/models', body: { safe: true }, headers });

    expect(nestedFailure).toBeInstanceOf(TypeError);
    expect((nestedFailure as Error).message).not.toBe(SAFE_ERROR);
    expect((nestedFailure as Error).message).toContain(PRIVATE_CREDENTIAL);
    expect(reads).toBe(2);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('safe-outer-token');
  });

  test('isolates a nested Azure request started while snapshotting an outer credential getter', async () => {
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      maxRetries: 0,
    });
    let reads = 0;
    let nested: ReturnType<AzureOpenAI['buildRequest']> | undefined;
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, 'api-key', {
      enumerable: true,
      get() {
        reads += 1;
        if (reads === 1) {
          nested = client.buildRequest({
            method: 'post',
            path: '/models',
            body: { nested: true },
            headers: { 'api-key': 'nested-token' },
          });
          return 'tenant-a-token';
        }
        return 'tenant-b-token';
      },
    });

    const outer = client.buildRequest({
      method: 'post',
      path: '/models',
      body: { outer: true },
      headers,
    });
    if (!nested) {
      throw new Error('Expected the outer credential getter to start the nested request.');
    }
    const [outerBuilt, nestedBuilt] = await Promise.all([outer, nested]);

    expect(outerBuilt.req.headers.get('api-key')).toBe('tenant-a-token');
    expect(nestedBuilt.req.headers.get('api-key')).toBe('nested-token');
    expect(reads).toBe(1);
    expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toBeUndefined();
  });

  test('isolates concurrent body snapshots for distinct mutable raw header objects', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
    });
    const firstHeaders = { 'api-key': 'first-token' };
    const secondHeaders = { 'api-key': 'second-token' };
    const firstOptions: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { first: true },
      headers: firstHeaders,
    };
    const secondOptions: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { second: true },
      headers: secondHeaders,
    };
    const observed: FinalRequestOptions[] = [];
    let released = false;
    client.observeAuthenticationOptions = async (received) => {
      observed.push(received);
      await vi.waitFor(() => expect(released).toBe(true), { interval: 1 });
    };

    const first = client.buildRequest(firstOptions);
    const second = client.buildRequest(secondOptions);
    expect(observed).toHaveLength(2);
    expect(firstOptions.headers).toBe(firstHeaders);
    expect(secondOptions.headers).toBe(secondHeaders);
    released = true;
    const [firstBuilt, secondBuilt] = await Promise.all([first, second]);

    expect(firstBuilt.req.headers.get('api-key')).toBe('first-token');
    expect(secondBuilt.req.headers.get('api-key')).toBe('second-token');
    expect(firstOptions.headers).toBe(firstHeaders);
    expect(secondOptions.headers).toBe(secondHeaders);
  });

  test.each([
    ['the same Azure client', false],
    ['different Azure clients', true],
  ] as const)(
    'isolates overlapping tenant credentials in one mutable header record across %s',
    async (_description, differentClients) => {
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const firstClient = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-first-client-token',
        fetch,
        maxRetries: 0,
      });
      const secondClient = differentClients
        ? new ProtectedHookAzure({
            baseURL: BASE_URL,
            apiVersion: API_VERSION,
            apiKey: 'configured-second-client-token',
            fetch,
            maxRetries: 0,
          })
        : firstClient;
      const sharedHeaders = { 'api-key': 'tenant-a-token', 'x-custom': 'preserved' };
      const firstOptions: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { tenant: 'a' },
        headers: sharedHeaders,
      };
      const secondOptions: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { tenant: 'b' },
        headers: sharedHeaders,
      };
      const observed = new Set<FinalRequestOptions>();
      const releases = new Set<FinalRequestOptions>();
      const pauseAuthentication = async (options: FinalRequestOptions) => {
        observed.add(options);
        await vi.waitFor(() => expect(releases.has(options)).toBe(true), { interval: 1 });
      };
      firstClient.observeAuthenticationOptions = pauseAuthentication;
      secondClient.observeAuthenticationOptions = pauseAuthentication;

      const first = firstClient.buildRequest(firstOptions);
      sharedHeaders['api-key'] = 'tenant-b-token';
      const second = secondClient.buildRequest(secondOptions);
      expect(observed.size).toBe(2);

      releases.add(secondOptions);
      const secondBuilt = await second;
      releases.add(firstOptions);
      const firstBuilt = await first;

      expect(firstBuilt.req.headers.get('api-key')).toBe('tenant-a-token');
      expect(secondBuilt.req.headers.get('api-key')).toBe('tenant-b-token');
      expect(firstBuilt.req.headers.get('x-custom')).toBe('preserved');
      expect(secondBuilt.req.headers.get('x-custom')).toBe('preserved');
      expect(firstOptions.headers).toBe(sharedHeaders);
      expect(secondOptions.headers).toBe(sharedHeaders);
      expect(sharedHeaders['api-key']).toBe('tenant-b-token');
    },
  );

  test.each(['genuine', 'spread clone', 'assigned clone'] as const)(
    'isolates overlapping requests when a protected hook reuses the same %s authentication carrier',
    async (representation) => {
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        maxRetries: 0,
      });
      const genuine = buildAzureAuthenticationHeaders([['api-key', 'configured-cached-token']]);
      if (representation === 'spread clone') {
        client.reusedAuthenticationCarrier = { ...genuine };
      } else if (representation === 'assigned clone') {
        const copied = {};
        client.reusedAuthenticationCarrier = Object.assign(copied, genuine);
      } else {
        client.reusedAuthenticationCarrier = genuine;
      }
      const headers = { 'api-key': 'tenant-a-token' };
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { shared: true },
        headers,
      };

      const first = client.buildRequest(options);
      headers['api-key'] = 'tenant-b-token';
      const second = client.buildRequest(options);
      const [firstBuilt, secondBuilt] = await Promise.all([first, second]);

      expect(firstBuilt.req.headers.get('api-key')).toBe('tenant-a-token');
      expect(secondBuilt.req.headers.get('api-key')).toBe('tenant-b-token');
      expect(options.headers).toBe(headers);
    },
  );

  test.each([
    ['the same Azure client', false],
    ['different Azure clients', true],
  ] as const)(
    'isolates mutated tenant credentials when %s concurrently reuse the same request options',
    async (_description, differentClients) => {
      const firstClient = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-first-client-token',
        maxRetries: 0,
      });
      const secondClient = differentClients
        ? new ProtectedHookAzure({
            baseURL: BASE_URL,
            apiVersion: API_VERSION,
            apiKey: 'configured-second-client-token',
            maxRetries: 0,
          })
        : firstClient;
      const headers = { 'api-key': 'tenant-a-token' };
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { shared: true },
        headers,
      };
      const observed: FinalRequestOptions[] = [];
      const releases = new Set<number>();
      const pauseAuthentication = async (received: FinalRequestOptions) => {
        const index = observed.length;
        observed.push(received);
        await vi.waitFor(() => expect(releases.has(index)).toBe(true), { interval: 1 });
      };
      firstClient.observeAuthenticationOptions = pauseAuthentication;
      secondClient.observeAuthenticationOptions = pauseAuthentication;

      const first = firstClient.buildRequest(options);
      headers['api-key'] = 'tenant-b-token';
      const second = secondClient.buildRequest(options);
      expect(observed).toEqual([options, options]);

      releases.add(1);
      const secondBuilt = await second;
      releases.add(0);
      const firstBuilt = await first;

      expect(firstBuilt.req.headers.get('api-key')).toBe('tenant-a-token');
      expect(secondBuilt.req.headers.get('api-key')).toBe('tenant-b-token');
      expect(options.headers).toBe(headers);
      expect(headers['api-key']).toBe('tenant-b-token');
    },
  );

  test.each([
    ['a configurable read-only own hook', true, false, false],
    ['a nonconfigurable writable own hook', false, true, false],
    ['a nonextensible configurable own hook', true, false, true],
    ['a nonextensible nonconfigurable writable own hook', false, true, true],
  ] as const)(
    'restores the exact authentication descriptor for %s',
    async (_description, configurable, writable, preventExtensions) => {
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        maxRetries: 0,
      });
      Object.defineProperty(client, 'authHeaders', {
        configurable,
        enumerable: true,
        value: Object.getOwnPropertyDescriptor(ProtectedHookAzure.prototype, 'authHeaders')?.value,
        writable,
      });
      if (preventExtensions) {
        Object.preventExtensions(client);
      }
      const descriptor = Object.getOwnPropertyDescriptor(client, 'authHeaders');

      const built = await client.buildRequest({
        method: 'post',
        path: '/models',
        body: { safe: true },
        headers: { 'api-key': 'request-token' },
      });

      expect(built.req.headers.get('api-key')).toBe('request-token');
      expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toEqual(descriptor);
    },
  );

  test.each(['nonextensible inherited hook', 'nonconfigurable read-only own hook'] as const)(
    'fails closed before reading credentials when authentication protection cannot replace a %s',
    async (representation) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        maxRetries: 0,
      });
      if (representation === 'nonextensible inherited hook') {
        Object.preventExtensions(client);
      } else {
        Object.defineProperty(client, 'authHeaders', {
          configurable: false,
          value: Object.getOwnPropertyDescriptor(ProtectedHookAzure.prototype, 'authHeaders')?.value,
          writable: false,
        });
      }
      const descriptor = Object.getOwnPropertyDescriptor(client, 'authHeaders');

      await expectPrivateCredentialFailure(
        () =>
          client.buildRequest({
            method: 'post',
            path: '/models',
            body: { safe: true },
            headers: { 'api-key': credential },
          }),
        credential,
      );

      expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toEqual(descriptor);
    },
  );

  test('preserves an intentional protected-hook authentication method replacement', async () => {
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      maxRetries: 0,
    });
    const replacement = Object.getOwnPropertyDescriptor(ProtectedHookAzure.prototype, 'authHeaders')?.value;
    client.observeProtectedHookOptions = (hook) => {
      if (hook === 'auth') {
        expect(Reflect.get(client, 'authHeaders')).toBe(replacement);
        expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toBeUndefined();
        Object.defineProperty(client, 'authHeaders', {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: false,
        });
      }
    };

    const built = await client.buildRequest({
      method: 'post',
      path: '/models',
      body: { safe: true },
      headers: { 'api-key': 'request-token' },
    });

    expect(built.req.headers.get('api-key')).toBe('request-token');
    expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toEqual({
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: false,
    });
  });

  test('releases failed private body snapshots before the same caller headers are reused', async () => {
    const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
    const headers = { 'api-key': malformed };
    const client = new AzureOpenAI({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
    });
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { safe: true },
      headers,
    };

    await expectPrivateCredentialFailure(() => client.buildRequest(options), malformed);
    expect(options.headers).toBe(headers);
    headers['api-key'] = 'safe-reused-token';
    const reused = await client.buildRequest(options);
    expect(reused.req.headers.get('api-key')).toBe('safe-reused-token');
    expect(options.headers).toBe(headers);
  });

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

  test.each([
    ['static API key', 'static-api-key', 'api-key', false] as const,
    ['rotating bearer token', 'rotating-entra-token', 'authorization', false] as const,
    ['rotating admin token', 'rotating-entra-token', 'authorization', true] as const,
  ])(
    'preserves an intrinsic post-hook Headers identity and transport metadata for %s',
    async (_description, authentication, name, admin) => {
      const credential = name === 'api-key' ? 'hook-static-token' : 'Bearer hook-rotating-token';
      const injected = new Headers({ [name]: credential, 'x-custom': 'preserved' });
      const metadata = new WeakMap<Headers, { source: string }>();
      const marker = { source: 'protected request hook' };
      metadata.set(injected, marker);

      let transportMetadata: { source: string } | undefined;
      const fetch = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
        if (init?.headers instanceof Headers) {
          transportMetadata = metadata.get(init.headers);
        }
        return Response.json({ ok: true });
      });
      const provider = vi.fn(async () => 'configured-provider-token');
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'configured-static-token' }
          : { azureADTokenProvider: provider, adminAPIKey: 'configured-admin-token' }),
        fetch,
        maxRetries: 0,
      });
      client.injectedHeaders = injected;

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: admin },
      });

      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBe(injected);
      expect(transportMetadata).toBe(marker);
      expect(injected.get(name)).toBe(credential);
      expect(injected.get('x-custom')).toBe('preserved');
      expect(request?.redirect).toBe(name === 'api-key' ? 'manual' : undefined);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['static API key', 'static-api-key', 'api-key', false] as const,
    ['rotating bearer token', 'rotating-entra-token', 'authorization', false] as const,
    ['rotating admin token', 'rotating-entra-token', 'authorization', true] as const,
  ])(
    'preserves an unmodified inherited Headers subclass identity and metadata for %s',
    async (_description, authentication, name, admin) => {
      const trackedPrototype = Object.create(Headers.prototype) as object;
      const nestedPrototype = Object.create(trackedPrototype) as object;
      const credential = name === 'api-key' ? 'subclass-static-token' : 'Bearer subclass-rotating-token';
      const injected = Object.setPrototypeOf(
        new Headers({ [name]: credential, 'x-custom': 'preserved' }),
        nestedPrototype,
      );
      const metadata = new WeakMap<Headers, { source: string }>();
      const marker = { source: 'trusted transport metadata' };
      metadata.set(injected, marker);

      let transportMetadata: { source: string } | undefined;
      const fetch = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
        if (init?.headers instanceof Headers) {
          transportMetadata = metadata.get(init.headers);
        }
        return Response.json({ ok: true });
      });
      const provider = vi.fn(async () => 'configured-provider-token');
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'configured-static-token' }
          : { azureADTokenProvider: provider, adminAPIKey: 'configured-admin-token' }),
        fetch,
        maxRetries: 0,
      });
      client.injectedHeaders = injected;

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: admin },
      });

      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBe(injected);
      expect(transportMetadata).toBe(marker);
      expect(injected.get(name)).toBe(credential);
      expect(injected.get('x-custom')).toBe('preserved');
      expect(request?.redirect).toBe(name === 'api-key' ? 'manual' : undefined);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'has', 'entries'] as const).flatMap((operation) =>
      (['prototype accessor', 'ancestor accessor', 'instance accessor'] as const).map((override) => ({
        operation,
        override,
      })),
    ),
  )(
    'does not preserve or invoke an overridden Headers subclass $override ($operation)',
    async ({ operation, override }) => {
      let accessorReads = 0;
      const trackedPrototype = Object.create(Headers.prototype) as object;
      const nestedPrototype = Object.create(trackedPrototype) as object;
      const injected = Object.setPrototypeOf(
        new Headers({ 'api-key': 'safe-subclass-token', 'x-custom': 'preserved' }),
        nestedPrototype,
      );
      let target: object;
      if (override === 'instance accessor') {
        target = injected;
      } else if (override === 'ancestor accessor') {
        target = trackedPrototype;
      } else {
        target = nestedPrototype;
      }
      Object.defineProperty(target, operation, {
        configurable: true,
        get() {
          accessorReads += 1;
          if (operation === 'entries') {
            throw new Error(`${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`);
          }
          return Headers.prototype[operation];
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
      client.injectedHeaders = injected;

      await client.request({ method: 'get', path: '/models' });

      const sent = fetch.mock.calls[0]?.[1]?.headers;
      expect(sent).toBeInstanceOf(Headers);
      expect(sent).not.toBe(injected);
      expect(new Headers(sent).get('api-key')).toBe('safe-subclass-token');
      expect(new Headers(sent).get('x-custom')).toBe('preserved');
      expect(accessorReads).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['static API key', 'static-api-key', 'api-key', false] as const,
    ['rotating bearer token', 'rotating-entra-token', 'authorization', false] as const,
    ['rotating admin token', 'rotating-entra-token', 'authorization', true] as const,
  ])(
    'safely snapshots actual cross-realm undici Headers for %s',
    async (_description, authentication, name, admin) => {
      const credential = name === 'api-key' ? 'realm-static-token' : 'Bearer realm-rotating-token';
      const firstCookie = 'session=first; Expires=Wed, 21 Oct 2015 07:28:00 GMT';
      const secondCookie = 'preference=second; Path=/';
      const injected = createForeignHeaders([
        [name, credential],
        ['x-custom', 'preserved'],
        ['set-cookie', firstCookie],
        ['set-cookie', secondCookie],
      ]);
      expect(injected).not.toBeInstanceOf(Headers);
      const provider = vi.fn(async () => 'configured-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'configured-static-token' }
          : { azureADTokenProvider: provider, adminAPIKey: 'configured-admin-token' }),
        fetch,
        maxRetries: 0,
      });
      client.injectedHeaders = injected;

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: admin },
      });

      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBeInstanceOf(Headers);
      expect(request?.headers).not.toBe(injected);
      const sent = request?.headers as Headers;
      expect(sent.get(name)).toBe(credential);
      expect(sent.get('x-custom')).toBe('preserved');
      expect(sent.getSetCookie()).toEqual([firstCookie, secondCookie]);
      expect(request?.redirect).toBe(name === 'api-key' ? 'manual' : undefined);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each([
    ['static API key', 'static-api-key', 'api-key', false] as const,
    ['rotating bearer token', 'rotating-entra-token', 'authorization', false] as const,
    ['rotating admin token', 'rotating-entra-token', 'authorization', true] as const,
  ])(
    'safely snapshots inherited cross-realm undici Headers subclasses for %s',
    async (_description, authentication, name, admin) => {
      const credential = name === 'api-key' ? 'subclass-static-token' : 'Bearer subclass-rotating-token';
      const values: [string, string][] = [
        [name, credential],
        ['x-custom', 'preserved'],
      ];
      const injected = runInNewContext(
        'class Ancestor extends ForeignHeaders {} class Subclass extends Ancestor {} new Subclass(values)',
        { ForeignHeaders, values },
      ) as Headers;
      expect(injected).not.toBeInstanceOf(Headers);
      expect(
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(injected), Symbol.toStringTag),
      ).toBeUndefined();

      const provider = vi.fn(async () => 'configured-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'configured-static-token' }
          : { azureADTokenProvider: provider, adminAPIKey: 'configured-admin-token' }),
        fetch,
        maxRetries: 0,
      });
      client.injectedHeaders = injected;

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: admin },
      });

      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBeInstanceOf(Headers);
      expect(request?.headers).not.toBe(injected);
      expect(new Headers(request?.headers).get(name)).toBe(credential);
      expect(new Headers(request?.headers).get('x-custom')).toBe('preserved');
      expect(request?.redirect).toBe(name === 'api-key' ? 'manual' : undefined);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each(
    (['get', 'has', 'entries', 'iterator'] as const).flatMap((operation) =>
      (['instance accessor', 'subclass accessor', 'ancestor accessor', 'subclass method'] as const).map(
        (override) => ({ operation, override }),
      ),
    ),
  )(
    'rejects an overridden cross-realm Headers subclass $override ($operation) without invoking it',
    async ({ operation, override }) => {
      const values: [string, string][] = [
        ['api-key', 'safe-subclass-token'],
        ['x-custom', 'preserved'],
      ];
      const injected = runInNewContext(
        'class Ancestor extends ForeignHeaders {} class Subclass extends Ancestor {} new Subclass(values)',
        { ForeignHeaders, values },
      ) as Headers;
      const subclass = Object.getPrototypeOf(injected) as object;
      const ancestor = Object.getPrototypeOf(subclass) as object;
      let target: object = subclass;
      if (override === 'instance accessor') {
        target = injected;
      } else if (override === 'ancestor accessor') {
        target = ancestor;
      }
      const key = operation === 'iterator' ? Symbol.iterator : operation;
      let operationReads = 0;
      const maliciousOperation = () => {
        operationReads += 1;
        throw new Error(`${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`);
      };
      Object.defineProperty(target, key, {
        configurable: true,
        ...(override === 'subclass method' ? { value: maliciousOperation } : { get: maliciousOperation }),
      });

      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });

      await expectPrivateCredentialFailure(
        () => client.invokeProtectedFetch(injected),
        `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`,
      );
      expect(operationReads).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([false, true] as const)(
    'snapshots cross-realm credential iteration once (malformed first: %s)',
    async (malformedFirst) => {
      const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const safe = 'safe-realm credential\tvalue\u00FF';
      const injected = createForeignHeaders([['api-key', 'placeholder']]);
      const originalPrototype = Object.getPrototypeOf(injected) as object;
      const prototype = Object.create(null) as object;
      for (const name of Reflect.ownKeys(originalPrototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(originalPrototype, name);
        if (descriptor) {
          Object.defineProperty(prototype, name, descriptor);
        }
      }
      let reads = 0;
      Object.defineProperty(prototype, Symbol.iterator, {
        configurable: true,
        value() {
          reads += 1;
          const credential = malformedFirst || reads !== 1 ? malformed : safe;
          return [
            ['api-key', credential],
            ['x-custom', 'preserved'],
          ][Symbol.iterator]();
        },
      });
      Object.setPrototypeOf(injected, prototype);
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-token',
        fetch,
        maxRetries: 0,
      });

      if (malformedFirst) {
        await expectPrivateCredentialFailure(() => client.invokeProtectedFetch(injected), malformed);
        expect(fetch).not.toHaveBeenCalled();
      } else {
        await client.invokeProtectedFetch(injected);
        const request = fetch.mock.calls[0]?.[1];
        expect(request?.headers).not.toBe(injected);
        expect(new Headers(request?.headers).get('api-key')).toBe(safe);
        expect(new Headers(request?.headers).get('x-custom')).toBe('preserved');
      }
      expect(reads).toBe(1);
    },
  );

  test('rejects a spoofed cross-realm Headers iterator accessor without invoking it', async () => {
    let getterReads = 0;
    const prototype = Object.create(null) as object;
    Object.defineProperties(prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: {
        get() {
          getterReads += 1;
          throw new Error(`${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`);
        },
      },
      entries: { value: () => [][Symbol.iterator]() },
      get: { value: () => null },
      has: { value: () => false },
    });
    const injected = Object.create(prototype) as Headers;
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'configured-token',
      fetch,
      maxRetries: 0,
    });

    await expectPrivateCredentialFailure(
      () => client.invokeProtectedFetch(injected),
      `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`,
    );
    expect(getterReads).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('bounds a cross-realm Headers iterator before materializing untrusted entries', async () => {
    const injected = createForeignHeaders([['api-key', 'safe-token']]);
    const prototype = Object.create(Object.getPrototypeOf(injected)) as object;
    Object.defineProperties(prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: {
        value: () =>
          Array.from({ length: 1025 }, (_, index) => [`x-header-${index}`, 'safe'])[Symbol.iterator](),
      },
      entries: { value: Object.getPrototypeOf(injected).entries },
      get: { value: Object.getPrototypeOf(injected).get },
      has: { value: Object.getPrototypeOf(injected).has },
    });
    Object.setPrototypeOf(injected, prototype);
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: 'safe-key',
      fetch,
    });
    await expect(client.invokeProtectedFetch(injected)).rejects.toThrow(SAFE_ERROR);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['subclass override', 'own override'] as const)(
    'materializes a mutable post-hook Headers %s exactly once before dispatch',
    async (override) => {
      const malformed = `${PRIVATE_CREDENTIAL}\r${PRIVATE_SUFFIX}`;
      let reads = 0;
      const nextEntries = () => {
        reads += 1;
        return new Map([
          ['api-key', reads === 1 ? 'safe-first-token' : malformed],
          ['x-custom', 'preserved'],
        ]).entries();
      };

      const injected = new Headers({ 'api-key': 'placeholder' });
      const operationOwner =
        override === 'subclass override'
          ? Object.getPrototypeOf(Object.setPrototypeOf(injected, Object.create(Headers.prototype)))
          : injected;
      Object.defineProperty(operationOwner, 'entries', {
        configurable: true,
        value: nextEntries,
      });
      Object.defineProperty(operationOwner, Symbol.iterator, {
        configurable: true,
        value: nextEntries,
      });

      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-static-token',
        fetch,
        maxRetries: 0,
      });

      await client.invokeProtectedFetch(injected);

      const validationReads = reads;
      const request = fetch.mock.calls[0]?.[1];
      expect(request?.headers).toBeInstanceOf(Headers);
      expect(request?.headers).not.toBe(injected);
      expect(new Headers(request?.headers).get('api-key')).toBe('safe-first-token');
      expect(new Headers(request?.headers).get('x-custom')).toBe('preserved');
      expect(request?.redirect).toBe('manual');
      expect(validationReads).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

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

  const deferredBoundaryScenarios = (['auth', 'bearer', 'admin'] as const).flatMap((scheme) =>
    [
      { boundary: 'ASCII edge whitespace', credential: ' \tvisible \t ' },
      { boundary: 'internal SP and HTAB', credential: 'in ter\tnal' },
      { boundary: 'valid obs-text', credential: '\u00A0visible\u00A0' },
    ].map(({ boundary, credential }) => ({ scheme, boundary, credential })),
  );

  test.each(deferredBoundaryScenarios)(
    'normalizes deferred $scheme $boundary exactly like native Headers',
    async ({ scheme, credential }) => {
      const expectedName = scheme === 'auth' ? 'api-key' : 'authorization';
      const raw = scheme === 'auth' ? credential : `Bearer ${credential}`;
      const expected = new Headers([[expectedName, raw]]).get(expectedName);
      const provider = vi.fn(async () => credential);
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(scheme === 'auth'
          ? { apiKey: credential }
          : { azureADTokenProvider: provider, adminAPIKey: credential }),
        fetch,
        maxRetries: 0,
      });
      client.mutationScheme = scheme;
      client.mutateCarrier = (headers) => {
        expect(headers.get(expectedName.toUpperCase())).toBe(expected);
        expect(headers.has(expectedName.toUpperCase())).toBe(true);
        expect([...headers.entries()].find(([name]) => name === expectedName)?.[1]).toBe(expected);
        expect([...headers.keys()]).toContain(expectedName);
        expect([...headers.values()]).toContain(expected);
        expect([...headers].find(([name]) => name === expectedName)?.[1]).toBe(expected);
        const observed: string[] = [];
        const iterate = headers.forEach;
        iterate.call(headers, (value, name) => {
          if (name === expectedName) {
            observed.push(value);
          }
        });
        expect(observed).toEqual([expected]);
      };

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(expectedName)).toBe(expected);
      expect(provider).toHaveBeenCalledTimes(scheme === 'auth' ? 0 : 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('normalizes every deferred authentication value before combining duplicates', async () => {
    const first = ' \tfirst \t ';
    const second = '\t second \t';
    const native = new Headers([['api-key', first]]);
    native.append('api-key', second);
    const expected = native.get('api-key');
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new ProtectedHookAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: first,
      fetch,
      maxRetries: 0,
    });
    client.mutateCarrier = (headers) => {
      headers.append('API-KEY', second);
      expect(headers.get('api-key')).toBe(expected);
      expect([...headers.entries()]).toContainEqual(['api-key', expected]);
    };

    await client.request({ method: 'get', path: '/models' });

    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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

  test.each(
    (['bearer', 'admin'] as const).flatMap((scheme) =>
      (['read', 'append', 'set', 'delete', 'null'] as const).map((operation) => ({ scheme, operation })),
    ),
  )(
    'preserves individual protected $scheme Set-Cookie values through deferred $operation',
    async ({ scheme, operation }) => {
      const first = 'session=first; Expires=Wed, 21 Oct 2015 07:28:00 GMT';
      const second = 'preference=second; Path=/';
      const provider = vi.fn(async () => 'safe-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        azureADTokenProvider: provider,
        adminAPIKey: 'safe-admin-token',
        fetch,
        maxRetries: 0,
      });
      client.mutationScheme = scheme;
      client.mutateCarrier = (headers) => {
        headers.append('Set-Cookie', ` ${first} `);
        headers.append('set-cookie', second);
      };
      let expected = [first, second];
      client.inspectAuthenticationCarrier = (carrier) => {
        expect(carrier.values.getSetCookie()).toEqual(expected);
        expect(Object.getOwnPropertyDescriptor(carrier.values, 'getSetCookie')).toBeUndefined();
        expect(
          typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(carrier.values), 'getSetCookie')
            ?.value,
        ).toBe('function');

        if (operation === 'append') {
          carrier.values.append('Set-Cookie', 'third=value');
          expected = [...expected, 'third=value'];
        } else if (operation === 'set') {
          carrier.values.set('set-cookie', 'replacement=value');
          expected = ['replacement=value'];
        } else if (operation === 'delete') {
          carrier.values.delete('SET-COOKIE');
          expected = [];
        } else if (operation === 'null') {
          carrier.nulls.add('set-cookie');
          expected = [];
        }

        expect(carrier.values.getSetCookie()).toEqual(expected);
        const detached = carrier.values.getSetCookie;
        expect(() => detached()).toThrow(TypeError);
      };

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });

      const dispatched = fetch.mock.calls[0]?.[1]?.headers;
      expect(dispatched).toBeInstanceOf(Headers);
      if (dispatched instanceof Headers) {
        expect(dispatched.getSetCookie()).toEqual(expected);
      }
      expect(provider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['auth', 'bearer', 'admin'] as const)(
    'keeps deferred $scheme Headers operations on their native prototype',
    async (scheme) => {
      const configured = 'prototype-credential';
      const expectedName = scheme === 'auth' ? 'api-key' : 'authorization';
      const expected = scheme === 'auth' ? configured : `Bearer ${configured}`;
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
        expect(Object.keys(headers)).toEqual(Object.keys(new Headers()));
        expect({ ...headers }).toEqual({ ...new Headers() });
        const copied = {};
        const native = {};
        expect(Object.assign(copied, headers)).toEqual(Object.assign(native, new Headers()));
        for (const method of [
          'get',
          'getSetCookie',
          'has',
          'entries',
          'keys',
          'values',
          'forEach',
          'append',
          'set',
          'delete',
        ]) {
          expect(Object.getOwnPropertyDescriptor(headers, method)).toBeUndefined();
          expect(typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(headers), method)?.value).toBe(
            'function',
          );
        }
        expect(Object.getOwnPropertyDescriptor(headers, Symbol.iterator)).toBeUndefined();
        expect(new Headers(headers).get(expectedName)).toBe(expected);
        const detached = headers.get;
        expect(() => detached(expectedName)).toThrow(TypeError);
      };

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(expectedName)).toBe(expected);
      expect(provider).toHaveBeenCalledTimes(scheme === 'auth' ? 0 : 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  const coercedCredentialCases = authenticationModes.flatMap((authentication) =>
    (['api-key', 'Authorization'] as const).flatMap((header) =>
      (['object', 'proxy'] as const).flatMap((representation) =>
        (['unsafe serialization', 'safe serialization'] as const).map((direction) => ({
          authentication,
          header,
          representation,
          direction,
        })),
      ),
    ),
  );

  test.each(coercedCredentialCases)(
    '$authentication snapshots $representation $header $direction exactly once',
    async ({ authentication, header, representation, direction }) => {
      const malformed = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const serialized = direction === 'unsafe serialization' ? malformed : 'safe-coerced-token';
      const iterated = direction === 'unsafe serialization' ? 'safe-iterator-value' : malformed;
      let coercions = 0;
      let iteratorReads = 0;
      const source = {
        *[Symbol.iterator](): IterableIterator<string> {
          iteratorReads += 1;
          yield* iterated;
        },
        toString(): string {
          coercions += 1;
          return serialized;
        },
      };
      const credential =
        representation === 'proxy'
          ? new Proxy(source, {
              get(target, property, receiver) {
                return Reflect.get(target, property, receiver);
              },
            })
          : source;
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, header, { enumerable: true, value: credential });
      const provider = vi.fn(async () => 'safe-provider-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        ...(authentication === 'static-api-key'
          ? { apiKey: 'safe-configured-token' }
          : { azureADTokenProvider: provider }),
        fetch,
        maxRetries: 0,
      });
      const operation = () => client.request({ method: 'get', path: '/models', headers });

      if (direction === 'unsafe serialization') {
        await expectPrivateCredentialFailure(operation, malformed);
        expect(fetch).not.toHaveBeenCalled();
      } else {
        await operation();
        expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(header)).toBe(serialized);
        expect(fetch).toHaveBeenCalledTimes(1);
      }

      expect(coercions).toBe(1);
      expect(iteratorReads).toBe(0);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'does not coerce a shadowed $header credential before final overrides',
    async (header) => {
      let coercions = 0;
      const shadowed = {
        *[Symbol.iterator](): IterableIterator<string> {
          yield* 'safe-iterator-value';
        },
        toString(): string {
          coercions += 1;
          return `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
        },
      };
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, { enumerable: true, value: shadowed });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: { [header]: 'safe-final-token' } });

      expect(coercions).toBe(0);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(header)).toBe('safe-final-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  const carrierCloneCases = (['spread', 'assign'] as const).flatMap((clone) =>
    (['auth', 'bearer', 'admin'] as const).map((scheme) => ({ clone, scheme })),
  );

  test.each(carrierCloneCases)(
    'preserves deferred $scheme authentication through a $clone carrier clone',
    async ({ clone, scheme }) => {
      const configured = 'cloned-credential';
      const expectedName = scheme === 'auth' ? 'api-key' : 'authorization';
      const expected = scheme === 'auth' ? configured : `Bearer ${configured}`;
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
      client.cloneAuthenticationCarrier = clone;
      client.mutationScheme = scheme;
      client.mutateCarrier = (headers) => {
        expect(headers).toBeInstanceOf(Headers);
      };

      await client.request({
        method: 'get',
        path: '/models',
        __security: { bearerAuth: true, adminAPIKeyAuth: scheme === 'admin' },
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(expectedName)).toBe(expected);
      expect(provider).toHaveBeenCalledTimes(scheme === 'auth' ? 0 : 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['spread', 'assign'] as const)(
    'preserves an explicit null tombstone through a $clone carrier clone',
    async (clone) => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new ProtectedHookAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'suppressed-credential',
        fetch,
        maxRetries: 0,
      });
      client.cloneAuthenticationCarrier = clone;
      client.mutation = 'auth-null';

      await client.request({ method: 'get', path: '/models' });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('api-key')).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
