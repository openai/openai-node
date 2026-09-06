import OpenAI from 'openai';
import { zodFunction, zodResponsesFunction } from 'openai/helpers/zod';
import * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';
import * as z4Mini from 'zod/v4-mini';

const variants = [
  { name: 'Zod v3', schema: (length: number) => z3.object({ code: z3.string().length(length) }) },
  { name: 'Zod v4', schema: (length: number) => z4.object({ code: z4.string().length(length) }) },
  {
    name: 'Zod v4 Mini',
    schema: (length: number) => z4Mini.object({ code: z4Mini.string().check(z4Mini.length(length)) }),
  },
];
const modes = [
  { name: 'chat.parse', endpoint: 'chat', stream: false },
  { name: 'chat.stream', endpoint: 'chat', stream: true },
  { name: 'responses.parse', endpoint: 'responses', stream: false },
  { name: 'responses.stream', endpoint: 'responses', stream: true },
] as const;
const cases = [
  { name: 'original tool accepts its schema', replace: false, fresh: false, code: 'ABCDEF', accepts: true },
  { name: 'original tool rejects other data', replace: false, fresh: false, code: 'ABCD', accepts: false },
  {
    name: 'retained tool accepts its original schema',
    replace: true,
    fresh: false,
    code: 'ABCDEF',
    accepts: true,
  },
  {
    name: 'retained tool rejects replacement-only data',
    replace: true,
    fresh: false,
    code: 'ABCD',
    accepts: false,
  },
  {
    name: 'new tool accepts the replacement schema',
    replace: true,
    fresh: true,
    code: 'ABCD',
    accepts: true,
  },
  { name: 'new tool rejects original-only data', replace: true, fresh: true, code: 'ABCDEF', accepts: false },
];

function makeTool(endpoint: 'chat' | 'responses', options: Parameters<typeof zodFunction>[0]) {
  return endpoint === 'chat'
    ? { endpoint, value: zodFunction(options) }
    : { endpoint, value: zodResponsesFunction(options) };
}

function responseBody(code: string) {
  return {
    id: 'resp-synthetic',
    object: 'response',
    created_at: 1,
    model: 'gpt-test',
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    output: [
      {
        id: 'fc-synthetic',
        call_id: 'call-synthetic',
        type: 'function_call',
        status: 'completed',
        name: 'verify_code',
        arguments: JSON.stringify({ code }),
      },
    ] as const,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
}

function mockResponse(endpoint: 'chat' | 'responses', stream: boolean, code: string) {
  const call = { name: 'verify_code', arguments: JSON.stringify({ code }) };
  const chat = { id: 'chatcmpl-synthetic', created: 1, model: 'gpt-test' };
  if (!stream) {
    return Response.json(
      endpoint === 'chat'
        ? {
            ...chat,
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  refusal: null,
                  tool_calls: [{ id: 'call-synthetic', type: 'function', function: call }],
                },
                finish_reason: 'tool_calls',
                logprobs: null,
              },
            ],
          }
        : responseBody(code),
    );
  }

  const chunk = (delta: unknown, finish_reason: string | null = null) => ({
    ...chat,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason, logprobs: null }],
  });
  const response = responseBody(code);
  const [item] = response.output;
  const events =
    endpoint === 'chat'
      ? [
          chunk({
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'call-synthetic', type: 'function', function: { ...call, arguments: '' } },
            ],
          }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: call.arguments.slice(0, 8) } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: call.arguments.slice(8) } }] }),
          chunk({}, 'tool_calls'),
        ]
      : [
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...response, status: 'in_progress', output: [] },
          },
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: { ...item, arguments: '', status: 'in_progress' },
          },
          {
            type: 'response.function_call_arguments.delta',
            sequence_number: 2,
            item_id: item.id,
            output_index: 0,
            delta: call.arguments.slice(0, 8),
          },
          {
            type: 'response.function_call_arguments.delta',
            sequence_number: 3,
            item_id: item.id,
            output_index: 0,
            delta: call.arguments.slice(8),
          },
          {
            type: 'response.function_call_arguments.done',
            sequence_number: 4,
            item_id: item.id,
            output_index: 0,
            arguments: call.arguments,
          },
          { type: 'response.output_item.done', sequence_number: 5, output_index: 0, item },
          { type: 'response.completed', sequence_number: 6, response },
        ];
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function parsedArguments(client: OpenAI, tool: ReturnType<typeof makeTool>, stream: boolean) {
  if (tool.endpoint === 'chat') {
    const params = {
      model: 'gpt-test',
      messages: [{ role: 'user' as const, content: 'Return a synthetic code' }],
      tools: [tool.value],
    };
    const completion = stream
      ? await client.chat.completions.stream(params).finalChatCompletion()
      : await client.chat.completions.parse(params);
    const call = completion.choices[0]?.message.tool_calls?.[0];
    if (call?.type !== 'function') {
      throw new Error('Expected a synthetic function tool call');
    }
    return call.function.parsed_arguments;
  }

  const params = { model: 'gpt-test', input: 'Return a synthetic code', tools: [tool.value] };
  const response = stream
    ? await client.responses.stream(params).finalResponse()
    : await client.responses.parse(params);
  const [call] = response.output;
  if (call?.type !== 'function_call') {
    throw new Error('Expected a synthetic function tool call');
  }
  return call.parsed_arguments;
}

describe.each(variants)('$name tool schema binding', ({ schema }) => {
  describe.each(modes)('$name', ({ endpoint, stream }) => {
    test.each(cases)('$name', async ({ replace, fresh, code, accepts }) => {
      const parameters = schema(6);
      const options = { name: 'verify_code', parameters };
      let tool = makeTool(endpoint, options);
      expect(options.parameters).toBe(parameters);
      if (replace) {
        // The replacement has the same inferred TypeScript type as the original schema.
        options.parameters = schema(4);
      }
      if (fresh) {
        tool = makeTool(endpoint, options);
      }

      let request: unknown;
      let requests = 0;
      const client = new OpenAI({
        apiKey: 'synthetic-key',
        maxRetries: 0,
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new TypeError('Expected a serialized synthetic request');
          }
          requests += 1;
          request = JSON.parse(init.body);
          return mockResponse(endpoint, stream, code);
        },
      });
      const outcome = await parsedArguments(client, tool, stream).then(
        (parsed) => ({ parsed }),
        (error: unknown) => ({ error }),
      );
      const length = fresh ? 4 : 6;
      const definition = {
        name: 'verify_code',
        strict: true,
        parameters: { properties: { code: { minLength: length, maxLength: length } } },
      };
      expect(requests).toBe(1);
      expect(request).toMatchObject({
        tools: [
          endpoint === 'chat'
            ? { type: 'function', function: definition }
            : { type: 'function', ...definition },
        ],
      });
      if (stream) {
        expect(request).toHaveProperty('stream', true);
      }
      if (accepts) {
        expect(outcome).toEqual({ parsed: { code } });
      } else {
        expect(outcome).toMatchObject({
          error: { message: expect.stringMatching(/too_(?:small|big)|too (?:small|big)|exactly [46]/iu) },
        });
      }
    });
  });
});
