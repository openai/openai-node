import { getCanonicalQuery, SignatureV4 } from '@smithy/signature-v4';
import { vi } from 'vitest';

import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import type { Provider } from 'openai/internal/provider';
import type { FinalizedRequestInit } from 'openai/internal/types';
import { bedrock } from 'openai/providers/bedrock/aws';

type Endpoint = 'mantle' | 'runtime';

const endpointCases = [
  { endpoint: 'mantle', signingService: 'bedrock-mantle' },
  { endpoint: 'runtime', signingService: 'bedrock' },
] as const;

const inheritedQueryNames = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
] as const;

const rejectedPrototypeQueries = [
  '__proto__=unsafe',
  '%5F%5Fproto%5F%5F=unsafe',
  '%5f%5fproto%5f%5f=unsafe',
  'ordinary=safe&__proto__=unsafe',
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function staticProvider(endpoint: Endpoint): Provider {
  return bedrock({
    endpoint,
    region: 'us-east-1',
    baseURL: null,
    apiKey: null,
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
  });
}

function mockFetch() {
  return vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
}

function firstSignedRequest(calls: Parameters<SignatureV4['sign']>[]) {
  const [firstCall] = calls;
  if (!firstCall) {
    throw new Error('Expected the Bedrock request to be signed.');
  }
  const [request] = firstCall;
  return request;
}

describe('Bedrock SigV4 query parameter safety', () => {
  test.each(endpointCases)(
    'signs repeated query values without repeatedly traversing earlier values for $endpoint',
    async ({ endpoint, signingService }) => {
      const marker = 'synthetic-repeated-query-value';
      const values = Object.freeze(Array.from({ length: 256 }, (_, index) => `${marker}-${index}`));
      const extraValues = Object.freeze(['', 'one two', 'snowman☃', 'a+b']);
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const fetch = mockFetch();
      const client = new OpenAI({ provider: staticProvider(endpoint), fetch, maxRetries: 0 });
      const originalIterator = Array.prototype[Symbol.iterator];
      let visitedValues = 0;
      // oxlint-disable-next-line no-extend-native -- Count real traversal work; a Vitest iterator spy recursively invokes itself.
      Array.prototype[Symbol.iterator] = function* countArrayValues(
        this: unknown[],
      ): Generator<unknown, undefined, unknown> {
        for (const value of originalIterator.call(this)) {
          if (typeof value === 'string' && value.startsWith(marker)) {
            visitedValues += 1;
          }
          yield value;
        }
      };

      try {
        await client.get('/models', { query: { tag: values, extra: extraValues } });
      } finally {
        // oxlint-disable-next-line no-extend-native -- Restore the native iterator even when the request fails.
        Array.prototype[Symbol.iterator] = originalIterator;
      }

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      const signedRequest = firstSignedRequest(sign.mock.calls);
      expect(signedRequest.query).toEqual({ 'tag[]': values, 'extra[]': extraValues });
      const [request] = fetch.mock.calls;
      if (!request) {
        throw new Error('Expected the signed request to be sent.');
      }
      const [url, init] = request;
      expect(new URL(String(url)).searchParams.getAll('tag[]')).toEqual(values);
      expect(new URL(String(url)).searchParams.getAll('extra[]')).toEqual(extraValues);
      expect(new Headers(init?.headers).get('authorization')).toContain(
        `/us-east-1/${signingService}/aws4_request`,
      );
      // Count work rather than elapsed time so repeated array copies fail deterministically.
      expect(visitedValues).toBeLessThanOrEqual(values.length * 4);
    },
  );

  test.each(
    endpointCases.flatMap(({ endpoint, signingService }) =>
      inheritedQueryNames.map((queryName) => ({ endpoint, signingService, queryName })),
    ),
  )(
    'signs $endpoint requests with the inherited $queryName query name',
    async ({ endpoint, signingService, queryName }) => {
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const fetch = mockFetch();
      const client = new OpenAI({
        provider: staticProvider(endpoint),
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: `/models?${queryName}=safe-value` });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);

      const signedRequest = firstSignedRequest(sign.mock.calls);
      expect(signedRequest.query).toEqual({ [queryName]: 'safe-value' });
      expect(getCanonicalQuery(signedRequest)).toBe(`${queryName}=safe-value`);
      expect(Object.getPrototypeOf(signedRequest.query ?? {})).toBeNull();

      const authorization = new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization');
      expect(authorization).toContain('AWS4-HMAC-SHA256');
      expect(authorization).toContain(`/us-east-1/${signingService}/aws4_request`);
    },
  );

  test.each(endpointCases)(
    'preserves duplicate inherited query names at the $endpoint signing boundary',
    async ({ endpoint, signingService }) => {
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const runtime = configureProvider(staticProvider(endpoint));
      const request: FinalizedRequestInit = { method: 'GET', headers: new Headers() };

      await runtime.prepareRequest?.(request, {
        url: `${runtime.baseURL}/models?constructor=first&constructor=second&toString=alpha&toString=beta`,
        options: { method: 'get', path: '/models' },
      });

      expect(sign).toHaveBeenCalledTimes(1);

      const signedRequest = firstSignedRequest(sign.mock.calls);
      expect(signedRequest.query).toEqual({
        constructor: ['first', 'second'],
        toString: ['alpha', 'beta'],
      });
      expect(getCanonicalQuery(signedRequest)).toBe(
        'constructor=first&constructor=second&toString=alpha&toString=beta',
      );
      expect(request.headers.get('authorization')).toContain(`/us-east-1/${signingService}/aws4_request`);
    },
  );

  test.each(endpointCases)(
    'keeps ordinary query parameters and valid signatures for $endpoint',
    async ({ endpoint, signingService }) => {
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const fetch = mockFetch();
      const client = new OpenAI({
        provider: staticProvider(endpoint),
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method: 'get',
        path: '/models?ordinary=one&constructorSafe=two&prototype=three',
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(getCanonicalQuery(firstSignedRequest(sign.mock.calls))).toBe(
        'constructorSafe=two&ordinary=one&prototype=three',
      );
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toContain(
        `/us-east-1/${signingService}/aws4_request`,
      );
    },
  );

  test.each(
    endpointCases.flatMap(({ endpoint }) => rejectedPrototypeQueries.map((query) => ({ endpoint, query }))),
  )(
    'rejects $endpoint query $query before resolving AWS credentials or sending',
    async ({ endpoint, query }) => {
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const credentialProvider = vi.fn(async () => ({
        accessKeyId: 'rotating-access-key',
        secretAccessKey: 'rotating-secret-key',
      }));
      const fetch = mockFetch();
      const client = new OpenAI({
        provider: bedrock({
          endpoint,
          region: 'us-east-1',
          baseURL: null,
          apiKey: null,
          credentialProvider,
        }),
        fetch,
        maxRetries: 0,
      });

      await expect(client.request({ method: 'get', path: `/models?${query}` })).rejects.toThrow(
        'The Bedrock SigV4 signer cannot safely sign a `__proto__` query parameter.',
      );

      expect(sign).not.toHaveBeenCalled();
      expect(credentialProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
