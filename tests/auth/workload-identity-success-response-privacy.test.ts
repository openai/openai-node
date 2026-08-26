import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { inspect } from 'node:util';

import { vi } from 'vitest';

import OpenAI, { OAuthError } from 'openai';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import type { WorkloadIdentity } from 'openai/auth/types';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

const OAUTH_URL = 'https://auth.openai.com/oauth/token';
const PRIVATE_TOKEN = 'sk-priv-7a';
const SAFE_PARSE_FAILURE = 'Token exchange response contains invalid JSON';

type Surface = 'direct-auth' | 'public-client';

const surfaces: readonly Surface[] = ['direct-auth', 'public-client'];

function createHarness(
  response: (url: RequestInfo, init?: RequestInit) => Promise<Response> | Response,
  providerToken: () => Promise<string> = async () => 'safe-external-subject-token',
) {
  const provider = vi.fn(providerToken);
  const exchange = vi.fn(response);
  const api = vi.fn(async () => Response.json({ object: 'list', data: [] }));
  const fetch = vi.fn(async (url: RequestInfo, init?: RequestInit) =>
    String(url) === OAUTH_URL ? await exchange(url, init) : await api(),
  );
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config: WorkloadIdentity = {
    identityProviderId: 'safe-identity-provider',
    serviceAccountId: 'safe-service-account',
    provider: { tokenType: 'jwt', getToken: provider },
  };
  return { config, fetch, exchange, api, provider, logger };
}

type Harness = ReturnType<typeof createHarness>;

function operationFor(surface: Surface, harness: Harness): () => Promise<unknown> {
  if (surface === 'direct-auth') {
    const auth = new WorkloadIdentityAuth(harness.config, harness.fetch);
    return () => auth.getToken();
  }

  const client = new OpenAI({
    apiKey: null,
    workloadIdentity: harness.config,
    fetch: harness.fetch,
    maxRetries: 0,
    logger: harness.logger,
    logLevel: 'debug',
  });
  return () => client.models.list();
}

async function expectPrivateFailure(
  run: () => Promise<unknown>,
  harness: Harness,
  privateValue = PRIVATE_TOKEN,
): Promise<void> {
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(SyntaxError);
  if (!(failure instanceof SyntaxError)) {
    throw new Error('Malformed successful OAuth JSON must expose a sanitized syntax error.');
  }

  expect(failure.message).toBe(SAFE_PARSE_FAILURE);
  expect('cause' in failure).toBe(false);
  expect(failure.stack ?? '').not.toContain(privateValue);
  expect(inspect(failure, { depth: null })).not.toContain(privateValue);
  expect(inspect(harness.logger, { depth: null })).not.toContain(privateValue);
  expect(harness.api).not.toHaveBeenCalled();
}

async function listen(server: Server): Promise<string> {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a loopback TCP server address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

describe('successful workload OAuth response JSON privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(surfaces)('redacts malformed native HTTP response bodies on %s', async (surface) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${PRIVATE_TOKEN} customer-private-record`);
    });
    const origin = await listen(server);
    const harness = createHarness(async (_url, init) => fetch(`${origin}/oauth/token`, init));
    try {
      await expectPrivateFailure(operationFor(surface, harness), harness);
      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.provider).toHaveBeenCalledTimes(1);
    } finally {
      await close(server);
    }
  });

  it.each(surfaces)(
    'parses the native response body instead of trusting an inherited JSON override on %s',
    async (surface) => {
      const readJSON = vi.spyOn(Response.prototype, 'json').mockResolvedValue({
        access_token: 'safe-override-token',
        expires_in: 3600,
      });
      const harness = createHarness(
        async () => new Response(`${PRIVATE_TOKEN} customer-private-record`, { status: 200 }),
      );

      await expectPrivateFailure(operationFor(surface, harness), harness);

      expect(readJSON).not.toHaveBeenCalled();
    },
  );

  it.each(surfaces)('sanitizes empty successful OAuth bodies on %s', async (surface) => {
    const harness = createHarness(async () => new Response(null, { status: 200 }));

    await expectPrivateFailure(operationFor(surface, harness), harness);
  });

  it.each(
    surfaces.flatMap((surface) =>
      (
        [
          {
            name: 'ordinary JSON',
            response: () => Response.json({ access_token: 'safe-body-token', expires_in: 3600 }),
          },
          {
            name: 'invalid UTF-8 replacement',
            response: () =>
              new Response(
                new Uint8Array([
                  ...new TextEncoder().encode('{"access_token":"safe-body-token","note":"'),
                  0xff,
                  ...new TextEncoder().encode('"}'),
                ]),
              ),
          },
        ] as const
      ).map((body) => ({ surface, ...body })),
    ),
  )('preserves native $name decoding and successful token caching on $surface', async (body) => {
    const response = body.response();
    const readText = vi.spyOn(response, 'text');
    const harness = createHarness(async () => response);
    const run = operationFor(body.surface, harness);

    await expect(run()).resolves.toEqual(
      body.surface === 'direct-auth' ? 'safe-body-token' : expect.objectContaining({ data: [] }),
    );
    await expect(run()).resolves.toBeDefined();

    expect(readText).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(true);
    expect(harness.exchange).toHaveBeenCalledTimes(1);
  });

  it.each(surfaces)('preserves native UTF-8 BOM decoding behavior on %s', async (surface) => {
    const body = `\uFEFF${JSON.stringify({ access_token: 'safe-body-token', expires_in: 3600 })}`;
    const nativeParsesBOM = await new Response(body).json().then(
      () => true,
      () => false,
    );
    const response = new Response(body);
    const harness = createHarness(async () => response);
    const run = operationFor(surface, harness);

    await (nativeParsesBOM
      ? expect(run()).resolves.toEqual(
          surface === 'direct-auth' ? 'safe-body-token' : expect.objectContaining({ data: [] }),
        )
      : expectPrivateFailure(run, harness));

    expect(response.bodyUsed).toBe(true);
    expect(harness.exchange).toHaveBeenCalledTimes(1);
  });

  it.each(surfaces)(
    'preserves explicitly overridden successful JSON parsers and token caching on %s',
    async (surface) => {
      const readJSON = vi.fn(async () => ({ access_token: 'safe-override-token', expires_in: 3600 }));
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'json', { configurable: true, value: readJSON });
      const readText = vi.spyOn(response, 'text');
      const harness = createHarness(async () => response);
      const run = operationFor(surface, harness);

      await expect(run()).resolves.toBeDefined();
      await expect(run()).resolves.toBeDefined();

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(readText).not.toHaveBeenCalled();
      expect(harness.exchange).toHaveBeenCalledTimes(1);
    },
  );

  it.each(surfaces)(
    'preserves rejection identity for an explicitly overridden JSON parser on %s',
    async (surface) => {
      const original = new SyntaxError('custom JSON parser rejected its trusted representation');
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'json', {
        configurable: true,
        value: vi.fn(async () => {
          throw original;
        }),
      });
      const harness = createHarness(async () => response);

      await expect(operationFor(surface, harness)()).rejects.toBe(original);
      expect(harness.api).not.toHaveBeenCalled();
    },
  );

  it.each(
    surfaces.flatMap((surface) =>
      [
        { name: 'transport TypeError', original: new TypeError('OAuth response body was interrupted') },
        { name: 'transport SyntaxError', original: new SyntaxError('OAuth response transport failed') },
        { name: 'abort', original: new DOMException('OAuth response was aborted', 'AbortError') },
      ].map((failure) => ({ surface, ...failure })),
    ),
  )('preserves the original $name from the response-body read on $surface', async (failure) => {
    const response = Response.json({ access_token: 'unreachable-token' });
    vi.spyOn(response, 'text').mockRejectedValue(failure.original);
    const harness = createHarness(async () => response);

    await expect(operationFor(failure.surface, harness)()).rejects.toBe(failure.original);
    expect(harness.api).not.toHaveBeenCalled();
  });

  it.each(surfaces)('preserves native response-stream failure identity on %s', async (surface) => {
    const original = new Error('OAuth response stream failed before parsing');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(original);
        },
      }),
    );
    const harness = createHarness(async () => response);

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
    expect(harness.api).not.toHaveBeenCalled();
  });

  it.each(surfaces)('preserves upstream fetch SyntaxError identity on %s', async (surface) => {
    const original = new SyntaxError('custom fetch failed before the response existed');
    const harness = createHarness(async () => {
      throw original;
    });

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
  });

  it.each(surfaces)('preserves subject-token provider SyntaxError identity on %s', async (surface) => {
    const original = new SyntaxError('subject-token provider failed before the OAuth request');
    const harness = createHarness(
      async () => Response.json({ access_token: 'unreachable-token' }),
      async () => {
        throw original;
      },
    );

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
    expect(harness.exchange).not.toHaveBeenCalled();
  });

  it.each(surfaces)('does not retain a failed parser result in the %s token cache', async (surface) => {
    let attempt = 0;
    const harness = createHarness(async () => {
      attempt += 1;
      return attempt === 1
        ? new Response(`${PRIVATE_TOKEN} customer-private-record`)
        : Response.json({ access_token: 'safe-recovered-token', expires_in: 3600 });
    });
    const run = operationFor(surface, harness);

    await expectPrivateFailure(run, harness);
    await expect(run()).resolves.toEqual(
      surface === 'direct-auth' ? 'safe-recovered-token' : expect.objectContaining({ data: [] }),
    );

    expect(harness.exchange).toHaveBeenCalledTimes(2);
    expect(harness.api).toHaveBeenCalledTimes(surface === 'public-client' ? 1 : 0);
  });

  it.each(surfaces)(
    'shares one sanitized failed OAuth exchange across concurrent %s calls',
    async (surface) => {
      const harness = createHarness(async () => new Response(`${PRIVATE_TOKEN} customer-private-record`));
      const run = operationFor(surface, harness);

      await Promise.all([
        expectPrivateFailure(run, harness),
        expectPrivateFailure(run, harness),
        expectPrivateFailure(run, harness),
      ]);

      expect(harness.exchange).toHaveBeenCalledTimes(1);
      expect(harness.provider).toHaveBeenCalledTimes(1);
    },
  );

  it.each(surfaces)('preserves OAuth rejection errors on %s', async (surface) => {
    const harness = createHarness(async () =>
      Response.json({ error: 'invalid_grant', error_description: 'identity rejected' }, { status: 401 }),
    );

    await expect(operationFor(surface, harness)()).rejects.toBeInstanceOf(OAuthError);
    expect(harness.api).not.toHaveBeenCalled();
  });
});
