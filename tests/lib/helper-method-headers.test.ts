import { vi } from 'vitest';

import OpenAI from 'openai';
import type { HeadersLike } from 'openai/internal/headers';

interface ClientOptions {
  defaultHeaders?: HeadersLike;
  streaming?: 'chat' | 'response';
}

interface CapturedClient {
  client: OpenAI;
  requests: Headers[];
}

interface HeaderScenario {
  name: string;
  defaultHeaders?: HeadersLike;
  requestHeaders?: HeadersLike;
  expectedHelper: string | null;
  expectedCustom?: string;
}

interface ChatStreamScenario {
  name: string;
  helperMethod: string;
  start: (client: OpenAI) => { done: () => Promise<void> };
}

const chatRequest = {
  model: 'gpt-4o',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

function eventStream(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function createClient({ defaultHeaders, streaming }: ClientOptions = {}): CapturedClient {
  const requests: Headers[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    defaultHeaders,
    fetch: async (_url, init) => {
      requests.push(new Headers(init?.headers));

      if (streaming === 'chat') {
        return eventStream([
          {
            id: 'chatcmpl_123',
            object: 'chat.completion.chunk',
            created: 0,
            model: chatRequest.model,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'hello' },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
          },
        ]);
      }

      if (streaming === 'response') {
        const response = {
          id: 'resp_123',
          object: 'response',
          created_at: 0,
          model: chatRequest.model,
          output: [],
          error: null,
          incomplete_details: null,
          instructions: null,
          metadata: null,
          parallel_tool_calls: false,
          temperature: null,
          tools: [],
          top_p: null,
          usage: null,
        };

        return eventStream([
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...response, status: 'in_progress' },
          },
          {
            type: 'response.completed',
            sequence_number: 1,
            response: { ...response, status: 'completed' },
          },
        ]);
      }

      return Response.json({
        id: 'chatcmpl_123',
        object: 'chat.completion',
        created: 0,
        model: chatRequest.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            logprobs: null,
            message: { role: 'assistant', content: 'hello', refusal: null },
          },
        ],
      });
    },
  });

  return { client, requests };
}

const headerScenarios: HeaderScenario[] = [
  { name: 'keeps helper telemetry by default', expectedHelper: 'chat.completions.parse' },
  {
    name: 'suppresses helper telemetry with a case-insensitive default null',
    defaultHeaders: { 'x-stainless-helper-method': null },
    expectedHelper: null,
  },
  {
    name: 'lets default headers override the helper value',
    defaultHeaders: { 'X-Stainless-Helper-Method': 'default-override' },
    expectedHelper: 'default-override',
  },
  {
    name: 'suppresses helper telemetry with a request-level null',
    requestHeaders: { 'X-Stainless-Helper-Method': null },
    expectedHelper: null,
  },
  {
    name: 'lets request headers override the helper value',
    requestHeaders: { 'x-stainless-helper-method': 'request-override' },
    expectedHelper: 'request-override',
  },
  {
    name: 'lets request headers restore helper telemetry suppressed by defaults',
    defaultHeaders: { 'X-Stainless-Helper-Method': null },
    requestHeaders: { 'x-stainless-helper-method': 'request-override' },
    expectedHelper: 'request-override',
  },
  {
    name: 'preserves custom Headers instances',
    requestHeaders: new Headers({ 'x-custom': 'preserved' }),
    expectedHelper: 'chat.completions.parse',
    expectedCustom: 'preserved',
  },
  {
    name: 'preserves custom tuple headers',
    requestHeaders: [['x-custom', 'preserved']],
    expectedHelper: 'chat.completions.parse',
    expectedCustom: 'preserved',
  },
];

describe('chat helper header precedence', () => {
  test.each(headerScenarios)(
    '$name',
    async ({ defaultHeaders, requestHeaders, expectedHelper, expectedCustom }) => {
      const { client, requests } = createClient({ defaultHeaders });

      await client.chat.completions.parse(chatRequest, { headers: requestHeaders });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.get('x-stainless-helper-method')).toBe(expectedHelper);
      expect(requests[0]?.get('x-custom')).toBe(expectedCustom ?? null);
      expect(requests[0]?.has('0')).toBe(false);
    },
  );

  test('preserves existing request metadata while adding the parse helper marker', async () => {
    const { client } = createClient();
    const buildRequest = vi.spyOn(client, 'buildRequest');

    await client.chat.completions.parse(chatRequest, { __metadata: { requestID: 'request_123' } });

    expect(buildRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        __metadata: { requestID: 'request_123', helperMethod: 'chat.completions.parse' },
      }),
      expect.objectContaining({ retryCount: 0 }),
    );
  });

  test.each([
    ['missing metadata', undefined],
    ['null metadata', null],
    ['numeric metadata', 42],
    ['object metadata', {}],
  ])('ignores %s when constructing automatic helper headers', async (_, helperMethod) => {
    const { client } = createClient();
    const { req } = await client.buildRequest({
      method: 'post',
      path: '/items',
      __metadata: { helperMethod },
    });

    expect(req.headers.has('x-stainless-helper-method')).toBe(false);
  });
});

const chatStreamScenarios: ChatStreamScenario[] = [
  {
    name: 'chat completion streams',
    helperMethod: 'stream',
    start: (client) => client.chat.completions.stream(chatRequest),
  },
  {
    name: 'streaming chat tool runners',
    helperMethod: 'runTools',
    start: (client) => client.chat.completions.runTools({ ...chatRequest, stream: true, tools: [] }),
  },
];

describe.each(chatStreamScenarios)('$name', ({ helperMethod, start }) => {
  test('retains helper telemetry by default', async () => {
    const { client, requests } = createClient({ streaming: 'chat' });

    await start(client).done();

    expect(requests[0]?.get('x-stainless-helper-method')).toBe(helperMethod);
  });

  test('allows client defaults to suppress helper telemetry', async () => {
    const { client, requests } = createClient({
      streaming: 'chat',
      defaultHeaders: { 'X-Stainless-Helper-Method': null },
    });

    await start(client).done();

    expect(requests[0]?.has('x-stainless-helper-method')).toBe(false);
  });
});

test('allows client defaults to suppress response-stream helper telemetry', async () => {
  const { client, requests } = createClient({
    streaming: 'response',
    defaultHeaders: { 'X-Stainless-Helper-Method': null },
  });

  await expect(
    client.responses.stream({ model: 'gpt-4o', input: 'hello' }).finalResponse(),
  ).resolves.toMatchObject({ id: 'resp_123' });
  expect(requests[0]?.has('x-stainless-helper-method')).toBe(false);
});
