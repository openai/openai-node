import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';

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

function parserResponse(error: unknown): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'json', {
    configurable: true,
    value: async () => {
      throw error;
    },
  });
  return response;
}

function withCause(error: Error, cause: unknown): Error {
  return Object.defineProperty(error, 'cause', { configurable: true, value: cause });
}

function nodeFetchParserError(privateValue: string): Error {
  return Object.defineProperty(
    new Error(`invalid json response body at ${OAUTH_URL} reason: ${privateValue}`),
    'type',
    { configurable: true, enumerable: true, value: 'invalid-json' },
  );
}

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

  const parserFailure = failure;
  expect(parserFailure).toBeInstanceOf(SyntaxError);
  if (!(parserFailure instanceof SyntaxError)) {
    throw new Error('Malformed successful OAuth JSON must expose a sanitized syntax error.');
  }

  expect(parserFailure.message).toBe(SAFE_PARSE_FAILURE);
  expect('cause' in parserFailure).toBe(false);

  let current = failure;
  while (current instanceof Error) {
    expect(current.message).not.toContain(privateValue);
    expect(current.stack ?? '').not.toContain(privateValue);
    current = (current as Error & { cause?: unknown }).cause;
  }

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

interface FailureCase {
  name: string;
  create: (privateValue: string) => unknown;
}

const parserFailures: readonly FailureCase[] = [
  {
    name: 'node-fetch v2 invalid-json wrapper without a cause',
    create: nodeFetchParserError,
  },
  {
    name: 'nested native parser error',
    create: (value) => withCause(new Error(`outer parser ${value}`), new SyntaxError(value)),
  },
  {
    name: 'cross-realm native parser error',
    create: (value) => runInNewContext('new SyntaxError(privateValue)', { privateValue: value }),
  },
  {
    name: 'native parser error with a forged own Error tag',
    create: (value) =>
      Object.defineProperty(new SyntaxError(value), Symbol.toStringTag, {
        configurable: true,
        value: 'Error',
      }),
  },
  {
    name: 'native parser error with a forged inherited Error tag',
    create: (value) => {
      const prototype = Object.create(SyntaxError.prototype);
      Object.defineProperty(prototype, Symbol.toStringTag, { configurable: true, value: 'Error' });
      return Object.setPrototypeOf(new SyntaxError(value), prototype);
    },
  },
  {
    name: 'native invalid-json wrapper with a forged own Error tag',
    create: (value) =>
      Object.defineProperty(nodeFetchParserError(value), Symbol.toStringTag, {
        configurable: true,
        value: 'Error',
      }),
  },
  {
    name: 'cross-realm native parser error with a forged own Error tag',
    create: (value) =>
      runInNewContext(
        "Object.defineProperty(new SyntaxError(privateValue), Symbol.toStringTag, { value: 'Error' })",
        { privateValue: value },
      ),
  },
  {
    name: 'nested cross-realm native parser error',
    create: (value) =>
      runInNewContext(
        "Object.defineProperty(new Error('wrapper ' + privateValue), 'cause', { value: new SyntaxError(privateValue) })",
        { privateValue: value },
      ),
  },
  {
    name: 'cyclic parser cause chain',
    create: (value) => {
      const error = new Error(`cyclic parser ${value}`);
      return withCause(error, error);
    },
  },
  {
    name: 'overlong parser cause chain',
    create: (value) => {
      let error: Error = new SyntaxError(value);
      for (let index = 0; index < 40; index += 1) {
        error = withCause(new Error(`parser layer ${index}`), error);
      }
      return error;
    },
  },
  {
    name: 'hostile error prototype trap',
    create: (value) =>
      new Proxy(new Error(`hostile parser ${value}`), {
        getPrototypeOf() {
          throw new Error(`private prototype trap ${value}`);
        },
      }),
  },
  {
    name: 'hostile parser cause descriptor trap',
    create: (value) =>
      new Proxy(new Error(`hostile cause ${value}`), {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'cause') {
            throw new Error(`private cause trap ${value}`);
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }),
  },
  {
    name: 'hostile unbranded parser descriptor proxy',
    create: (value) =>
      new Proxy(Object.create(Error.prototype), {
        getOwnPropertyDescriptor() {
          throw new Error(`private parser descriptor trap ${value}`);
        },
      }),
  },
  {
    name: 'hostile parser cause accessor',
    create: (value) =>
      Object.defineProperty(new Error(`hostile accessor ${value}`), 'cause', {
        configurable: true,
        get() {
          throw new Error(`private cause getter ${value}`);
        },
      }),
  },
  {
    name: 'hostile parser type accessor',
    create: (value) =>
      Object.defineProperty(new Error(`hostile type ${value}`), 'type', {
        configurable: true,
        get() {
          throw new Error(`private type getter ${value}`);
        },
      }),
  },
];

const unbrandedParserFailures: readonly FailureCase[] = [
  {
    name: 'same-realm Error prototype with an invalid-json marker',
    create: () => Object.assign(Object.create(Error.prototype), { type: 'invalid-json' }),
  },
  {
    name: 'same-realm SyntaxError prototype',
    create: () => Object.create(SyntaxError.prototype),
  },
  {
    name: 'Error prototype carrying a copied genuine native stack accessor',
    create: () => {
      const forged = Object.assign(Object.create(Error.prototype), { type: 'invalid-json' });
      const stack = Object.getOwnPropertyDescriptor(new Error('native stack descriptor'), 'stack');
      if (!stack) {
        throw new Error('Expected a native Error stack descriptor.');
      }
      Object.defineProperty(forged, 'stack', stack);
      return forged;
    },
  },
  {
    name: 'Error prototype with a captured V8 stack',
    create: () => {
      const forged = Object.assign(Object.create(Error.prototype), { type: 'invalid-json' });
      Error.captureStackTrace(forged);
      return forged;
    },
  },
  {
    name: 'native Error wrapping an unbranded captured V8 stack',
    create: () => {
      const forged = Object.assign(Object.create(Error.prototype), { type: 'invalid-json' });
      Error.captureStackTrace(forged);
      return withCause(new Error('custom parser failure'), forged);
    },
  },
  {
    name: 'cross-realm Error prototype with an invalid-json marker',
    create: () => runInNewContext("Object.assign(Object.create(Error.prototype), { type: 'invalid-json' })"),
  },
  {
    name: 'cross-realm SyntaxError prototype',
    create: () => runInNewContext('Object.create(SyntaxError.prototype)'),
  },
  {
    name: 'native Error wrapping an unbranded same-realm SyntaxError prototype',
    create: () => withCause(new Error('custom parser failure'), Object.create(SyntaxError.prototype)),
  },
  {
    name: 'native Error wrapping an unbranded cross-realm SyntaxError prototype',
    create: () =>
      withCause(new Error('custom parser failure'), runInNewContext('Object.create(SyntaxError.prototype)')),
  },
  {
    name: 'Error prototype with a forged own Error tag',
    create: () => {
      const forged = Object.assign(Object.create(Error.prototype), { type: 'invalid-json' });
      return Object.defineProperty(forged, Symbol.toStringTag, {
        configurable: true,
        value: 'Error',
      });
    },
  },
  {
    name: 'Error prototype with a forged inherited Error tag',
    create: () => {
      const prototype = Object.create(Error.prototype);
      Object.defineProperty(prototype, Symbol.toStringTag, { configurable: true, value: 'Error' });
      return Object.assign(Object.create(prototype), { type: 'invalid-json' });
    },
  },
];

describe('successful workload OAuth response JSON privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(surfaces)('redacts real loopback OAuth Response.json syntax failures on %s', async (surface) => {
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

  it.each(
    surfaces.flatMap((surface) =>
      parserFailures.map((failure) => ({ surface, name: failure.name, create: failure.create })),
    ),
  )('redacts $name on $surface', async ({ surface, create }) => {
    const harness = createHarness(async () => parserResponse(create(PRIVATE_TOKEN)));
    await expectPrivateFailure(operationFor(surface, harness), harness);
    expect(harness.exchange).toHaveBeenCalledTimes(1);
  });

  it.each(surfaces)('does not retain a failed parser result in the %s token cache', async (surface) => {
    let attempt = 0;
    const harness = createHarness(async () => {
      attempt += 1;
      if (attempt === 1) {
        return parserResponse(nodeFetchParserError(PRIVATE_TOKEN));
      }
      return Response.json({ access_token: 'safe-recovered-token', expires_in: 3600 });
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
      const harness = createHarness(async () => parserResponse(nodeFetchParserError(PRIVATE_TOKEN)));
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

  it.each(surfaces)('preserves unrelated response body TypeError identity on %s', async (surface) => {
    const transportFailure = new TypeError('OAuth response body stream was interrupted.');
    const harness = createHarness(async () => parserResponse(transportFailure));

    let failure: unknown;
    try {
      await operationFor(surface, harness)();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(transportFailure);
    expect(harness.api).not.toHaveBeenCalled();
  });

  it.each(surfaces)('preserves nested non-parser response failures on %s', async (surface) => {
    const transportFailure = withCause(new Error('OAuth body transport failed'), new TypeError('socket'));
    const harness = createHarness(async () => parserResponse(transportFailure));

    let failure: unknown;
    try {
      await operationFor(surface, harness)();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(transportFailure);
  });

  it.each(surfaces)('preserves genuine cross-realm non-parser TypeErrors on %s', async (surface) => {
    const transportFailure: unknown = runInNewContext("new TypeError('cross-realm body failure')");
    const harness = createHarness(async () => parserResponse(transportFailure));

    await expect(operationFor(surface, harness)()).rejects.toBe(transportFailure);
  });

  it.each(surfaces)('does not classify forged plain parser-like values on %s', async (surface) => {
    const forgedFailure = { name: 'SyntaxError', message: PRIVATE_TOKEN };
    const harness = createHarness(async () => parserResponse(forgedFailure));

    await expect(operationFor(surface, harness)()).rejects.toBe(forgedFailure);
  });

  it.each(
    surfaces.flatMap((surface) =>
      unbrandedParserFailures.map((failure) => ({ surface, name: failure.name, create: failure.create })),
    ),
  )('preserves the original unbranded $name rejection on $surface', async ({ surface, create }) => {
    const original = create(PRIVATE_TOKEN);
    const harness = createHarness(async () => parserResponse(original));

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
    expect(harness.exchange).toHaveBeenCalledTimes(1);
    expect(harness.api).not.toHaveBeenCalled();
  });

  it.each(
    surfaces.flatMap((surface) =>
      (['own', 'inherited'] as const).map((placement) => ({ surface, placement })),
    ),
  )('never invokes an unbranded $placement Error-tag getter on $surface', async ({ surface, placement }) => {
    const prototype = Object.create(Error.prototype);
    const original = Object.assign(Object.create(prototype), { type: 'invalid-json' });
    const readTag = vi.fn(() => {
      throw new Error('An untrusted OAuth parser branding getter was invoked.');
    });
    Object.defineProperty(placement === 'own' ? original : prototype, Symbol.toStringTag, {
      configurable: true,
      get: readTag,
    });
    const harness = createHarness(async () => parserResponse(original));

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
    expect(readTag).not.toHaveBeenCalled();
  });

  it.each(surfaces)(
    'sanitizes a native parser failure without invoking an Error-tag getter on %s',
    async (surface) => {
      const original = new SyntaxError(PRIVATE_TOKEN);
      const readTag = vi.fn(() => {
        throw new Error('An untrusted OAuth parser branding getter was invoked.');
      });
      Object.defineProperty(original, Symbol.toStringTag, { configurable: true, get: readTag });
      const harness = createHarness(async () => parserResponse(original));

      await expectPrivateFailure(operationFor(surface, harness), harness);
      expect(readTag).not.toHaveBeenCalled();
    },
  );

  it.each(surfaces)('preserves unrelated native DOMException identity on %s', async (surface) => {
    const original = new DOMException('The OAuth response stream was interrupted.', 'AbortError');
    const harness = createHarness(async () => parserResponse(original));

    await expect(operationFor(surface, harness)()).rejects.toBe(original);
  });

  it.each(surfaces)('requires an own node-fetch invalid-json error marker on %s', async (surface) => {
    const transportFailure = new Error('transport failure with an inherited parser-like marker');
    const prototype: { type?: string } = Object.create(Error.prototype);
    prototype.type = 'invalid-json';
    Object.setPrototypeOf(transportFailure, prototype);
    const harness = createHarness(async () => parserResponse(transportFailure));

    await expect(operationFor(surface, harness)()).rejects.toBe(transportFailure);
  });

  it.each(surfaces)(
    'does not sanitize fetch-thrown SyntaxErrors outside the JSON boundary on %s',
    async (surface) => {
      const fetchFailure = new SyntaxError('custom fetch syntax failure');
      const harness = createHarness(async () => {
        throw fetchFailure;
      });

      let failure: unknown;
      try {
        await operationFor(surface, harness)();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBe(fetchFailure);
    },
  );

  it.each(surfaces)(
    'does not sanitize provider-thrown SyntaxErrors outside the JSON boundary on %s',
    async (surface) => {
      const providerFailure = new SyntaxError('subject token provider syntax failure');
      const harness = createHarness(
        async () => Response.json({ access_token: 'unreachable-token' }),
        async () => {
          throw providerFailure;
        },
      );

      let failure: unknown;
      try {
        await operationFor(surface, harness)();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBe(providerFailure);
      expect(harness.exchange).not.toHaveBeenCalled();
    },
  );

  it.each(surfaces)(
    'preserves custom successful Response.json overrides and token caching on %s',
    async (surface) => {
      const readJSON = vi.fn(async () => ({ access_token: 'safe-override-token', expires_in: 3600 }));
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'json', { configurable: true, value: readJSON });
      const harness = createHarness(async () => response);
      const run = operationFor(surface, harness);

      await expect(run()).resolves.toBeDefined();
      await expect(run()).resolves.toBeDefined();

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(harness.exchange).toHaveBeenCalledTimes(1);
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
