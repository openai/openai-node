import { once } from 'node:events';
import { vi } from 'vitest';

import OpenAI, { NotFoundError } from 'openai';
import type { Provider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';

type Endpoint = 'mantle' | 'runtime';
interface EndpointOptions {
  endpoint?: Endpoint;
  region?: string;
  baseURL?: string;
}

const originalEnv = process.env;
const RUNTIME_MODEL = 'us.openai.gpt-5.6-sol';
const INVALID_REGION = 'us-east-1.amazonaws.com@attacker.example#';
const CANONICAL_ENDPOINTS = [
  ['mantle', 'us-east-1', 'api.aws', 'api.aws'],
  ['runtime', 'us-east-1', 'amazonaws.com', 'api.aws'],
  ['runtime', 'cn-north-1', 'amazonaws.com.cn', 'api.amazonwebservices.com.cn'],
  ['runtime', 'eusc-de-east-1', 'amazonaws.eu', 'api.amazonwebservices.eu'],
  ['runtime', 'us-iso-east-1', 'c2s.ic.gov', 'api.aws.ic.gov'],
  ['runtime', 'us-isob-east-1', 'sc2s.sgov.gov', 'api.aws.scloud'],
  ['runtime', 'eu-isoe-west-1', 'cloud.adc-e.uk', 'api.cloud-aws.adc-e.uk'],
  ['runtime', 'us-isof-south-1', 'csp.hci.ic.gov', 'api.aws.hci.ic.gov'],
] as const;
const BEDROCK_ENVIRONMENT_VARIABLES = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_BEDROCK_BASE_URL',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_EC2_METADATA_DISABLED',
] as const;

beforeEach(() => {
  process.env = { ...originalEnv };
  for (const name of BEDROCK_ENVIRONMENT_VARIABLES) {
    Reflect.deleteProperty(process.env, name);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = originalEnv;
});

function providerCases(options: EndpointOptions) {
  return [
    { authentication: 'bearer', create: () => bearerBedrock({ ...options, apiKey: 'bedrock-token' }) },
    {
      authentication: 'SigV4',
      create: () => bedrock({ ...options, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
    },
  ] as const;
}

function createClient(provider: Provider, body: unknown = {}, responseInit?: ResponseInit) {
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const client = new OpenAI({
    provider,
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      return Response.json(body, responseInit);
    },
  });
  return { client, requests };
}

function expectRejected(options: EndpointOptions, expectedError: RegExp): void {
  const fetch = vi.fn(async () => Response.json({}));
  for (const { create } of providerCases(options)) {
    expect(() => new OpenAI({ provider: create(), fetch })).toThrow(expectedError);
  }
  expect(fetch).not.toHaveBeenCalled();
}

async function expectAccepted(options: EndpointOptions, baseURL: string): Promise<void> {
  await Promise.all(
    providerCases(options).map(async ({ authentication, create }) => {
      const { client, requests } = createClient(create());
      expect(client.baseURL).toBe(baseURL);
      await client.request({ method: 'get', path: '/models' });
      expect(requests[0]?.url).toBe(`${baseURL}/models`);
      expect(requests[0]?.headers.get('authorization')).toContain(
        authentication === 'bearer'
          ? 'Bearer bedrock-token'
          : `/${options.region}/${options.endpoint === 'mantle' ? 'bedrock-mantle' : 'bedrock'}/aws4_request`,
      );
    }),
  );
}

describe('bedrock Runtime provider', () => {
  test.each(CANONICAL_ENDPOINTS)(
    'derives and secures canonical, FIPS, and dual-stack %s endpoints in %s',
    async (endpoint, region, suffix, dualStackSuffix) => {
      const hostname = `bedrock-${endpoint}.${region}.${suffix}`;
      const { client: defaultClient } = createClient(
        bearerBedrock({ endpoint, region, apiKey: 'bedrock-token' }),
      );
      expect(defaultClient.baseURL).toBe(`https://${hostname}/openai/v1`);

      const hostnames =
        endpoint === 'mantle'
          ? [hostname]
          : [suffix, dualStackSuffix].flatMap((dnsSuffix) => [
              `bedrock-runtime.${region}.${dnsSuffix}`,
              `bedrock-runtime-fips.${region}.${dnsSuffix}`,
            ]);
      await Promise.all(
        hostnames.map(async (canonicalHostname) => {
          const baseURL = `https://${canonicalHostname}./openai/v1`;
          await expectAccepted({ endpoint, region, baseURL }, baseURL);
          if (endpoint === 'runtime') {
            await expectAccepted({ region, baseURL }, baseURL);
          }
          expectRejected({ endpoint, region, baseURL: `http://${canonicalHostname}./openai/v1` }, /HTTPS/iu);
          expectRejected(
            { endpoint: endpoint === 'runtime' ? 'mantle' : 'runtime', region, baseURL },
            /endpoint|mode/iu,
          );
          expectRejected(
            { endpoint, region: region === 'us-east-1' ? 'us-west-2' : 'us-east-1', baseURL },
            /endpoint region.*does not match/iu,
          );
        }),
      );
    },
  );

  test('infers Runtime routing and signing from an environment base URL', async () => {
    const baseURL = 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1';
    process.env['AWS_BEDROCK_BASE_URL'] = baseURL;
    await expectAccepted({ region: 'us-east-1' }, baseURL);
  });

  test.each(['AWS_REGION', 'AWS_DEFAULT_REGION'] as const)(
    'derives the Runtime region from %s',
    (environmentVariable) => {
      process.env[environmentVariable] = 'us-west-2';
      const { client } = createClient(bearerBedrock({ endpoint: 'runtime', apiKey: 'bedrock-token' }));
      expect(client.baseURL).toBe('https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1');
    },
  );

  test.each([
    ['userinfo and fragment injection', INVALID_REGION],
    ['path injection', 'us-east-1/../../attacker.example'],
    ['query injection', 'us-east-1?target=attacker.example'],
    ['malformed region', 'not-a-region'],
  ])('rejects %s in explicit regions for both endpoint and authentication modes', (_scenario, region) => {
    for (const endpoint of ['mantle', 'runtime'] as const) {
      expectRejected({ endpoint, region }, /region.*invalid|invalid.*region|valid.*region/iu);
    }
  });

  test.each(['AWS_REGION', 'AWS_DEFAULT_REGION'] as const)(
    'rejects injected AWS regions from %s',
    (environmentVariable) => {
      process.env[environmentVariable] = INVALID_REGION;
      for (const endpoint of ['mantle', 'runtime'] as const) {
        expectRejected({ endpoint }, /region.*invalid|invalid.*region|valid.*region/iu);
      }
    },
  );

  test.each(['mantle', 'runtime'] as const)(
    'rejects invalid %s signing regions for custom proxies',
    (endpoint) => {
      expectRejected(
        { endpoint, region: INVALID_REGION, baseURL: 'https://proxy.example.com/openai/v1' },
        /region.*invalid|invalid.*region|valid.*region/iu,
      );
    },
  );

  test.each([
    { mode: 'explicit bearer', apiKey: 'bedrock-token', authorization: /^Bearer bedrock-token$/u },
    { mode: 'environment bearer', apiKey: undefined, authorization: /^Bearer stale-bedrock-token$/u },
    {
      mode: 'AWS credential chain without stale bearer',
      apiKey: null,
      authorization: /Credential=ambient-access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/u,
    },
  ])(
    'selects Runtime $mode when AWS and bearer environment credentials coexist',
    async ({ apiKey, authorization }) => {
      process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'stale-bedrock-token';
      process.env['AWS_ACCESS_KEY_ID'] = 'ambient-access-key';
      process.env['AWS_SECRET_ACCESS_KEY'] = 'ambient-secret-key';
      const { client, requests } = createClient(
        bedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey }),
      );

      await client.request({ method: 'get', path: '/models' });

      expect(requests[0]?.url).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/models');
      expect(requests[0]?.headers.get('authorization')).toMatch(authorization);
    },
  );

  test('routes Runtime Chat Completions and signs the request for the bedrock service', async () => {
    const completionBody = {
      id: 'chatcmpl_runtime',
      object: 'chat.completion',
      model: RUNTIME_MODEL,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    };
    const { client, requests } = createClient(
      bedrock({
        endpoint: 'runtime',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      completionBody,
      { headers: { 'x-request-id': 'req_runtime_chat' } },
    );

    const completion = await client.chat.completions.create({
      model: RUNTIME_MODEL,
      messages: [{ role: 'user', content: 'Say hello' }],
    });

    expect(requests[0]?.url).toBe(
      'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions',
    );
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({ model: RUNTIME_MODEL });
    expect(requests[0]?.headers.get('authorization')).toContain('/bedrock/aws4_request');
    expect(completion._request_id).toBe('req_runtime_chat');
    expect(completion.choices[0]?.finish_reason).toBe('stop');
    expect(completion.usage?.total_tokens).toBe(7);
  });

  test('routes Runtime Responses through the dependency-free bearer provider', async () => {
    const { client, requests } = createClient(
      bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      { id: 'resp_runtime', object: 'response', model: RUNTIME_MODEL, output: [] },
    );

    await client.responses.create({ model: RUNTIME_MODEL, input: 'Say hello' });

    expect(requests[0]?.url).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/responses');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer bedrock-token');
  });

  test('preserves Runtime request IDs on typed HTTP errors', async () => {
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          { error: { message: 'Runtime model is unavailable' } },
          { status: 404, headers: { 'x-request-id': 'req_runtime_error' } },
        ),
    });

    const runtimeError = await client.chat.completions
      .create({ model: RUNTIME_MODEL, messages: [{ role: 'user', content: 'Say hello' }] })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(runtimeError).toBeInstanceOf(NotFoundError);
    expect(runtimeError).toMatchObject({
      status: 404,
      requestID: 'req_runtime_error',
      message: expect.stringContaining('Runtime model is unavailable'),
    });
  });

  test.each(['429', 'timeout'] as const)(
    'refreshes AWS credentials and re-signs Runtime %s retries',
    async (retryKind) => {
      let attempt = 0;
      const credentialProvider = vi.fn(async () => {
        attempt += 1;
        return {
          accessKeyId: `access-${attempt}`,
          secretAccessKey: 'secret',
          sessionToken: `session-${attempt}`,
        };
      });
      const headers: Headers[] = [];
      const client = new OpenAI({
        provider: bedrock({ endpoint: 'runtime', region: 'us-east-1', credentialProvider }),
        maxRetries: 1,
        timeout: retryKind === 'timeout' ? 10 : 600_000,
        fetch: async (_url, init) => {
          headers.push(new Headers(init?.headers));
          if (headers.length > 1) {
            return Response.json({});
          }
          if (retryKind === '429') {
            return Response.json(
              { error: { message: 'retry' } },
              { status: 429, headers: { 'retry-after-ms': '1' } },
            );
          }
          const signal = init?.signal;
          if (!signal) {
            throw new Error('missing request signal');
          }
          await once(signal, 'abort');
          throw new Error('timed out');
        },
      });

      await client.request({ method: 'get', path: '/models' });

      expect(credentialProvider).toHaveBeenCalledTimes(2);
      expect(headers.map((request) => request.get('x-amz-security-token'))).toEqual([
        'session-1',
        'session-2',
      ]);
      expect(headers[0]?.get('authorization')).toMatch(/Credential=access-1\/\d{8}\/us-east-1\/bedrock\//u);
      expect(headers[1]?.get('authorization')).toMatch(/Credential=access-2\/\d{8}\/us-east-1\/bedrock\//u);
    },
  );
});
