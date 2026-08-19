import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { vi } from 'vitest';

import OpenAI, { OAuthError, OpenAIError } from 'openai';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import type { WorkloadIdentity } from 'openai/auth/types';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

const OAUTH_URL = 'https://auth.openai.com/oauth/token';
const ACCESS_SECRET = 'private-openai-access-token-44b9';
const PRIVATE_PATIENT = 'private-patient-record-c7e1';
const SAFE_ERROR = "Token exchange response missing 'access_token' field";

type Surface = 'direct-auth' | 'public-client';
type TokenType = WorkloadIdentity['provider']['tokenType'];

const surfaces: readonly Surface[] = ['direct-auth', 'public-client'];
const tokenTypes: readonly TokenType[] = ['jwt', 'id'];
const malformedCharacters = [
  ...Array.from({ length: 0x20 }, (_, code) => code)
    .filter((code) => code !== 0x09)
    .map((code) => ({ name: 'C0 control', code, character: String.fromCodePoint(code) })),
  { name: 'DEL', code: 0x7f, character: String.fromCodePoint(0x7f) },
  { name: 'non-ByteString Unicode', code: 0x01_00, character: String.fromCodePoint(0x01_00) },
  { name: 'astral Unicode', code: 0x01_f6_80, character: String.fromCodePoint(0x01_f6_80) },
  { name: 'unpaired surrogate', code: 0xd8_00, character: String.fromCodePoint(0xd8_00) },
  { name: 'carriage-return line-feed', code: -1, character: String.fromCodePoint(0x0d, 0x0a) },
] as const;
const malformedCases = surfaces.flatMap((surface) =>
  tokenTypes.flatMap((tokenType) =>
    malformedCharacters.map(({ name, code, character }) => ({ surface, tokenType, name, code, character })),
  ),
);
const trailingHttpWhitespace = [
  { name: 'single trailing space', suffix: ' ' },
  { name: 'single trailing horizontal tab', suffix: String.fromCodePoint(0x09) },
  { name: 'repeated trailing spaces', suffix: '   ' },
  { name: 'repeated trailing horizontal tabs', suffix: String.fromCodePoint(0x09, 0x09) },
  { name: 'mixed trailing HTTP whitespace', suffix: [' ', String.fromCodePoint(0x09), ' '].join('') },
] as const;
const trailingWhitespaceCases = surfaces.flatMap((surface) =>
  tokenTypes.flatMap((tokenType) =>
    trailingHttpWhitespace.map(({ name, suffix }) => ({ surface, tokenType, name, suffix })),
  ),
);
const leadingHttpWhitespace = trailingHttpWhitespace.map(({ name, suffix }) => ({
  name: name.replace('trailing', 'leading'),
  prefix: suffix,
}));
const leadingWhitespaceCases = surfaces.flatMap((surface) =>
  tokenTypes.flatMap((tokenType) =>
    leadingHttpWhitespace.map(({ name, prefix }) => ({ surface, tokenType, name, prefix })),
  ),
);
const validTokens = [
  { name: 'ordinary bearer token', token: 'safe-access-token-0ac8' },
  { name: 'horizontal tab', token: ['safe', String.fromCodePoint(0x09), 'access-token'].join('') },
  { name: 'space', token: 'safe access-token' },
  { name: 'lowest obs-text', token: ['safe', String.fromCodePoint(0x80), 'token'].join('') },
  { name: 'highest obs-text', token: ['safe', String.fromCodePoint(0xff), 'token'].join('') },
  { name: 'leading non-breaking space', token: [String.fromCodePoint(0xa0), 'safe-access-token'].join('') },
  { name: 'trailing non-breaking space', token: ['safe-access-token', String.fromCodePoint(0xa0)].join('') },
] as const;

function oauthResponse(accessToken: string, expiresIn = 3600): Response {
  return Response.json({
    access_token: accessToken,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'Bearer',
    expires_in: expiresIn,
  });
}

function accessorResponse(readAccessToken: () => unknown, useProxy = false): Response {
  const payload: { access_token: unknown; expires_in: number } = {
    access_token: undefined,
    expires_in: 3600,
  };
  const body = useProxy
    ? new Proxy(payload, {
        get(target, property, receiver) {
          return property === 'access_token' ? readAccessToken() : Reflect.get(target, property, receiver);
        },
      })
    : Object.defineProperty(payload, 'access_token', {
        enumerable: true,
        get: readAccessToken,
      });
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'json', { value: async () => body });
  return response;
}

function createHarness(accessToken: string, tokenType: TokenType = 'jwt') {
  const subjectToken = vi.fn(async () => 'external-subject-token');
  const exchange = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => oauthResponse(accessToken));
  const api = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
    Response.json({ object: 'list', data: [] }),
  );
  const fetch = vi.fn(async (url: RequestInfo, init?: RequestInit) =>
    String(url) === OAUTH_URL ? exchange(url, init) : api(url, init),
  );
  const config: WorkloadIdentity = {
    identityProviderId: 'safe-identity-provider',
    serviceAccountId: 'safe-service-account',
    provider: { tokenType, getToken: subjectToken },
  };

  return { config, fetch, exchange, api, subjectToken };
}

type Harness = ReturnType<typeof createHarness>;

function createPublicClient(harness: Harness, logger?: ReturnType<typeof createLogger>): OpenAI {
  return new OpenAI({
    apiKey: null,
    workloadIdentity: harness.config,
    fetch: harness.fetch,
    maxRetries: 0,
    logLevel: logger ? 'debug' : 'off',
    ...(logger ? { logger } : {}),
  });
}

function createLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function operationFor(surface: Surface, harness: Harness): () => Promise<unknown> {
  if (surface === 'direct-auth') {
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);
    return () => auth.getToken();
  }

  const client = createPublicClient(harness);
  return () => client.models.list();
}

async function expectPrivateFailure(
  run: () => Promise<unknown>,
  accessToken: string,
  surface: Surface,
): Promise<Error> {
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(OpenAIError);
  if (!(failure instanceof OpenAIError)) {
    throw new Error(`Invalid ${surface} OAuth access tokens must preserve the existing SDK error class.`);
  }

  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();

  let current: unknown = failure;
  while (current instanceof Error) {
    for (const diagnostic of [current.message, current.stack ?? '']) {
      expect(diagnostic).not.toContain(accessToken);
      expect(diagnostic).not.toContain(ACCESS_SECRET);
      expect(diagnostic).not.toContain(PRIVATE_PATIENT);
    }
    current = (current as Error & { cause?: unknown }).cause;
  }

  return failure;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

describe('workload identity OAuth access-token confidentiality and integrity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test.each(malformedCases)(
    '$surface rejects $tokenType $name U+$code before caching or attaching the bearer credential',
    async ({ surface, tokenType, character }) => {
      const token = [ACCESS_SECRET, character, PRIVATE_PATIENT].join('');
      const harness = createHarness(token, tokenType);

      await expectPrivateFailure(operationFor(surface, harness), token, surface);

      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.subjectToken).toHaveBeenCalledTimes(1);
      expect(harness.api).not.toHaveBeenCalled();
      expect(harness.exchange.mock.calls[0]?.[1]?.redirect).toBe('manual');
    },
  );

  test.each(
    surfaces.flatMap((surface) =>
      tokenTypes.flatMap((tokenType) =>
        [false, true].flatMap((useProxy) =>
          [1, 3].map((safeReads) => ({ surface, tokenType, useProxy, safeReads })),
        ),
      ),
    ),
  )(
    '$surface snapshots a $tokenType accessor once before unsafe read $safeReads (proxy=$useProxy)',
    async ({ surface, tokenType, useProxy, safeReads }) => {
      const safe = 'safe-one-read-access-token';
      const unsafe = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
      const read = vi.fn(() => (read.mock.calls.length <= safeReads ? safe : unsafe));
      const harness = createHarness(safe, tokenType);
      harness.exchange.mockResolvedValueOnce(accessorResponse(read, useProxy));
      const operation = operationFor(surface, harness);

      await expect(operation()).resolves.toBeDefined();
      await expect(operation()).resolves.toBeDefined();
      expect(read).toHaveBeenCalledTimes(1);
      expect(harness.exchange).toHaveBeenCalledTimes(1);
      if (surface === 'public-client') {
        expect(harness.api).toHaveBeenCalledTimes(2);
        for (const [, init] of harness.api.mock.calls) {
          expect(new Headers(init?.headers).get('authorization')).toBe(['Bearer ', safe].join(''));
        }
      }
    },
  );

  test.each(
    surfaces.flatMap((surface) =>
      tokenTypes.flatMap((tokenType) => [false, true].map((useProxy) => ({ surface, tokenType, useProxy }))),
    ),
  )(
    '$surface rejects the first unsafe $tokenType accessor snapshot even when later reads become safe (proxy=$useProxy)',
    async ({ surface, tokenType, useProxy }) => {
      const unsafe = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
      const read = vi.fn().mockReturnValueOnce(unsafe).mockReturnValue('safe-later-access-token');
      const harness = createHarness('unused-safe-token', tokenType);
      harness.exchange.mockResolvedValueOnce(accessorResponse(read, useProxy));

      await expectPrivateFailure(operationFor(surface, harness), unsafe, surface);
      expect(read).toHaveBeenCalledTimes(1);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  test.each(surfaces)('%s retries after rejecting an unsafe one-read accessor snapshot', async (surface) => {
    const unsafe = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
    const read = vi.fn().mockReturnValueOnce(unsafe).mockReturnValue('safe-recovered-token');
    const harness = createHarness('unused-safe-token');
    harness.exchange.mockResolvedValue(accessorResponse(read, true));
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, unsafe, surface);
    await expect(operation()).resolves.toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.api).toHaveBeenCalledTimes(surface === 'public-client' ? 1 : 0);
  });

  test.each(surfaces)(
    '%s preserves the original accessor exception without additional reads',
    async (surface) => {
      const original = new OpenAIError('Custom OAuth accessor failed safely.');
      const read = vi.fn(() => {
        throw original;
      });
      const harness = createHarness('unused-safe-token');
      harness.exchange.mockResolvedValueOnce(accessorResponse(read));

      await expect(operationFor(surface, harness)()).rejects.toBe(original);
      expect(read).toHaveBeenCalledTimes(1);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  test('shares one failed accessor read across concurrent refreshes and recovers', async () => {
    const unsafe = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
    const read = vi.fn().mockReturnValueOnce(unsafe).mockReturnValue('unsafe-later-value');
    const harness = createHarness('unused-safe-token');
    harness.exchange
      .mockResolvedValueOnce(accessorResponse(read, true))
      .mockResolvedValueOnce(oauthResponse('safe-concurrent-recovery'));
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

    const attempts = await Promise.allSettled(Array.from({ length: 24 }, async () => auth.getToken()));

    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.exchange).toHaveBeenCalledTimes(1);
    await expect(auth.getToken()).resolves.toBe('safe-concurrent-recovery');
    expect(harness.exchange).toHaveBeenCalledTimes(2);
  });

  test.each(leadingWhitespaceCases)(
    '$surface rejects $tokenType $name before caching or attaching the bearer credential',
    async ({ surface, tokenType, prefix }) => {
      const token = [prefix, ACCESS_SECRET, PRIVATE_PATIENT].join('');
      const harness = createHarness(token, tokenType);

      await expectPrivateFailure(operationFor(surface, harness), token, surface);

      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.subjectToken).toHaveBeenCalledTimes(1);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  test.each(trailingWhitespaceCases)(
    '$surface rejects $tokenType $name before header normalization can rewrite the bearer',
    async ({ surface, tokenType, suffix }) => {
      const token = [ACCESS_SECRET, PRIVATE_PATIENT, suffix].join('');
      const harness = createHarness(token, tokenType);

      expect(new Headers({ authorization: ['Bearer ', token].join('') }).get('authorization')).toBe(
        ['Bearer ', ACCESS_SECRET, PRIVATE_PATIENT].join(''),
      );
      await expectPrivateFailure(operationFor(surface, harness), token, surface);

      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.subjectToken).toHaveBeenCalledTimes(1);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  test.each(
    surfaces.flatMap((surface) =>
      leadingHttpWhitespace.slice(0, 2).map(({ name, prefix }) => ({ surface, name, prefix })),
    ),
  )('$surface never caches a bearer beginning in $name', async ({ surface, prefix }) => {
    const token = [prefix, ACCESS_SECRET, PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expectPrivateFailure(operation, token, surface);

    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.subjectToken).toHaveBeenCalledTimes(2);
    expect(harness.api).not.toHaveBeenCalled();
  });

  test.each(surfaces)('recovers after rejecting a leading-whitespace %s bearer', async (surface) => {
    const token = [String.fromCodePoint(0x09), ACCESS_SECRET, PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('safe-replacement-token'));
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expect(operation()).resolves.toBeDefined();
    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.api).toHaveBeenCalledTimes(surface === 'public-client' ? 1 : 0);
  });

  test.each(
    surfaces.flatMap((surface) =>
      trailingHttpWhitespace.slice(0, 2).map(({ name, suffix }) => ({ surface, name, suffix })),
    ),
  )('$surface never caches a bearer ending in $name', async ({ surface, suffix }) => {
    const token = [ACCESS_SECRET, PRIVATE_PATIENT, suffix].join('');
    const harness = createHarness(token);
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expectPrivateFailure(operation, token, surface);

    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.subjectToken).toHaveBeenCalledTimes(2);
    expect(harness.api).not.toHaveBeenCalled();
  });

  test.each(surfaces)('recovers after rejecting a trailing-whitespace %s bearer', async (surface) => {
    const token = [ACCESS_SECRET, PRIVATE_PATIENT, String.fromCodePoint(0x09)].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('safe-replacement-token'));
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expect(operation()).resolves.toBeDefined();
    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.api).toHaveBeenCalledTimes(surface === 'public-client' ? 1 : 0);
  });

  test.each(surfaces)('never caches malformed access tokens across repeated %s calls', async (surface) => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expectPrivateFailure(operation, token, surface);

    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.subjectToken).toHaveBeenCalledTimes(2);
    expect(harness.api).not.toHaveBeenCalled();
  });

  test.each(surfaces)('recovers with a valid replacement after an invalid %s exchange', async (surface) => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x0d), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('safe-replacement-token'));
    const operation = operationFor(surface, harness);

    await expectPrivateFailure(operation, token, surface);
    await expect(operation()).resolves.toBeDefined();

    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.api).toHaveBeenCalledTimes(surface === 'public-client' ? 1 : 0);
    if (surface === 'public-client') {
      expect(new Headers(harness.api.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
        'Bearer safe-replacement-token',
      );
    }
  });

  test('shares one failed exchange among concurrent callers and retries on the next call', async () => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x01), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('fresh-safe-token'));
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

    const attempts = await Promise.allSettled(Array.from({ length: 24 }, async () => auth.getToken()));

    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        expect(attempt.reason).toBeInstanceOf(OpenAIError);
        expect((attempt.reason as Error).message).toBe(SAFE_ERROR);
      }
    }
    expect(harness.exchange).toHaveBeenCalledTimes(1);
    await expect(auth.getToken()).resolves.toBe('fresh-safe-token');
    expect(harness.exchange).toHaveBeenCalledTimes(2);
  });

  test('keeps a valid cached token when a background refresh returns a malformed bearer', async () => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x7f), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse('still-valid-cached-token', 60))
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('refreshed-safe-token'));
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

    await expect(auth.getToken()).resolves.toBe('still-valid-cached-token');
    await expect(auth.getToken()).resolves.toBe('still-valid-cached-token');
    await vi.waitFor(() => expect(harness.exchange).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.subjectToken).toHaveBeenCalledTimes(2));

    await vi.waitFor(async () => {
      await expect(auth.getToken()).resolves.toBe('still-valid-cached-token');
      expect(harness.exchange).toHaveBeenCalledTimes(3);
    });
    await vi.waitFor(async () => expect(await auth.getToken()).toBe('refreshed-safe-token'));
  });

  test('retries after invalidating an expired token whose replacement was malformed', async () => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x1f), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    harness.exchange
      .mockResolvedValueOnce(oauthResponse('expiring-safe-token', 1))
      .mockResolvedValueOnce(oauthResponse(token))
      .mockResolvedValueOnce(oauthResponse('replacement-safe-token'));
    const now = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

    await expect(auth.getToken()).resolves.toBe('expiring-safe-token');
    dateNow.mockReturnValue(now + 1000);
    await expectPrivateFailure(() => auth.getToken(), token, 'direct-auth');
    auth.invalidateToken();
    await expect(auth.getToken()).resolves.toBe('replacement-safe-token');
    expect(harness.exchange).toHaveBeenCalledTimes(3);
  });

  test.each(surfaces.flatMap((surface) => validTokens.map(({ name, token }) => ({ surface, name, token }))))(
    '$surface preserves a valid $name credential, cache, and redirect behavior',
    async ({ surface, token }) => {
      const harness = createHarness(token);
      const operation = operationFor(surface, harness);

      await expect(operation()).resolves.toBeDefined();
      await expect(operation()).resolves.toBeDefined();

      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.subjectToken).toHaveBeenCalledTimes(1);
      expect(harness.exchange.mock.calls[0]?.[1]?.redirect).toBe('manual');
      if (surface === 'public-client') {
        expect(harness.api).toHaveBeenCalledTimes(2);
        expect(new Headers(harness.api.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
          ['Bearer ', token].join(''),
        );
      } else {
        expect(harness.api).not.toHaveBeenCalled();
      }
    },
  );

  test('preserves the identity of subject-token-provider failures', async () => {
    const original = new OpenAIError('The subject token provider failed safely.');
    const harness = createHarness('unused-safe-token');
    harness.subjectToken.mockRejectedValueOnce(original);
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

    await expect(auth.getToken()).rejects.toBe(original);
    expect(harness.exchange).not.toHaveBeenCalled();
    expect(harness.api).not.toHaveBeenCalled();
  });

  test.each([400, 401, 403] as const)(
    'preserves OAuthError status %i and safe diagnostics',
    async (status) => {
      const harness = createHarness('unused-safe-token');
      harness.exchange.mockResolvedValueOnce(
        Response.json({ error: 'invalid_grant', error_description: 'Identity was rejected.' }, { status }),
      );
      const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);

      await expect(auth.getToken()).rejects.toBeInstanceOf(OAuthError);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  test('keeps every debug-log sink free of OAuth bearer material', async () => {
    const token = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
    const harness = createHarness(token);
    const logger = createLogger();
    const client = createPublicClient(harness, logger);

    await expectPrivateFailure(() => client.models.list(), token, 'public-client');

    for (const sink of [logger.debug, logger.info, logger.warn, logger.error]) {
      for (const argumentsList of sink.mock.calls) {
        const diagnostic = JSON.stringify(argumentsList);
        expect(diagnostic).not.toContain(ACCESS_SECRET);
        expect(diagnostic).not.toContain(PRIVATE_PATIENT);
      }
    }
    expect(harness.api).not.toHaveBeenCalled();
  });

  test.each([
    { name: 'line-feed', token: [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('') },
    {
      name: 'accepted C0 byte',
      token: [ACCESS_SECRET, String.fromCodePoint(0x01), PRIVATE_PATIENT].join(''),
    },
    { name: 'leading space', token: [' ', ACCESS_SECRET, PRIVATE_PATIENT].join('') },
    {
      name: 'leading horizontal tab',
      token: [String.fromCodePoint(0x09), ACCESS_SECRET, PRIVATE_PATIENT].join(''),
    },
    { name: 'trailing space', token: [ACCESS_SECRET, PRIVATE_PATIENT, ' '].join('') },
    {
      name: 'trailing horizontal tab',
      token: [ACCESS_SECRET, PRIVATE_PATIENT, String.fromCodePoint(0x09)].join(''),
    },
  ])('blocks a $name access token at the real public OAuth and HTTP boundary', async ({ token }) => {
    let exchangeRequests = 0;
    let apiRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/oauth/token') {
        exchangeRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: token, expires_in: 3600 }));
      } else {
        apiRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [] }));
      }
    });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an authenticated loopback TCP address.');
    }
    const baseURL = ['http://127.0.0.1:', String(address.port)].join('');
    const nativeFetch = globalThis.fetch;
    const transport = vi.fn((url: RequestInfo, init?: RequestInit) => {
      const target = String(url) === OAUTH_URL ? [baseURL, '/oauth/token'].join('') : url;
      return nativeFetch(target, init);
    });
    const client = new OpenAI({
      apiKey: null,
      baseURL: [baseURL, '/v1'].join(''),
      maxRetries: 0,
      fetch: transport,
      workloadIdentity: {
        identityProviderId: 'safe-identity-provider',
        serviceAccountId: 'safe-service-account',
        provider: { tokenType: 'jwt', getToken: async () => 'subject-token' },
      },
    });

    try {
      await expectPrivateFailure(() => client.models.list(), token, 'public-client');
      expect(exchangeRequests).toBe(1);
      expect(apiRequests).toBe(0);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  test('keeps one validated accessor snapshot across the real public HTTP transport', async () => {
    const safe = 'safe-loopback-access-token';
    const unsafe = [ACCESS_SECRET, String.fromCodePoint(0x0a), PRIVATE_PATIENT].join('');
    const read = vi.fn(() => (read.mock.calls.length <= 3 ? safe : unsafe));
    let exchangeRequests = 0;
    let apiRequests = 0;
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      if (request.url === '/oauth/token') {
        exchangeRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: safe, expires_in: 3600 }));
      } else {
        apiRequests += 1;
        ({ authorization } = request.headers);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [] }));
      }
    });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an authenticated loopback TCP address.');
    }
    const baseURL = ['http://127.0.0.1:', String(address.port)].join('');
    const nativeFetch = globalThis.fetch;
    const transport = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      if (String(url) !== OAUTH_URL) {
        return nativeFetch(url, init);
      }
      await nativeFetch([baseURL, '/oauth/token'].join(''), init);
      return accessorResponse(read, true);
    });
    const client = new OpenAI({
      apiKey: null,
      baseURL: [baseURL, '/v1'].join(''),
      maxRetries: 0,
      fetch: transport,
      workloadIdentity: {
        identityProviderId: 'safe-identity-provider',
        serviceAccountId: 'safe-service-account',
        provider: { tokenType: 'jwt', getToken: async () => 'subject-token' },
      },
    });
    try {
      await expect(client.models.list()).resolves.toBeDefined();
      expect([exchangeRequests, apiRequests, read.mock.calls.length]).toEqual([1, 1, 1]);
      expect(authorization).toBe(['Bearer ', safe].join(''));
    } finally {
      await closeServer(server);
    }
  });
});
