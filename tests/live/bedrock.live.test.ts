import OpenAI from 'openai';
import { bedrock, type BedrockProviderOptions } from 'openai/providers/bedrock';

/**
 * Example:
 * BEDROCK_LIVE_TEST=1 BEDROCK_LIVE_AUTH=profile AWS_PROFILE=my-profile \
 * AWS_REGION=us-west-2 BEDROCK_MODEL=openai.gpt-5.4 npm run test:live:bedrock
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

async function authOptions(mode: AuthMode): Promise<BedrockProviderOptions> {
  switch (mode) {
    case 'bearer':
      return { apiKey: requiredEnv('AWS_BEARER_TOKEN_BEDROCK') };
    case 'environment-bearer':
      requiredEnv('AWS_BEARER_TOKEN_BEDROCK');
      return {};
    case 'default-chain':
      return { apiKey: null };
    case 'profile':
      return { apiKey: null, profile: requiredEnv('AWS_PROFILE') };
    case 'static': {
      const sessionToken = process.env['AWS_SESSION_TOKEN']?.trim();
      return {
        apiKey: null,
        accessKeyId: requiredEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('AWS_SECRET_ACCESS_KEY'),
        ...(sessionToken ? { sessionToken } : {}),
      };
    }
    case 'custom-provider': {
      const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
      const profile = process.env['AWS_PROFILE']?.trim();
      return {
        apiKey: null,
        credentialProvider: defaultProvider(profile ? { profile } : {}),
      };
    }
  }
}

if (process.env[LIVE_TEST_FLAG] !== '1') {
  throw new Error(
    `Refusing to make live AWS requests. Set ${LIVE_TEST_FLAG}=1 and use \`npm run test:live:bedrock\`.`,
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
      provider: bedrock({
        region,
        ...(baseURL ? { baseURL } : {}),
        ...(await authOptions(authMode)),
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
