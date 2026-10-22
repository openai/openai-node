// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { vi } from 'vitest';
import OpenAI, { AzureOpenAI, BedrockOpenAI } from 'openai';
import type { ClientOptions, DataResidency } from 'openai';
import { createProvider } from 'openai/internal/provider';

const endpoints: [DataResidency, string][] = [
  ['global', 'https://api.openai.com/v1'],
  ['us', 'https://us.api.openai.com/v1'],
  ['eu', 'https://eu.api.openai.com/v1'],
  ['ae', 'https://ae.api.openai.com/v1'],
];
const endpoint = (region: DataResidency): string => new Map(endpoints).get(region)!;

beforeEach(() => {
  for (const name of ['OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'OPENAI_BASE_URL', 'OPENAI_CUSTOM_HEADERS']) {
    // Explicit undefined tells Vitest to remove the environment variable.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => vi.unstubAllEnvs());

describe('data residency', () => {
  test.each(endpoints)('routes %s through the existing base URL', async (dataResidency, endpoint) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: 'resp_test', output: [] }));
    const client = new OpenAI({ apiKey: 'test-key', fetch, dataResidency });
    await client.responses.create({ model: 'test-model', input: 'Hello' });

    expect(client.baseURL).toBe(endpoint);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${endpoint}/responses`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
    expect(new Headers(init?.headers).has('data-residency')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'test-model', input: 'Hello' });
  });

  test('copies, replaces and clears routing without sticky residency state', () => {
    const original = new OpenAI({ apiKey: 'test-key', baseURL: 'https://custom.example/v1' });
    const eu = original.withOptions({ dataResidency: 'eu' });
    const us = eu.withOptions({ dataResidency: 'us' });
    const custom = us.withOptions({ baseURL: 'https://another.example/v1' });
    expect(original.baseURL).toBe('https://custom.example/v1');
    expect(eu.baseURL).toBe(endpoint('eu'));
    expect(eu.responses).not.toBe(original.responses);
    expect(eu.withOptions({}).baseURL).toBe(eu.baseURL);
    expect(eu.withOptions({ dataResidency: null }).baseURL).toBe(eu.baseURL);
    expect(eu.withOptions({ dataResidency: undefined }).baseURL).toBe(eu.baseURL);
    expect(us.baseURL).toBe(endpoint('us'));
    expect(custom.baseURL).toBe('https://another.example/v1');
    expect(custom.withOptions({ dataResidency: 'global' }).baseURL).toBe(endpoint('global'));
  });

  test('overrides environment routing but treats null residency as omitted', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://environment.example/v1');
    expect(new OpenAI({ apiKey: 'test-key', dataResidency: 'eu' }).baseURL).toBe(endpoint('eu'));
    expect(new OpenAI({ apiKey: 'test-key', dataResidency: 'global' }).baseURL).toBe(endpoint('global'));
    expect(new OpenAI({ apiKey: 'test-key', dataResidency: null }).baseURL).toBe(
      'https://environment.example/v1',
    );
  });

  test('keeps an explicit global selection ahead of per-resource defaults across copies', async () => {
    const alternate = 'https://alternate.example/v1';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    const implicit = new OpenAI({ apiKey: 'test-key', fetch });
    const global = implicit.withOptions({ dataResidency: 'global' });
    const copied = global.withOptions({ timeout: 1000 }).withOptions({ dataResidency: null });
    expect(implicit.buildURL('/models', null, alternate)).toBe(`${alternate}/models`);
    expect(
      new OpenAI({ apiKey: 'test-key', dataResidency: 'global' }).buildURL('/models', null, alternate),
    ).toBe(`${endpoint('global')}/models`);
    expect(copied.buildURL('/models', null, alternate)).toBe(`${endpoint('global')}/models`);
    await copied.request({ method: 'get', path: '/models', defaultBaseURL: alternate });
    expect(fetch).toHaveBeenCalledWith(`${endpoint('global')}/models`, expect.anything());
    expect(global.withOptions({ baseURL: null }).buildURL('/models', null, alternate)).toBe(
      `${alternate}/models`,
    );
    expect(
      global.withOptions({ baseURL: 'https://custom.example/v1' }).buildURL('/models', null, alternate),
    ).toBe('https://custom.example/v1/models');
  });

  test('initializes copied residency before subclass fields and constructors use routing', () => {
    const alternate = 'https://alternate.example/v1';
    class RoutedClient extends OpenAI {
      readonly initializedURL = this.buildURL('/models', null, alternate);
      readonly constructedURL: string;

      constructor(options: ClientOptions) {
        // Common subclass forwarding must preserve the internal selection marker.
        super({ ...options });
        this.constructedURL = this.buildURL('/responses', null, alternate);
      }
    }

    const implicit = new RoutedClient({ apiKey: 'test-key' });
    const global = implicit.withOptions({ dataResidency: 'global' });
    const copied = global.withOptions({ timeout: 1000 }).withOptions({ dataResidency: null });
    expect(implicit.withOptions({}).initializedURL).toBe(`${alternate}/models`);
    expect(global.initializedURL).toBe(`${endpoint('global')}/models`);
    expect(copied.initializedURL).toBe(`${endpoint('global')}/models`);
    expect(copied.constructedURL).toBe(`${endpoint('global')}/responses`);
    expect(global.withOptions({ baseURL: null }).constructedURL).toBe(`${alternate}/responses`);
  });

  test.each([
    { dataResidency: 'eu', baseURL: 'https://custom.example/v1' },
    { baseURL: 'https://custom.example/v1', dataResidency: 'eu' },
    { dataResidency: 'eu', baseURL: '' },
    { dataResidency: 'eu', baseURL: null },
    { baseURL: null, dataResidency: 'eu' },
    { dataResidency: 'eu', baseURL: undefined },
    { baseURL: undefined, dataResidency: 'eu' },
  ] satisfies ClientOptions[])('rejects conflicting options: %j', (options) => {
    const client = new OpenAI({ apiKey: 'test-key' });
    expect(() => new OpenAI({ apiKey: 'test-key', ...options })).toThrow('mutually exclusive');
    expect(() => client.withOptions(options)).toThrow('mutually exclusive');
  });

  test.each(['', 'EU', 'apac', '__proto__', 'constructor', 1, {}])(
    'rejects an invalid runtime value: %j',
    (value) => {
      const options = { dataResidency: value as DataResidency };
      expect(() => new OpenAI({ apiKey: 'test-key', ...options })).toThrow('Invalid `dataResidency`');
      expect(() => new OpenAI({ apiKey: 'test-key' }).withOptions(options)).toThrow(
        'Invalid `dataResidency`',
      );
    },
  );

  test('rejects active providers without configuring or sending credentials', () => {
    const configure = vi.fn(() => ({ name: 'test', baseURL: 'https://provider.example/v1' }));
    const provider = createProvider({ configure });
    const fetch = vi.fn(async () => Response.json({}));
    expect(() => new OpenAI({ provider, dataResidency: 'eu', fetch })).toThrow('`dataResidency`');
    expect(configure).not.toHaveBeenCalled();
    const client = new OpenAI({ provider, fetch });
    expect(() => client.withOptions({ dataResidency: 'eu' })).toThrow('`dataResidency`');
    expect(fetch).not.toHaveBeenCalled();
    const regional = new OpenAI({ apiKey: 'test-key', dataResidency: 'eu' });
    expect(regional.withOptions({ provider }).baseURL).toBe('https://provider.example/v1');
    expect(client.withOptions({ dataResidency: null }).baseURL).toBe(client.baseURL);
  });

  test('legacy provider clients cannot route provider credentials to OpenAI', () => {
    const azure = new AzureOpenAI({
      apiKey: 'azure-key',
      apiVersion: 'test-version',
      endpoint: 'https://test.openai.azure.com',
    });
    const bedrock = new BedrockOpenAI({ apiKey: 'bedrock-key', awsRegion: 'us-east-1' });
    // @ts-expect-error OpenAI residency is not a valid Azure clone option.
    expect(() => azure.withOptions({ dataResidency: 'eu' })).toThrow('does not support `dataResidency`');
    // Exercise JavaScript callers that do not receive the provider-specific type error.
    expect(() => (bedrock as OpenAI).withOptions({ dataResidency: 'eu' })).toThrow(
      'does not support `dataResidency`',
    );
    // @ts-expect-error OpenAI residency is not a valid Azure constructor option.
    expect(() => new AzureOpenAI({ dataResidency: 'eu' })).toThrow('does not support `dataResidency`');
    // @ts-expect-error OpenAI residency is not a valid Bedrock constructor option.
    expect(() => new BedrockOpenAI({ dataResidency: 'eu' })).toThrow('does not support `dataResidency`');
  });

  test('streaming uses the derived endpoint', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const stream = await client.withOptions({ dataResidency: 'eu' }).responses.create({
      model: 'test-model',
      input: 'Hello',
      stream: true,
    });
    for await (const _event of stream) {
      /* The fixture completes without events. */
    }
    expect(fetch).toHaveBeenCalledWith(`${endpoint('eu')}/responses`, expect.anything());
    expect(client.baseURL).toBe(endpoint('global'));
  });

  test('exposes the type from both public entrypoints', () => {
    const named: DataResidency = 'eu';
    const namespaced: OpenAI.DataResidency = named;
    expect(namespaced).toBe('eu');
  });
});
