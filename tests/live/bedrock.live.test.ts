import OpenAI from 'openai';
import type { Provider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock as awsBedrock } from 'openai/providers/bedrock/aws';

/**
 * Example:
 * BEDROCK_LIVE_TEST=1 BEDROCK_LIVE_AUTH=profile AWS_PROFILE=my-profile \
 * AWS_REGION=us-west-2 BEDROCK_MODEL=openai.gpt-oss-120b pnpm test:live:bedrock
 *
 * BEDROCK_LIVE_TEST=1 BEDROCK_LIVE_ENDPOINT=runtime BEDROCK_LIVE_AUTH=default-chain \
 * AWS_REGION=us-west-2 pnpm test:live:bedrock
 *
 * To exercise several credential paths in one explicitly enabled run, set
 * BEDROCK_LIVE_AUTHS to a comma-separated list such as
 * bearer,token-provider,default-chain. The token-provider mode resolves
 * AWS_BEARER_TOKEN_BEDROCK again before each request attempt.
 * Every selected mode still requires its corresponding valid credential
 * configuration.
 *
 * Mantle requires BEDROCK_MODEL to support the Responses API. Runtime defaults
 * to the three US CRIS inference profiles and tests Chat Completions. Set
 * BEDROCK_MODEL to one profile, or BEDROCK_LIVE_MODELS to a comma-separated
 * override such as global.openai.gpt-5.6-sol.
 *
 * Set BEDROCK_LIVE_STREAM=1 to include streaming inference requests. Runtime
 * Responses compatibility is opt-in with BEDROCK_LIVE_RESPONSES=1. Override the
 * endpoint, including its route, with AWS_BEDROCK_BASE_URL when necessary.
 */
const LIVE_TEST_FLAG = 'BEDROCK_LIVE_TEST';
const AUTH_MODE_ENV = 'BEDROCK_LIVE_AUTH';
const AUTH_MODE_LIST_ENV = 'BEDROCK_LIVE_AUTHS';
const ENDPOINT_MODE_ENV = 'BEDROCK_LIVE_ENDPOINT';
const MODEL_ENV = 'BEDROCK_MODEL';
const MODEL_LIST_ENV = 'BEDROCK_LIVE_MODELS';
const RESPONSES_ENV = 'BEDROCK_LIVE_RESPONSES';
const STREAM_ENV = 'BEDROCK_LIVE_STREAM';
const LIVE_TEST_TIMEOUT = 180_000;
const DEFAULT_RUNTIME_MODELS = [
  'us.openai.gpt-5.6-sol',
  'us.openai.gpt-5.6-terra',
  'us.openai.gpt-5.6-luna',
] as const;

const endpointModes = ['mantle', 'runtime'] as const;
type EndpointMode = (typeof endpointModes)[number];

const authModes = [
  'bearer',
  'environment-bearer',
  'token-provider',
  'default-chain',
  'profile',
  'static',
  'custom-provider',
] as const;
type AuthMode = (typeof authModes)[number];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} before running the Bedrock live test.`);
  }
  return value;
}

function readAuthModes(): AuthMode[] {
  const configuredModes = process.env[AUTH_MODE_LIST_ENV];
  const configuredEnv = configuredModes === undefined ? AUTH_MODE_ENV : AUTH_MODE_LIST_ENV;
  const values =
    configuredModes === undefined
      ? [requiredEnv(AUTH_MODE_ENV)]
      : requiredEnv(AUTH_MODE_LIST_ENV)
          .split(',')
          .map((mode) => mode.trim())
          .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${configuredEnv} must include at least one authentication mode.`);
  }

  const invalidModes = values.filter((value) => !(authModes as readonly string[]).includes(value));
  if (invalidModes.length > 0) {
    throw new Error(
      `${configuredEnv} contains unsupported mode(s): ${invalidModes.join(', ')}. ` +
        `Use: ${authModes.join(', ')}.`,
    );
  }

  return [...new Set(values)] as AuthMode[];
}

function readEndpointMode(): EndpointMode {
  const value = process.env[ENDPOINT_MODE_ENV]?.trim() || 'mantle';
  if ((endpointModes as readonly string[]).includes(value)) {
    return value as EndpointMode;
  }
  throw new Error(`${ENDPOINT_MODE_ENV} must be one of: ${endpointModes.join(', ')}.`);
}

function readModels(endpoint: EndpointMode): string[] {
  const configuredModels = process.env[MODEL_LIST_ENV];
  if (configuredModels !== undefined) {
    const models = requiredEnv(MODEL_LIST_ENV)
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length === 0) {
      throw new Error(`${MODEL_LIST_ENV} must include at least one Bedrock model.`);
    }
    return models;
  }

  if (endpoint === 'runtime') {
    const model = process.env[MODEL_ENV]?.trim();
    return model ? [model] : [...DEFAULT_RUNTIME_MODELS];
  }
  return [requiredEnv(MODEL_ENV)];
}

async function providerForAuth(
  mode: AuthMode,
  endpoint: { region: string; endpoint: EndpointMode; baseURL?: string | undefined },
): Promise<Provider> {
  switch (mode) {
    case 'bearer': {
      return bearerBedrock({ ...endpoint, apiKey: requiredEnv('AWS_BEARER_TOKEN_BEDROCK') });
    }
    case 'environment-bearer': {
      requiredEnv('AWS_BEARER_TOKEN_BEDROCK');
      return bearerBedrock(endpoint);
    }
    case 'token-provider': {
      requiredEnv('AWS_BEARER_TOKEN_BEDROCK');
      return bearerBedrock({
        ...endpoint,
        tokenProvider: async () => requiredEnv('AWS_BEARER_TOKEN_BEDROCK'),
      });
    }
    case 'default-chain': {
      return awsBedrock({ ...endpoint, apiKey: null });
    }
    case 'profile': {
      return awsBedrock({ ...endpoint, apiKey: null, profile: requiredEnv('AWS_PROFILE') });
    }
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
if (!region) {
  throw new Error('Set AWS_REGION or AWS_DEFAULT_REGION before running the Bedrock live test.');
}

const endpointMode = readEndpointMode();
const models = readModels(endpointMode);
const selectedAuthModes = readAuthModes();
const baseURL = process.env['AWS_BEDROCK_BASE_URL']?.trim();
const runResponsesTest = endpointMode === 'mantle' || process.env[RESPONSES_ENV] === '1';
const runStreamingTest = process.env[STREAM_ENV] === '1';

jest.setTimeout(LIVE_TEST_TIMEOUT);

describe.each(selectedAuthModes)(`Amazon Bedrock ${endpointMode} live (%s)`, (authMode) => {
  let client: OpenAI;

  beforeAll(async () => {
    client = new OpenAI({
      provider: await providerForAuth(authMode, {
        region,
        endpoint: endpointMode,
        ...(baseURL ? { baseURL } : {}),
      }),
      maxRetries: 0,
      timeout: 120_000,
    });
  });

  (endpointMode === 'runtime' ? test.each(models) : test.skip.each(models))(
    'creates a chat completion for %s',
    async (model) => {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: bedrock live test passed' }],
      });

      expect(completion.id).toEqual(expect.any(String));
      expect(completion._request_id).toEqual(expect.any(String));
      expect(completion.choices[0]?.message.content?.trim().length).toBeGreaterThan(0);
      expect(completion.choices[0]?.finish_reason).toEqual(expect.any(String));
      expect(completion.usage).toMatchObject({
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      });
    },
  );

  (endpointMode === 'runtime' && runStreamingTest ? test.each(models) : test.skip.each(models))(
    'streams a chat completion for %s',
    async (model) => {
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: bedrock streaming test passed' }],
        stream: true,
      });
      let chunkCount = 0;
      let content = '';
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        chunkCount += 1;
        const [choice] = chunk.choices;
        content += choice?.delta.content ?? '';
        finishReason ||= choice?.finish_reason ?? null;
      }

      expect(chunkCount).toBeGreaterThan(0);
      expect(content.trim().length).toBeGreaterThan(0);
      expect(finishReason).toEqual(expect.any(String));
    },
  );

  (runResponsesTest ? test.each(models) : test.skip.each(models))(
    'creates a response for %s',
    async (model) => {
      if (endpointMode === 'mantle') {
        const availableModels = await client.models.list();
        expect(availableModels.data.map((candidate) => candidate.id)).toContain(model);
      }

      const response = await client.responses.create({
        model,
        input: 'Reply with exactly: bedrock live test passed',
        store: false,
      });

      expect(response.id).toEqual(expect.any(String));
      if (endpointMode === 'runtime') {
        expect(response._request_id).toEqual(expect.any(String));
      }
      expect(response.output_text.trim().length).toBeGreaterThan(0);
    },
  );

  (runResponsesTest && runStreamingTest ? test.each(models) : test.skip.each(models))(
    'streams a response for %s',
    async (model) => {
      const stream = await client.responses.create({
        model,
        input: 'Reply with exactly: bedrock streaming test passed',
        store: false,
        stream: true,
      });
      let eventCount = 0;
      let outputText = '';
      let completedResponseID: string | undefined;
      let finalEventType: string | undefined;

      for await (const event of stream) {
        eventCount += 1;
        finalEventType = event.type;
        if (event.type === 'response.output_text.delta') {
          outputText += event.delta;
        }
        if (event.type === 'response.completed') {
          completedResponseID = event.response.id;
        }
      }

      expect(eventCount).toBeGreaterThan(0);
      expect(outputText.trim().length).toBeGreaterThan(0);
      expect(completedResponseID).toEqual(expect.any(String));
      expect(finalEventType).toBe('response.completed');
    },
  );
});
