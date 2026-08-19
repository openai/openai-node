import { vi } from 'vitest';

import OpenAI, { BedrockOpenAI, OpenAIError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import type { Provider } from 'openai/internal/provider';
import { bedrock as dependencyFreeBedrock } from 'openai/providers/bedrock';
import { bedrock as awsBedrock } from 'openai/providers/bedrock/aws';

type Entrypoint = 'dependency-free' | 'AWS' | 'legacy';
type Authentication = 'static' | 'rotating';
type TokenProvider = () => Promise<string>;
type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

const BEDROCK_BASE_URL = 'https://bedrock.example.com/openai/v1';
const SENSITIVE_CREDENTIAL = 'sk-bedrock-private-access-token-6d28';
const SENSITIVE_SUFFIX = 'private-tenant-record-4c91';
const SAFE_ERROR = 'Bedrock bearer credential contains an invalid HTTP header value.';

const entrypoints: readonly Entrypoint[] = ['dependency-free', 'AWS', 'legacy'];
const authenticationModes: readonly Authentication[] = ['static', 'rotating'];
const forbiddenControlCredentials = [
  ...Array.from({ length: 0x20 }, (_, value) => value).filter(
    (value) => ![0x00, 0x09, 0x0a, 0x0d].includes(value),
  ),
  0x7f,
].map((value) => ({
  format: `HTTP control byte 0x${value.toString(16).padStart(2, '0')}`,
  character: String.fromCodePoint(value),
}));

const malformedCredentials = [
  { format: 'line-feed', character: '\n' },
  { format: 'carriage-return', character: '\r' },
  { format: 'carriage-return line-feed', character: '\r\n' },
  { format: 'NUL byte', character: '\0' },
  { format: 'non-ByteString Unicode', character: '\u{1F680}' },
  ...forbiddenControlCredentials,
] as const;

const supportedFieldBytes = [
  { format: 'horizontal tab', character: '\t' },
  { format: 'lowest obsolete-text byte', character: '\u0080' },
  { format: 'highest obsolete-text byte', character: '\u00FF' },
] as const;

const malformedCases = entrypoints.flatMap((entrypoint) =>
  authenticationModes.flatMap((authentication) =>
    malformedCredentials.map(({ format, character }) => ({ entrypoint, authentication, format, character })),
  ),
);

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

type TestLogger = ReturnType<typeof createLogger>;

function createBedrockClient({
  entrypoint,
  authentication,
  credential,
  fetch,
  logger,
  tokenProvider = async () => credential,
}: {
  entrypoint: Entrypoint;
  authentication: Authentication;
  credential: string;
  fetch: Fetch;
  logger?: TestLogger;
  tokenProvider?: TokenProvider;
}): OpenAI {
  const clientOptions = {
    fetch,
    maxRetries: 0,
    logLevel: 'debug' as const,
    ...(logger ? { logger } : {}),
  };

  if (entrypoint === 'legacy') {
    return new BedrockOpenAI({
      baseURL: BEDROCK_BASE_URL,
      ...(authentication === 'static' ? { apiKey: credential } : { bedrockTokenProvider: tokenProvider }),
      ...clientOptions,
    });
  }

  const factory = entrypoint === 'dependency-free' ? dependencyFreeBedrock : awsBedrock;
  const provider = factory({
    region: 'us-east-1',
    baseURL: BEDROCK_BASE_URL,
    ...(authentication === 'static' ? { apiKey: credential } : { tokenProvider }),
  });

  return new OpenAI({ provider, ...clientOptions });
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
    throw new Error('Invalid Bedrock bearer credentials must preserve their native TypeError class.');
  }

  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();

  for (const diagnostic of [failure.message, failure.stack ?? '']) {
    expect(diagnostic).not.toContain(credential);
    expect(diagnostic).not.toContain(SENSITIVE_CREDENTIAL);
    expect(diagnostic).not.toContain(SENSITIVE_SUFFIX);
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
    for (const value of argumentsList) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      expect(serialized).not.toContain(credential);
      expect(serialized).not.toContain(SENSITIVE_CREDENTIAL);
      expect(serialized).not.toContain(SENSITIVE_SUFFIX);
    }
  }
}

describe('Bedrock bearer credential diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test.each(malformedCases)(
    '$entrypoint $authentication rejects a $format credential without exposing its value',
    async ({ entrypoint, authentication, character }) => {
      const credential = SENSITIVE_CREDENTIAL + character + SENSITIVE_SUFFIX;
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const logger = createLogger();
      const tokenProvider = vi.fn(async () => credential);
      const client = createBedrockClient({
        entrypoint,
        authentication,
        credential,
        fetch,
        logger,
        tokenProvider,
      });

      await expectPrivateCredentialFailure(
        () => client.request({ method: 'get', path: '/models' }),
        credential,
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating' ? 1 : 0);
      expectPrivateLogs(logger, credential);
    },
  );

  test.each(entrypoints)(
    'keeps the actual default logger free of a malformed %s credential',
    async (entrypoint) => {
      const credential = `${SENSITIVE_CREDENTIAL}\n${SENSITIVE_SUFFIX}`;
      const debug = vi.spyOn(console, 'debug');
      const info = vi.spyOn(console, 'info');
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = createBedrockClient({
        entrypoint,
        authentication: 'static',
        credential,
        fetch,
      });

      await expectPrivateCredentialFailure(
        () => client.request({ method: 'get', path: '/models' }),
        credential,
      );

      expect(fetch).not.toHaveBeenCalled();
      for (const spy of [debug, info, warn, error]) {
        for (const values of spy.mock.calls) {
          expect(JSON.stringify(values)).not.toContain(SENSITIVE_CREDENTIAL);
          expect(JSON.stringify(values)).not.toContain(SENSITIVE_SUFFIX);
        }
      }
    },
  );

  test.each(entrypoints)(
    'preserves unrelated invalid caller headers for the %s entrypoint',
    async (entrypoint) => {
      const callerValue = 'caller-header\nunrelated-invalid-value';
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = createBedrockClient({
        entrypoint,
        authentication: 'static',
        credential: 'valid-bedrock-secret',
        fetch,
      });

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

  test.each(entrypoints)('preserves legitimate %s credential-provider failures', async (entrypoint) => {
    const originalFailure = new OpenAIError('A legitimate credential provider failed.');
    const tokenProvider = vi.fn(async () => {
      throw originalFailure;
    });
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = createBedrockClient({
      entrypoint,
      authentication: 'rotating',
      credential: 'unused-valid-token',
      tokenProvider,
      fetch,
    });

    let failure: unknown;
    try {
      await client.request({ method: 'get', path: '/models' });
    } catch (error) {
      failure = error;
    }

    if (entrypoint === 'legacy') {
      expect(failure).toBe(originalFailure);
    } else {
      expect(failure).toBeInstanceOf(OpenAIError);
      expect((failure as Error & { cause?: unknown }).cause).toBe(originalFailure);
    }
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(
    ['dependency-free', 'AWS'].flatMap((entrypoint) =>
      authenticationModes.map((authentication) => ({ entrypoint: entrypoint as Entrypoint, authentication })),
    ),
  )(
    'leaves $entrypoint $authentication caller headers and redirect policy untouched',
    async ({ entrypoint, authentication }) => {
      const credential = `${SENSITIVE_CREDENTIAL}\r${SENSITIVE_SUFFIX}`;
      const tokenProvider = vi.fn(async () => credential);
      const factory = entrypoint === 'dependency-free' ? dependencyFreeBedrock : awsBedrock;
      const provider: Provider = factory({
        region: 'us-east-1',
        baseURL: BEDROCK_BASE_URL,
        ...(authentication === 'static' ? { apiKey: credential } : { tokenProvider }),
      });
      const runtime = configureProvider(provider);
      if (!runtime.prepareRequest) {
        throw new Error('Expected the Bedrock runtime to prepare authenticated requests.');
      }
      const { prepareRequest } = runtime;

      const headers = new Headers({ 'x-tenant': 'unrelated-caller-value' });
      const request = { method: 'get', headers, redirect: 'follow' as const };

      await expectPrivateCredentialFailure(
        async () =>
          prepareRequest(request, {
            url: `${BEDROCK_BASE_URL}/models`,
            options: { method: 'get', path: '/models' },
          }),
        credential,
      );

      expect(request.headers).toBe(headers);
      expect([...headers.entries()]).toEqual([['x-tenant', 'unrelated-caller-value']]);
      expect(request.redirect).toBe('follow');
    },
  );

  test.each(
    entrypoints.flatMap((entrypoint) =>
      authenticationModes.flatMap((authentication) =>
        supportedFieldBytes.map(({ format, character }) => ({
          entrypoint,
          authentication,
          format,
          character,
        })),
      ),
    ),
  )(
    '$entrypoint $authentication preserves a valid $format bearer credential',
    async ({ entrypoint, authentication, character }) => {
      const credential = `valid-bedrock${character}credential`;
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const logger = createLogger();
      const tokenProvider = vi.fn(async () => credential);
      const client = createBedrockClient({
        entrypoint,
        authentication,
        credential,
        fetch,
        logger,
        tokenProvider,
      });

      await client.request({ method: 'get', path: '/models' });

      const [, options] = fetch.mock.calls[0] ?? [];
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${credential}`);
      expect(options?.redirect).toBe('manual');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating' ? 1 : 0);
    },
  );

  test.each(
    entrypoints.flatMap((entrypoint) =>
      authenticationModes.map((authentication) => ({ entrypoint, authentication })),
    ),
  )(
    'preserves valid $entrypoint $authentication authorization and redirect protection',
    async ({ entrypoint, authentication }) => {
      const credential = 'valid-bedrock-secret-73be';
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const tokenProvider = vi.fn(async () => credential);
      const client = createBedrockClient({
        entrypoint,
        authentication,
        credential,
        tokenProvider,
        fetch,
      });

      await client.request({ method: 'get', path: '/models' });

      const [, options] = fetch.mock.calls[0] ?? [];
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${credential}`);
      expect(options?.redirect).toBe('manual');
      expect(tokenProvider).toHaveBeenCalledTimes(authentication === 'rotating' ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
