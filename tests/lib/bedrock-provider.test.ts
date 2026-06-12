// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { bedrock, type BedrockProviderOptions } from 'openai/providers/bedrock';

import sigV4Fixture from '../fixtures/bedrock/v1/sigv4.json';

const originalEnv = process.env;
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
  for (const name of BEDROCK_ENVIRONMENT_VARIABLES) delete process.env[name];
});

afterEach(() => {
  jest.useRealTimers();
  process.env = originalEnv;
});

function jsonResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('bedrock provider', () => {
  test('owns the Mantle endpoint and bearer authentication', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
    expect(String(requestedURL)).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1/models');
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
  });

  test('keeps the environment bearer mode across withOptions and refreshes its value', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'first-token';
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse();
    };
    const client = new OpenAI({ provider: bedrock({ region: 'us-east-1' }), fetch });

    await client.request({ method: 'get', path: '/models' });
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    const copiedClient = client.withOptions({ timeout: 1_000 });
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'refreshed-token';
    await copiedClient.request({ method: 'get', path: '/models' });

    expect(authorizationHeaders).toEqual(['Bearer first-token', 'Bearer refreshed-token']);
  });

  test('apiKey: null skips the environment bearer fallback', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'environment-token';
    process.env['AWS_EC2_METADATA_DISABLED'] = 'true';
    const fetch = jest.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', apiKey: null }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'Could not find credentials for Bedrock',
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  test('baseURL: null skips the environment endpoint fallback', () => {
    process.env['AWS_BEDROCK_BASE_URL'] = 'https://environment.example/v1';

    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', baseURL: null, apiKey: 'bedrock-token' }),
    });

    expect(client.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
  });

  test('matches the canonical SigV4 fixture and disables automatic redirects', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(sigV4Fixture.signingDate));
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({
        region: sigV4Fixture.region,
        accessKeyId: sigV4Fixture.credentials.accessKeyId,
        secretAccessKey: sigV4Fixture.credentials.secretAccessKey,
        sessionToken: sigV4Fixture.credentials.sessionToken,
      }),
      organization: null,
      project: null,
      defaultHeaders: {
        accept: null,
        'user-agent': null,
        'x-stainless-retry-count': null,
        'x-stainless-lang': null,
        'x-stainless-package-version': null,
        'x-stainless-os': null,
        'x-stainless-arch': null,
        'x-stainless-runtime': null,
        'x-stainless-runtime-version': null,
      },
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({
      method: 'post',
      path: '/responses',
      body: sigV4Fixture.request.body,
      headers: { 'content-type': sigV4Fixture.request.contentType },
    });

    const headers = new Headers(requestedInit?.headers);
    expect(String(requestedURL)).toBe(sigV4Fixture.request.url);
    expect(requestedInit?.method).toBe(sigV4Fixture.request.method);
    expect(requestedInit?.redirect).toBe('manual');
    expect(requestedInit?.body).toBe(sigV4Fixture.request.body);
    expect(headers.get('x-amz-date')).toBe(sigV4Fixture.expected.date);
    expect(headers.get('x-amz-content-sha256')).toBe(sigV4Fixture.expected.payloadHash);
    expect(headers.get('x-amz-security-token')).toBe(sigV4Fixture.credentials.sessionToken);
    expect(headers.get('authorization')).toBe(sigV4Fixture.expected.authorization);
  });

  test('rejects a custom Authorization header before fetch', async () => {
    const fetch = jest.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch,
    });

    await expect(
      client.request({
        method: 'get',
        path: '/models',
        headers: { authorization: 'Bearer custom-token' },
      }),
    ).rejects.toThrow('cannot be combined with a custom `Authorization` header');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects non-replayable SigV4 bodies before fetch', async () => {
    const fetch = jest.fn(async () => jsonResponse());
    const body = new FormData();
    body.append('input', 'hello');
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch,
    });

    await expect(client.request({ method: 'post', path: '/responses', body })).rejects.toThrow(
      'requires a replayable request body',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects a canonical endpoint whose region does not match the signing region', async () => {
    const fetch = jest.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        baseURL: 'https://bedrock-mantle.us-west-2.api.aws/openai/v1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'endpoint region `us-west-2` does not match the SigV4 region `us-east-1`',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each<[string, BedrockProviderOptions]>([
    ['empty access key ID', { accessKeyId: '', secretAccessKey: 'secret-key' }],
    ['empty secret access key', { accessKeyId: 'access-key', secretAccessKey: '' }],
    ['empty session token', { accessKeyId: 'access-key', secretAccessKey: 'secret-key', sessionToken: '' }],
    ['empty profile', { profile: ' ' }],
    ['empty bearer credential', { apiKey: ' ' }],
    ['empty region', { region: ' ' }],
    ['empty base URL', { baseURL: ' ' }],
  ])('rejects an explicit %s instead of falling back to ambient credentials', (_name, options) => {
    expect(() => bedrock({ region: 'us-east-1', ...options })).toThrow(/must not be empty|non-empty/);
  });
});
