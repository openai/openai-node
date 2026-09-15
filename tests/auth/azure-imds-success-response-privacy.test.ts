import { once } from 'node:events';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';

import OpenAI, { SubjectTokenProviderError } from 'openai';
import { azureManagedIdentityTokenProvider } from 'openai/auth/subject-token-providers';

const PRIVATE_VALUES = ['sk-priv-7a', 'cust-prv01'] as const;
const VALID_SUBJECT_TOKEN = 'valid-azure-managed-identity-token';
const SAFE_PARSE_FAILURE = 'IMDS response contains invalid JSON';

type AzureProvider = ReturnType<typeof azureManagedIdentityTokenProvider>;

function withParserCause<Failure extends Error>(error: Failure, cause: unknown): Failure {
  return Object.defineProperty(error, 'cause', {
    configurable: true,
    value: cause,
    writable: true,
  });
}

function createCauseFreeJSONFailure(privateValue: string): Error {
  const failure = new Error(`invalid json response body reason: ${privateValue} malformed response`);
  return Object.defineProperty(failure, 'type', {
    configurable: true,
    enumerable: true,
    value: 'invalid-json',
    writable: true,
  });
}

function createCrossRealmJSONFailure(privateValue: string, wrapped = false): unknown {
  return runInNewContext(
    [
      '(() => {',
      "  try { JSON.parse(privateValue + ' malformed metadata response'); }",
      '  catch (error) {',
      '    if (!wrapped) return error;',
      "    const wrapper = new Error(privateValue + ' foreign metadata parser wrapper');",
      "    Object.defineProperty(wrapper, 'cause', { configurable: true, value: error });",
      '    return wrapper;',
      '  }',
      '})()',
    ].join('\n'),
    { privateValue, wrapped },
  );
}

function createWorkloadClient(provider: AzureProvider, apiFetch: typeof fetch): OpenAI {
  return new OpenAI({
    apiKey: null,
    maxRetries: 0,
    fetch: apiFetch,
    workloadIdentity: {
      identityProviderId: 'test-identity-provider',
      serviceAccountId: 'test-service-account',
      provider,
    },
  });
}

async function expectPrivateParseFailure(
  operation: () => Promise<unknown>,
  privateValue: string,
): Promise<void> {
  let failure: unknown;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(SubjectTokenProviderError);
  if (!(failure instanceof SubjectTokenProviderError)) {
    throw new Error('Azure metadata authentication did not preserve its public provider error.');
  }

  expect(failure.provider).toBe('azure-imds');
  expect(failure.message).toBe('failed to fetch token from IMDS');
  expect(failure.cause).toBeInstanceOf(SyntaxError);
  if (!(failure.cause instanceof SyntaxError)) {
    throw new Error('Azure metadata authentication did not preserve its JSON syntax error cause.');
  }

  for (const diagnostic of [
    failure.message,
    failure.stack ?? '',
    failure.cause.message,
    failure.cause.stack ?? '',
    inspect(failure, { depth: null }),
  ]) {
    expect(diagnostic).not.toContain(privateValue);
  }

  expect(failure.cause.message).toBe(SAFE_PARSE_FAILURE);
  expect('cause' in failure.cause).toBe(false);
}

describe('Azure IMDS successful-response JSON privacy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(PRIVATE_VALUES)(
    'keeps malformed successful metadata containing %s out of public provider diagnostics',
    async (privateValue) => {
      const response = new Response(`${privateValue} customer-private-record`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const readJSON = vi.spyOn(response, 'json');
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

      await expectPrivateParseFailure(() => provider.getToken(), privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(response.bodyUsed).toBe(true);
    },
  );

  it.each(PRIVATE_VALUES)(
    'keeps malformed successful metadata containing %s out of public OpenAI workload diagnostics',
    async (privateValue) => {
      const metadataFetch = vi.fn(async () => new Response(`${privateValue} customer-private-record`));
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(
        azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch }),
        apiFetch,
      );

      await expectPrivateParseFailure(() => client.models.list(), privateValue);

      expect(metadataFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['provider', 'workload'] as const)(
    'sanitizes a native malformed JSON error from an actual HTTP response through the %s boundary',
    async (boundary) => {
      const [privateValue] = PRIVATE_VALUES;
      const metadata = createServer((request, response) => {
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(`${privateValue} customer-private-record`);
      });

      try {
        await once(metadata.listen(0, '127.0.0.1'), 'listening');
        const address = metadata.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected the Azure metadata server to bind an ephemeral TCP port.');
        }

        const metadataURL = `http://127.0.0.1:${address.port}/metadata`;
        const metadataFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
          globalThis.fetch(metadataURL, init),
        );
        const provider = azureManagedIdentityTokenProvider(undefined, {
          fetch: metadataFetch,
          timeout: 1000,
        });
        const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
        const client = createWorkloadClient(provider, apiFetch);
        const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

        await expectPrivateParseFailure(operation, privateValue);

        expect(metadataFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch).not.toHaveBeenCalled();
      } finally {
        const closed = once(metadata, 'close');
        metadata.closeAllConnections();
        metadata.close();
        await closed;
      }
    },
  );

  it('removes private nested causes from replacement syntax errors', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const original = new SyntaxError(`${privateValue} was returned by the metadata JSON parser`);
    Object.defineProperty(original, 'cause', {
      value: new Error(`${privateValue} nested parser detail`),
    });
    const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
    vi.spyOn(response, 'json').mockRejectedValue(original);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

    await expectPrivateParseFailure(() => provider.getToken(), privateValue);
  });

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['wrapper', 'nested wrapper'] as const).map((wrapper) => ({ privateValue, boundary, wrapper })),
      ),
    ),
  )(
    'sanitizes $wrapper parser errors containing $privateValue through the $boundary boundary',
    async ({ privateValue, boundary, wrapper }) => {
      const parserError = new SyntaxError(`${privateValue} appeared in the malformed metadata preview`);
      const wrapped =
        wrapper === 'wrapper'
          ? withParserCause(new Error(`${privateValue} custom fetch JSON parser failed`), parserError)
          : withParserCause(
              new TypeError(`${privateValue} outer metadata parser wrapper`),
              withParserCause(new Error(`${privateValue} nested metadata parser wrapper`), parserError),
            );
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(wrapped);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['direct', 'nested'] as const).map((shape) => ({ privateValue, boundary, shape })),
      ),
    ),
  )(
    'sanitizes a $shape cause-free invalid-json fetch error containing $privateValue through $boundary',
    async ({ privateValue, boundary, shape }) => {
      const parserFailure = createCauseFreeJSONFailure(privateValue);
      expect(Object.getOwnPropertyDescriptor(parserFailure, 'cause')).toBeUndefined();
      const original =
        shape === 'direct'
          ? parserFailure
          : withParserCause(new Error(`${privateValue} outer metadata parser wrapper`), parserFailure);
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['direct', 'local wrapper', 'foreign wrapper', 'nested wrapper'] as const).map((shape) => ({
          privateValue,
          boundary,
          shape,
        })),
      ),
    ),
  )(
    'sanitizes genuine $shape cross-realm parser errors containing $privateValue through $boundary',
    async ({ privateValue, boundary, shape }) => {
      const foreignParserError = createCrossRealmJSONFailure(privateValue);
      const foreignWrapper = createCrossRealmJSONFailure(privateValue, true);
      expect(foreignParserError).not.toBeInstanceOf(SyntaxError);
      expect(foreignParserError).not.toBeInstanceOf(Error);
      expect(foreignWrapper).not.toBeInstanceOf(Error);
      let original: unknown;
      if (shape === 'direct') {
        original = foreignParserError;
      } else if (shape === 'local wrapper') {
        original = withParserCause(new Error('local metadata parser wrapper'), foreignParserError);
      } else if (shape === 'foreign wrapper') {
        original = foreignWrapper;
      } else {
        original = withParserCause(new TypeError('outer local metadata parser wrapper'), foreignWrapper);
      }
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['own data', 'own accessor', 'inherited data', 'inherited accessor'] as const).flatMap((tag) =>
          (['direct', 'wrapped'] as const).map((shape) => ({ privateValue, boundary, tag, shape })),
        ),
      ),
    ),
  )(
    'sanitizes a $shape foreign syntax error with $tag containing $privateValue through $boundary',
    async ({ privateValue, boundary, tag, shape }) => {
      const parserFailure = createCrossRealmJSONFailure(privateValue) as object;
      const tagged = tag.startsWith('own') ? parserFailure : (Object.getPrototypeOf(parserFailure) as object);
      const readTag = vi.fn(() => {
        throw new Error(`${privateValue} escaped through an untrusted parser tag`);
      });
      Object.defineProperty(tagged, Symbol.toStringTag, {
        configurable: true,
        ...(tag.endsWith('accessor') ? { get: readTag } : { value: 'DecoratedSyntaxError' }),
      });
      const original =
        shape === 'direct'
          ? parserFailure
          : withParserCause(new Error(`${privateValue} outer metadata parser wrapper`), parserFailure);
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readTag).not.toHaveBeenCalled();
      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['own data', 'own accessor', 'inherited data', 'inherited accessor'] as const).flatMap((tag) =>
          (['foreign syntax', 'marked fetch'] as const).flatMap((parser) =>
            (['direct', 'wrapped'] as const).map((shape) => ({
              privateValue,
              boundary,
              tag,
              parser,
              shape,
            })),
          ),
        ),
      ),
    ),
  )(
    'follows a $shape $tag foreign wrapper to its $parser containing $privateValue through $boundary',
    async ({ privateValue, boundary, tag, parser, shape }) => {
      const foreign = createCrossRealmJSONFailure(privateValue, true) as object;
      if (parser === 'marked fetch') {
        Object.defineProperty(foreign, 'cause', {
          configurable: true,
          value: createCauseFreeJSONFailure(privateValue),
        });
      }
      const tagged = tag.startsWith('own') ? foreign : (Object.getPrototypeOf(foreign) as object);
      const readTag = vi.fn(() => {
        throw new Error(`${privateValue} escaped through an untrusted foreign wrapper tag`);
      });
      Object.defineProperty(tagged, Symbol.toStringTag, {
        configurable: true,
        ...(tag.endsWith('accessor') ? { get: readTag } : { value: 'DecoratedParserWrapper' }),
      });
      const original =
        shape === 'direct'
          ? foreign
          : withParserCause(new Error(`${privateValue} outer metadata parser wrapper`), foreign);
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readTag).not.toHaveBeenCalled();
      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    PRIVATE_VALUES.flatMap((privateValue) =>
      (['provider', 'workload'] as const).flatMap((boundary) =>
        (['throwing prototype', 'nested throwing prototype', 'revoked', 'nested revoked'] as const).map(
          (shape) => ({ privateValue, boundary, shape }),
        ),
      ),
    ),
  )(
    'fails closed for a $shape parser rejection containing $privateValue through $boundary',
    async ({ privateValue, boundary, shape }) => {
      const target = new Error(`${privateValue} appeared in the malformed metadata preview`);
      let rejected: object;
      if (shape === 'revoked' || shape === 'nested revoked') {
        const temporary = Proxy.revocable(target, {});
        temporary.revoke();
        rejected = temporary.proxy;
      } else {
        rejected = new Proxy(target, {
          getPrototypeOf() {
            throw new Error(`${privateValue} appeared in an unsafe parser brand diagnostic`);
          },
        });
      }
      if (shape === 'nested throwing prototype' || shape === 'nested revoked') {
        rejected = withParserCause(
          new Error(`${privateValue} appeared in the outer metadata parser wrapper`),
          rejected,
        );
      }
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      const readJSON = vi.spyOn(response, 'json').mockRejectedValue(rejected);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['provider', 'workload'] as const)(
    'continues failing closed for a secret-bearing parser descriptor trap through %s',
    async (boundary) => {
      const [privateValue] = PRIVATE_VALUES;
      const rejected = new Proxy(new Error('safe custom metadata parser wrapper'), {
        getOwnPropertyDescriptor() {
          throw new Error(`${privateValue} appeared in an unsafe parser descriptor diagnostic`);
        },
      });
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(rejected);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

      await expectPrivateParseFailure(operation, privateValue);

      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['own name', 'prototype name', 'native prototype', 'foreign type'] as const)(
    'preserves a spoofed or non-syntax cross-realm parser cause: %s',
    async (shape) => {
      let foreign: unknown;
      if (shape === 'own name') {
        foreign = runInNewContext(
          "Object.defineProperty(new Error('safe custom failure'), 'name', { value: 'SyntaxError' })",
        );
      } else if (shape === 'prototype name') {
        foreign = runInNewContext(
          [
            'class CustomParserFailure extends Error {}',
            "Object.defineProperty(CustomParserFailure.prototype, 'name', { value: 'SyntaxError' });",
            "new CustomParserFailure('safe custom failure')",
          ].join('\n'),
        );
      } else if (shape === 'native prototype') {
        foreign = runInNewContext('Object.create(SyntaxError.prototype)');
      } else {
        foreign = runInNewContext("new TypeError('safe custom parser type failure')");
      }
      const original = withParserCause(new Error('safe custom metadata parser wrapper'), foreign);
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      let failure: unknown;

      try {
        await provider.getToken();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its custom parser failure.');
      }
      expect(failure.cause).toBe(original);
    },
  );

  it.each(['safe foreign cause', 'fake native marker', 'cause accessor'] as const)(
    'preserves a tagged foreign parser wrapper with a $0 without invoking untrusted getters',
    async (shape) => {
      const foreign =
        shape === 'fake native marker'
          ? (runInNewContext('Object.create(Error.prototype)') as object)
          : (runInNewContext("new Error('safe foreign metadata parser wrapper')") as object);
      const readTag = vi.fn(() => {
        throw new Error('an untrusted foreign wrapper tag getter was invoked');
      });
      const readCause = vi.fn(() => new SyntaxError('an untrusted foreign wrapper cause was invoked'));
      Object.defineProperty(foreign, Symbol.toStringTag, { configurable: true, get: readTag });
      if (shape === 'cause accessor') {
        Object.defineProperty(foreign, 'cause', { configurable: true, get: readCause });
      } else {
        Object.defineProperty(foreign, 'cause', {
          configurable: true,
          value: new TypeError('the metadata response body became unavailable'),
        });
      }
      if (shape === 'fake native marker') {
        Object.defineProperty(foreign, 'type', { configurable: true, value: 'invalid-json' });
      }
      const original = withParserCause(new Error('safe custom metadata parser wrapper'), foreign);
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      let failure: unknown;

      try {
        await provider.getToken();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its custom parser failure.');
      }
      expect(failure.cause).toBe(original);
      expect(readTag).not.toHaveBeenCalled();
      expect(readCause).not.toHaveBeenCalled();
    },
  );

  it('never invokes cross-realm name, message, tag, toString, or cause getters', async () => {
    const foreign = runInNewContext("new Error('safe foreign parser failure')") as object;
    const reads = vi.fn(() => {
      throw new Error('an untrusted cross-realm diagnostic getter was invoked');
    });
    for (const property of ['name', 'message', 'toString', 'cause', Symbol.toStringTag]) {
      Object.defineProperty(foreign, property, { configurable: true, get: reads });
    }
    const original = withParserCause(new Error('safe custom metadata parser wrapper'), foreign);
    const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
    vi.spyOn(response, 'json').mockRejectedValue(original);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its custom parser failure.');
    }
    expect(failure.cause).toBe(original);
    expect(reads).not.toHaveBeenCalled();
  });

  it.each(['cyclic', 'over-budget'] as const)(
    'fails closed for a $0 ambiguous wrapped parser failure without disclosing its diagnostic',
    async (shape) => {
      const [privateValue] = PRIVATE_VALUES;
      let original: Error = new SyntaxError(`${privateValue} appeared in the malformed metadata preview`);
      if (shape === 'cyclic') {
        original = new Error(`${privateValue} appeared in a cyclic metadata parser wrapper`);
        Object.defineProperty(original, 'cause', { value: original });
      } else {
        for (let depth = 0; depth < 40; depth += 1) {
          original = withParserCause(
            new Error(`${privateValue} appeared in a deeply nested metadata parser wrapper`),
            original,
          );
        }
      }
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

      await expectPrivateParseFailure(() => provider.getToken(), privateValue);
    },
  );

  it.each(['provider', 'workload'] as const)(
    'preserves a genuinely non-syntax wrapped parser error through the %s boundary',
    async (boundary) => {
      const customCause = new TypeError('the metadata response body became unavailable');
      const original = withParserCause(
        new Error('the custom metadata parser could not read its body'),
        withParserCause(new Error('safe custom parser diagnostics'), customCause),
      );
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();
      let failure: unknown;

      try {
        await operation();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its custom parser failure.');
      }
      expect(failure.cause).toBe(original);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['non-parser marker', 'inherited marker', 'accessor marker'] as const)(
    'preserves the exact safe custom parser error with an untrusted $0',
    async (shape) => {
      const original = new Error('the custom metadata parser could not read its body');
      const readType = vi.fn(() => 'invalid-json');
      if (shape === 'non-parser marker') {
        Object.defineProperty(original, 'type', { configurable: true, value: 'system' });
      } else if (shape === 'inherited marker') {
        const prototype = Object.create(Error.prototype) as object;
        Object.defineProperty(prototype, 'type', { configurable: true, value: 'invalid-json' });
        Object.setPrototypeOf(original, prototype);
      } else {
        Object.defineProperty(original, 'type', { configurable: true, get: readType });
      }
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      let failure: unknown;

      try {
        await provider.getToken();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its custom parser failure.');
      }
      expect(failure.cause).toBe(original);
      expect(readType).not.toHaveBeenCalled();
    },
  );

  it('preserves custom parser diagnostics without invoking an untrusted cause getter', async () => {
    const original = new Error('the custom metadata parser could not read its body');
    const readCause = vi.fn(() => new SyntaxError('an untrusted cause getter must not be invoked'));
    Object.defineProperty(original, 'cause', { configurable: true, get: readCause });
    const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
    vi.spyOn(response, 'json').mockRejectedValue(original);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its custom parser failure.');
    }
    expect(failure.cause).toBe(original);
    expect(readCause).not.toHaveBeenCalled();
  });

  it.each([new Error('metadata body failed'), new TypeError('metadata body became unusable')])(
    'preserves the exact original non-syntax JSON failure %s',
    async (original) => {
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      let failure: unknown;

      try {
        await provider.getToken();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its error contract.');
      }
      expect(failure.provider).toBe('azure-imds');
      expect(failure.message).toBe('failed to fetch token from IMDS');
      expect(failure.cause).toBe(original);
    },
  );

  it.each(['provider', 'workload'] as const)(
    'preserves an upstream fetch SyntaxError without incorrectly sanitizing its identity through %s',
    async (boundary) => {
      const original = new SyntaxError('upstream fetch failed before the response existed');
      const metadataFetch = vi.fn(async (): Promise<Response> => {
        throw original;
      });
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();
      let failure: unknown;

      try {
        await operation();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its error contract.');
      }
      expect(failure.provider).toBe('azure-imds');
      expect(failure.message).toBe('failed to fetch token from IMDS');
      expect(failure.cause).toBe(original);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it('preserves exact original transport failures', async () => {
    const original = new Error('metadata network connection failed');
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async () => {
        throw original;
      },
    });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its transport error.');
    }
    expect(failure.cause).toBe(original);
  });

  it('preserves timeout cancellation, its original abort cause, and timer cleanup', async () => {
    vi.useFakeTimers();

    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const original = new DOMException('metadata request timed out', 'AbortError');
    let requestSignal: AbortSignal | null | undefined;
    const provider = azureManagedIdentityTokenProvider(undefined, {
      timeout: 25,
      fetch: async (_url, options) => {
        requestSignal = options?.signal;
        if (!requestSignal) {
          throw new Error('The metadata request did not provide an abort signal.');
        }
        await once(requestSignal, 'abort');
        throw original;
      },
    });
    const completed = (async () => {
      try {
        await provider.getToken();
      } catch (error) {
        return error;
      }
      return null;
    })();

    await vi.advanceTimersByTimeAsync(25);

    const failure = await completed;
    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its timeout failure.');
    }
    expect(failure.cause).toBe(original);
    expect(requestSignal?.aborted).toBe(true);
    expect(clearTimer).toHaveBeenCalled();
  });

  it('preserves rejected-body cancellation and fixed cause-free HTTP failures', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(privateValue));
        },
        cancel,
      }),
      { status: 403 },
    );
    const readJSON = vi.spyOn(response, 'json');
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its rejected HTTP response.');
    }
    expect(failure.message).toBe('Failed to fetch token from Azure IMDS: status 403');
    expect(failure.cause).toBeUndefined();
    expect(inspect(failure, { depth: null })).not.toContain(privateValue);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(readJSON).not.toHaveBeenCalled();
  });

  it('preserves missing-token failures without adding a parser cause', async () => {
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async () => Response.json({ expires_in: 3600 }),
    });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its missing-token failure.');
    }
    expect(failure.message).toBe("IMDS response missing 'access_token' field");
    expect(failure.cause).toBeUndefined();
  });

  it.each([
    { name: 'numeric token', body: { access_token: 42 } },
    { name: 'boolean token', body: { access_token: true } },
    { name: 'object token', body: { access_token: { value: 'not-a-token' } } },
    { name: 'array token', body: { access_token: ['not-a-token'] } },
    { name: 'empty token', body: { access_token: '' } },
    { name: 'blank token', body: { access_token: ' \t\r\n ' } },
    { name: 'null response', body: null },
  ])('rejects $name with a typed error and releases its timer', async ({ body }) => {
    vi.useFakeTimers();
    const response = Response.json(body);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
    const result = provider.getToken();

    await expect(result).rejects.toBeInstanceOf(SubjectTokenProviderError);
    await expect(result).rejects.toMatchObject({
      message: "IMDS response missing 'access_token' field",
      provider: 'azure-imds',
    });
    expect(response.bodyUsed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([VALID_SUBJECT_TOKEN, ` ${VALID_SUBJECT_TOKEN} `])(
    'preserves nonempty Azure token text without rewriting it: %j',
    async (token) => {
      const provider = azureManagedIdentityTokenProvider(undefined, {
        fetch: async () => Response.json({ access_token: token }),
      });

      await expect(provider.getToken()).resolves.toBe(token);
    },
  );

  it('reads an own custom parsed token only once', async () => {
    const readToken = vi.fn<() => unknown>().mockReturnValueOnce(VALID_SUBJECT_TOKEN).mockReturnValue(42);
    const data = Object.defineProperty({}, 'access_token', { get: readToken });
    const response = new Response(null);
    vi.spyOn(response, 'json').mockResolvedValue(data);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

    await expect(provider.getToken()).resolves.toBe(VALID_SUBJECT_TOKEN);
    expect(readToken).toHaveBeenCalledTimes(1);
  });

  it.each(['data', 'accessor'] as const)('rejects inherited token %s before exchange', async (shape) => {
    vi.useFakeTimers();
    const readToken = vi.fn(() => VALID_SUBJECT_TOKEN);
    const prototype = Object.defineProperty(
      {},
      'access_token',
      shape === 'data' ? { value: VALID_SUBJECT_TOKEN } : { get: readToken },
    );
    const response = new Response(null);
    vi.spyOn(response, 'json').mockResolvedValue(Object.create(prototype));
    const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createWorkloadClient(
      azureManagedIdentityTokenProvider(undefined, { fetch: async () => response }),
      apiFetch,
    );

    const result = client.models.list();
    await expect(result).rejects.toBeInstanceOf(SubjectTokenProviderError);
    await expect(result).rejects.toMatchObject({
      message: "IMDS response missing 'access_token' field",
      provider: 'azure-imds',
    });
    expect(readToken).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects malformed token values before exchange and allows a subsequent valid request', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const metadataFetch = vi.fn(async () => Response.json({ access_token: { private_value: privateValue } }));
    const apiFetch = vi
      .fn(async () => new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'valid-openai-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ object: 'list', data: [] }));
    const client = createWorkloadClient(
      azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch }),
      apiFetch,
    );

    const failure = await client.models.list().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    expect(inspect(failure, { depth: null })).not.toContain(privateValue);
    expect(metadataFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();

    metadataFetch.mockResolvedValueOnce(Response.json({ access_token: VALID_SUBJECT_TOKEN }));

    const result = await client.models.list();
    expect(result.data).toEqual([]);
    expect(metadataFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('shares concurrent public failures and allows a subsequent valid workload exchange', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const metadataFetch = vi.fn(async () => new Response(`${privateValue} private customer record`));
    const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createWorkloadClient(
      azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch }),
      apiFetch,
    );
    const attempts = [client.models.list(), client.models.list(), client.models.list()];

    await Promise.all(attempts.map((operation) => expectPrivateParseFailure(() => operation, privateValue)));

    expect(metadataFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();

    metadataFetch.mockResolvedValueOnce(Response.json({ access_token: VALID_SUBJECT_TOKEN }));
    apiFetch
      .mockResolvedValueOnce(Response.json({ access_token: 'valid-openai-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ object: 'list', data: [] }));

    const result = await client.models.list();

    expect(result.data).toEqual([]);
    expect(metadataFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
