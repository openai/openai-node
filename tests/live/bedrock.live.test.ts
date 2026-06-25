import OpenAI from 'openai';
import type { Provider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock as awsBedrock } from 'openai/providers/bedrock/aws';

/**
 * Example:
 * BEDROCK_LIVE_TEST=1 BEDROCK_LIVE_AUTH=profile AWS_PROFILE=my-profile \
 * AWS_REGION=us-west-2 BEDROCK_MODEL=openai.gpt-oss-120b pnpm test:live:bedrock
 *
 * BEDROCK_MODEL must support the Responses API. A model returned by the Models
 * API may support a different Bedrock inference API instead.
 *
 * Set BEDROCK_LIVE_STREAM=1 to include a second, streaming inference request.
 */
const LIVE_TEST_FLAG = 'BEDROCK_LIVE_TEST';
const AUTH_MODE_ENV = 'BEDROCK_LIVE_AUTH';
const MODEL_ENV = 'BEDROCK_MODEL';
const STREAM_ENV = 'BEDROCK_LIVE_STREAM';
const LIVE_TEST_TIMEOUT = 180_000;

const authModes = [
  'bearer',
  'environment-bearer',
  'default-chain',
  'profile',
  'static',
  'custom-provider',
] as const;
type AuthMode = (typeof authModes)[number];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before running the Bedrock live test.`);
  return value;
}

function readAuthMode(): AuthMode {
  const value = requiredEnv(AUTH_MODE_ENV);
  if ((authModes as readonly string[]).includes(value)) return value as AuthMode;
  throw new Error(`${AUTH_MODE_ENV} must be one of: ${authModes.join(', ')}.`);
}

async function providerForAuth(
  mode: AuthMode,
  endpoint: { region: string; baseURL?: string | undefined },
): Promise<Provider> {
  switch (mode) {
    case 'bearer':
      return bearerBedrock({ ...endpoint, apiKey: requiredEnv('AWS_BEARER_TOKEN_BEDROCK') });
    case 'environment-bearer':
      requiredEnv('AWS_BEARER_TOKEN_BEDROCK');
      return bearerBedrock(endpoint);
    case 'default-chain':
      return awsBedrock({ ...endpoint, apiKey: null });
    case 'profile':
      return awsBedrock({ ...endpoint, apiKey: null, profile: requiredEnv('AWS_PROFILE') });
    case 'static': {
      const sessionToken = process.env['AWS_SESSION_TOKEN']?.trim();
      return awsBedrock({
        ...endpoint,
        apiKey: null,
        accessKeyId: requiredEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('AWS_SECRET_ACCESS_KEY'),
        ...(sessionToken ? { sessionToken } : {}),
      });
    }
    case 'custom-provider': {
      const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
      const profile = process.env['AWS_PROFILE']?.trim();
      return awsBedrock({
        ...endpoint,
        apiKey: null,
        credentialProvider: defaultProvider(profile ? { profile } : {}),
      });
    }
  }
}

if (process.env[LIVE_TEST_FLAG] !== '1') {
  throw new Error(
    `Refusing to make live AWS requests. Set ${LIVE_TEST_FLAG}=1 and use \`pnpm test:live:bedrock\`.`,
  );
}

const region = process.env['AWS_REGION']?.trim() || process.env['AWS_DEFAULT_REGION']?.trim();
if (!region) throw new Error('Set AWS_REGION or AWS_DEFAULT_REGION before running the Bedrock live test.');

const model = requiredEnv(MODEL_ENV);
const authMode = readAuthMode();
const baseURL = process.env['AWS_BEDROCK_BASE_URL']?.trim();
const runStreamingTest = process.env[STREAM_ENV] === '1';

jest.setTimeout(LIVE_TEST_TIMEOUT);

describe(`Amazon Bedrock live (${authMode})`, () => {
  let client: OpenAI;

  beforeAll(async () => {
    client = new OpenAI({
      provider: await providerForAuth(authMode, {
        region,
        ...(baseURL ? { baseURL } : {}),
      }),
      maxRetries: 0,
      timeout: 120_000,
    });
  });

  test('lists the configured model and creates a response', async () => {
    const models = await client.models.list();
    expect(models.data.map((candidate) => candidate.id)).toContain(model);

    const response = await client.responses.create({
      model,
      input: 'Reply with exactly: bedrock live test passed',
      store: false,
    });

    expect(response.id).toEqual(expect.any(String));
    expect(response.output_text.trim().length).toBeGreaterThan(0);
  });

  (runStreamingTest ? test : test.skip)('streams a response', async () => {
    const stream = await client.responses.create({
      model,
      input: 'Reply with exactly: bedrock streaming test passed',
      store: false,
      stream: true,
    });
    let eventCount = 0;
    let completed = false;

    for await (const event of stream) {
      eventCount += 1;
      completed ||= event.type === 'response.completed';
    }

    expect(eventCount).toBeGreaterThan(0);
    expect(completed).toBe(true);
  });
});
