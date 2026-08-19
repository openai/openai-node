import { vi } from 'vitest';

import { AzureOpenAI, OpenAIError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

type Authentication = 'static-api-key' | 'rotating-entra-token';
type PublicRoute = 'generic-request' | 'models-list' | 'chat-completion';
type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

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
});
