import { vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import {
  standardFunction,
  standardResponseFormat,
  standardResponsesFunction,
  standardTextFormat,
} from 'openai/helpers/standard-schema';
import { zodFunction, zodResponseFormat, zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';
import { z as zv4Mini } from 'zod/v4-mini';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import { makeParseableResponseTool, parseResponse } from '../../src/lib/ResponsesParser';
import {
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
  parseChatCompletion,
  parseResponseFormatContent,
} from '../../src/lib/parser';

const patient = 'ALICE';
const credential = 'sk-X12';
const malformedContent = `["${patient}","${credential}",]`;
const validContent = '{"ok":true}';
const safeErrorMessage = 'Error reading response: invalid structured output JSON.';

const schema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

const chatFormat = {
  type: 'json_schema' as const,
  json_schema: { name: 'privacy', schema, strict: true },
};

const responseFormat = {
  type: 'json_schema' as const,
  name: 'privacy',
  schema,
  strict: true,
};

const chatTool = {
  type: 'function' as const,
  function: { name: 'lookup', parameters: schema, strict: true },
};

const responseTool = {
  type: 'function' as const,
  name: 'lookup',
  parameters: schema,
  strict: true,
};

const privacyStandardSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'structured-output-privacy',
    types: undefined as unknown as { input: { ok: boolean }; output: { ok: boolean } },
    validate(value: unknown) {
      return { value: value as { ok: boolean } };
    },
    jsonSchema: { input: () => schema },
  },
};

const zodSchemas = [
  { title: 'Zod v3', schema: zv3.object({ ok: zv3.boolean() }) },
  { title: 'Zod v4', schema: zv4.object({ ok: zv4.boolean() }) },
  { title: 'Zod v4 Mini', schema: zv4Mini.object({ ok: zv4Mini.boolean() }) },
];

const helperFamilies = [
  ...zodSchemas.map(({ title, schema: zodSchema }) => ({
    title,
    chatFormat: zodResponseFormat(zodSchema, 'privacy'),
    responseFormat: zodTextFormat(zodSchema, 'privacy'),
    chatTool: zodFunction({ name: 'lookup', parameters: zodSchema }),
    responseTool: zodResponsesFunction({ name: 'lookup', parameters: zodSchema }),
  })),
  {
    title: 'Standard Schema',
    chatFormat: standardResponseFormat(privacyStandardSchema, 'privacy'),
    responseFormat: standardTextFormat(privacyStandardSchema, 'privacy'),
    chatTool: standardFunction({ name: 'lookup', parameters: privacyStandardSchema }),
    responseTool: standardResponsesFunction({ name: 'lookup', parameters: privacyStandardSchema }),
  },
];

function makeChatCompletion(
  content: string | null,
  args?: string,
  refusal: string | null = null,
): OpenAI.Chat.ChatCompletion {
  return {
    id: 'chatcmpl_privacy',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        finish_reason: args === undefined ? 'stop' : 'tool_calls',
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal,
          ...(args === undefined
            ? {}
            : {
                tool_calls: [
                  {
                    id: 'call_privacy',
                    type: 'function',
                    function: { name: 'lookup', arguments: args },
                  },
                ],
              }),
        },
      },
    ],
  } as OpenAI.Chat.ChatCompletion;
}

function makeResponse(
  content: string,
  args?: string,
  status: NonNullable<OpenAI.Responses.Response['status']> = 'completed',
): OpenAI.Responses.Response {
  return {
    id: 'resp_privacy',
    created_at: 0,
    error: null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    model: 'gpt-test',
    object: 'response',
    output:
      args === undefined
        ? [
            {
              id: 'msg_privacy',
              type: 'message',
              role: 'assistant',
              status,
              content: [
                {
                  type: 'output_text',
                  annotations: [],
                  logprobs: [],
                  text: content,
                },
              ],
            },
          ]
        : [
            {
              type: 'function_call',
              id: 'fc_privacy',
              call_id: 'call_privacy',
              name: 'lookup',
              arguments: args,
              status: 'completed',
            },
          ],
    output_text: args === undefined ? content : '',
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    status,
  } as OpenAI.Responses.Response;
}

function createClient(body: OpenAI.Chat.ChatCompletion | OpenAI.Responses.Response): OpenAI {
  return new OpenAI({
    apiKey: 'sk-synthetic-client-key',
    logLevel: 'off',
    maxRetries: 0,
    fetch: async () =>
      Response.json(body, {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_privacy' },
      }),
  });
}

function createStreamingToolClient(content: string, tool: ChatCompletionFunctionTool) {
  const chunk: OpenAI.Chat.ChatCompletionChunk = {
    id: 'chatcmpl_stream_privacy',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        finish_reason: null,
        logprobs: null,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_stream_privacy',
              type: 'function',
              function: { name: 'lookup', arguments: content },
            },
          ],
        },
      },
    ],
  };
  const completedChunk: OpenAI.Chat.ChatCompletionChunk = {
    ...chunk,
    choices: [{ index: 0, finish_reason: 'tool_calls', logprobs: null, delta: {} }],
  };
  const client = new OpenAI({
    apiKey: 'sk-synthetic-client-key',
    logLevel: 'off',
    maxRetries: 0,
    fetch: async () =>
      new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(completedChunk)}\n\ndata: [DONE]\n\n`,
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_stream_privacy' },
        },
      ),
  });

  return client.chat.completions.stream({
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [tool],
  });
}

interface Scenario {
  title: string;
  parse: (content: string) => Promise<unknown>;
  expected: Record<string, unknown>;
}

const scenarios: Scenario[] = [
  {
    title: 'Chat Completions raw JSON-schema text',
    parse: async (content) =>
      await createClient(makeChatCompletion(content)).chat.completions.parse({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
        response_format: chatFormat,
      }),
    expected: { choices: [{ message: { parsed: { ok: true } } }] },
  },
  {
    title: 'Responses raw JSON-schema text',
    parse: async (content) =>
      await createClient(makeResponse(content)).responses.parse({
        model: 'gpt-test',
        input: 'hello',
        text: { format: responseFormat },
      }),
    expected: {
      output: [{ type: 'message', content: [{ parsed: { ok: true } }] }],
      output_parsed: { ok: true },
    },
  },
  {
    title: 'Chat Completions plain strict-tool arguments',
    parse: async (content) =>
      await createClient(makeChatCompletion(null, content)).chat.completions.parse({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [chatTool],
      }),
    expected: {
      choices: [
        {
          message: {
            tool_calls: [{ function: { parsed_arguments: { ok: true } } }],
          },
        },
      ],
    },
  },
  {
    title: 'Responses plain strict-tool arguments',
    parse: async (content) =>
      await createClient(makeResponse('', content)).responses.parse({
        model: 'gpt-test',
        input: 'hello',
        tools: [responseTool],
      }),
    expected: { output: [{ type: 'function_call', parsed_arguments: { ok: true } }] },
  },
];

for (const family of helperFamilies) {
  scenarios.push(
    {
      title: `${family.title} Chat Completions response-format helper`,
      parse: async (content) =>
        await createClient(makeChatCompletion(content)).chat.completions.parse({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hello' }],
          response_format: family.chatFormat,
        }),
      expected: { choices: [{ message: { parsed: { ok: true } } }] },
    },
    {
      title: `${family.title} Responses text-format helper`,
      parse: async (content) =>
        await createClient(makeResponse(content)).responses.parse({
          model: 'gpt-test',
          input: 'hello',
          text: { format: family.responseFormat },
        }),
      expected: {
        output: [{ type: 'message', content: [{ parsed: { ok: true } }] }],
        output_parsed: { ok: true },
      },
    },
    {
      title: `${family.title} Chat Completions function helper`,
      parse: async (content) =>
        await createClient(makeChatCompletion(null, content)).chat.completions.parse({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [family.chatTool],
        }),
      expected: {
        choices: [{ message: { tool_calls: [{ function: { parsed_arguments: { ok: true } } }] } }],
      },
    },
    {
      title: `${family.title} Responses function helper`,
      parse: async (content) =>
        await createClient(makeResponse('', content)).responses.parse({
          model: 'gpt-test',
          input: 'hello',
          tools: [family.responseTool],
        }),
      expected: { output: [{ type: 'function_call', parsed_arguments: { ok: true } }] },
    },
  );
}

function expectPrivateSyntaxError(error: unknown): asserts error is SyntaxError & { cause?: unknown } {
  expect(error).toBeInstanceOf(SyntaxError);
  const syntaxError = error as SyntaxError & { cause?: unknown };

  for (const sensitive of [patient, credential, malformedContent]) {
    expect(syntaxError.message).not.toContain(sensitive);
    expect(syntaxError.stack).not.toContain(sensitive);
  }

  expect(syntaxError.message).toBe(safeErrorMessage);
  expect(syntaxError.cause).toBeUndefined();
}

describe('built-in structured JSON parse diagnostic privacy', () => {
  test.each(scenarios)('$title excludes model content from syntax diagnostics', async ({ parse }) => {
    let failure: unknown;

    try {
      await parse(malformedContent);
    } catch (error) {
      failure = error;
    }

    expectPrivateSyntaxError(failure);
  });

  test.each(scenarios)('$title preserves valid parsed output', async ({ parse, expected }) => {
    await expect(parse(validContent)).resolves.toMatchObject(expected);
  });

  test.each(
    helperFamilies.flatMap((family) => [
      { title: `${family.title} response-format`, parser: family.chatFormat },
      { title: `${family.title} text-format`, parser: family.responseFormat },
      { title: `${family.title} Chat Completions function`, parser: family.chatTool },
      { title: `${family.title} Responses function`, parser: family.responseTool },
    ]),
  )('$title public helper does not expose malformed JSON through its raw parser', ({ parser }) => {
    let failure: unknown;
    try {
      parser.$parseRaw(malformedContent);
    } catch (error) {
      failure = error;
    }

    expectPrivateSyntaxError(failure);
  });

  test('preserves raw JSON null instead of treating it as a parsing failure', async () => {
    const completion = await createClient(makeChatCompletion('null')).chat.completions.parse({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: chatFormat,
    });
    const response = await createClient(makeResponse('null')).responses.parse({
      model: 'gpt-test',
      input: 'hello',
      text: { format: responseFormat },
    });

    expect(completion.choices[0]?.message.parsed).toBeNull();
    expect(response.output_parsed).toBeNull();
  });

  test('preserves null, refused, and empty tool-call chat content without parsing it', async () => {
    const nullCompletion = await createClient(makeChatCompletion(null)).chat.completions.parse({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: chatFormat,
    });
    const refusedCompletion = await createClient(
      makeChatCompletion(malformedContent, undefined, 'refused'),
    ).chat.completions.parse({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: chatFormat,
    });
    const emptyToolCompletion = await createClient(
      makeChatCompletion('', validContent),
    ).chat.completions.parse({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: chatFormat,
      tools: [chatTool],
    });

    expect(nullCompletion.choices[0]?.message.parsed).toBeNull();
    expect(refusedCompletion.choices[0]?.message.parsed).toBeNull();
    expect(emptyToolCompletion.choices[0]?.message.parsed).toBeNull();
    expect(emptyToolCompletion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      function: { parsed_arguments: { ok: true } },
    });
  });

  test.each(['failed', 'in_progress', 'cancelled', 'queued', 'incomplete'] as const)(
    'does not parse malformed text for a %s response',
    async (status) => {
      const response = await createClient(makeResponse(malformedContent, undefined, status)).responses.parse({
        model: 'gpt-test',
        input: 'hello',
        text: { format: responseFormat },
      });

      expect(response.output_parsed).toBeNull();
      expect(response.output[0]).toMatchObject({
        content: [{ text: malformedContent, parsed: null }],
      });
    },
  );

  test('leaves unmatched and non-strict Responses tool arguments unparsed', async () => {
    const unmatched = await createClient(makeResponse('', malformedContent)).responses.parse({
      model: 'gpt-test',
      input: 'hello',
      tools: [{ ...responseTool, name: 'different' }],
    });
    const nonStrict = await createClient(makeResponse('', malformedContent)).responses.parse({
      model: 'gpt-test',
      input: 'hello',
      tools: [{ ...responseTool, strict: false }],
    });

    expect(unmatched.output[0]).toMatchObject({ parsed_arguments: null });
    expect(nonStrict.output[0]).toMatchObject({ parsed_arguments: null });
  });

  test('preserves exact custom format and tool parser SyntaxError identities', async () => {
    const customFailure = new SyntaxError('Custom parsers deliberately own their diagnostics.');
    const parseRaw = () => {
      throw customFailure;
    };
    const customChatFormat = makeParseableResponseFormat(chatFormat, parseRaw);
    const customResponseFormat = makeParseableTextFormat(responseFormat, parseRaw);
    const customChatTool = makeParseableTool(chatTool, { parser: parseRaw, callback: undefined });
    const customResponseTool = makeParseableResponseTool(responseTool, {
      parser: parseRaw,
      callback: undefined,
    });

    const calls = [
      () =>
        createClient(makeChatCompletion(malformedContent)).chat.completions.parse({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hello' }],
          response_format: customChatFormat,
        }),
      () =>
        createClient(makeResponse(malformedContent)).responses.parse({
          model: 'gpt-test',
          input: 'hello',
          text: { format: customResponseFormat },
        }),
      () =>
        createClient(makeChatCompletion(null, malformedContent)).chat.completions.parse({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [customChatTool],
        }),
      () =>
        createClient(makeResponse('', malformedContent)).responses.parse({
          model: 'gpt-test',
          input: 'hello',
          tools: [customResponseTool],
        }),
    ];

    await Promise.all(calls.map((call) => expect(call()).rejects.toBe(customFailure)));
  });

  test('preserves unbranded custom format parser failures unchanged', () => {
    const customFailure = new SyntaxError('Unbranded parser error must retain identity.');
    const format = {
      ...chatFormat,
      $parseRaw: () => {
        throw customFailure;
      },
    };

    let failure: unknown;
    try {
      parseResponseFormatContent(format, malformedContent);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(customFailure);
  });

  test('rethrows non-syntax built-in parsing failures without replacement', () => {
    const originalFailure = new TypeError('Synthetic parser runtime failure.');
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw originalFailure;
    });

    try {
      let failure: unknown;
      try {
        parseResponseFormatContent(chatFormat, validContent);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBe(originalFailure);
    } finally {
      parse.mockRestore();
    }
  });

  test.each(['Zod', 'Standard Schema'] as const)(
    'preserves exact %s validator SyntaxError identities and causes',
    (kind) => {
      const validatorFailure = new SyntaxError('Validator-owned diagnostic must be preserved.');
      const validatorCause = new Error('Validator-owned cause must be preserved.');
      (validatorFailure as SyntaxError & { cause?: unknown }).cause = validatorCause;

      const failingZodSchema = zv4.object({ ok: zv4.boolean() }).superRefine(() => {
        throw validatorFailure;
      });
      const failingStandardSchema = {
        '~standard': {
          ...privacyStandardSchema['~standard'],
          validate() {
            throw validatorFailure;
          },
        },
      };
      const parsers =
        kind === 'Zod'
          ? [
              zodResponseFormat(failingZodSchema, 'privacy'),
              zodTextFormat(failingZodSchema, 'privacy'),
              zodFunction({ name: 'lookup', parameters: failingZodSchema }),
              zodResponsesFunction({ name: 'lookup', parameters: failingZodSchema }),
            ]
          : [
              standardResponseFormat(failingStandardSchema, 'privacy'),
              standardTextFormat(failingStandardSchema, 'privacy'),
              standardFunction({ name: 'lookup', parameters: failingStandardSchema }),
              standardResponsesFunction({ name: 'lookup', parameters: failingStandardSchema }),
            ];

      for (const parser of parsers) {
        let failure: unknown;
        try {
          parser.$parseRaw(validContent);
        } catch (error) {
          failure = error;
        }

        expect(failure).toBe(validatorFailure);
        expect((failure as SyntaxError & { cause?: unknown }).cause).toBe(validatorCause);
      }
    },
  );

  test('plain strict tools never invoke an inherited structured-output parser', () => {
    const inheritedParser = vi.fn(() => ({ hijacked: true }));
    const objectPrototype: object = Object.prototype;
    const previous = Object.getOwnPropertyDescriptor(objectPrototype, '$parseRaw');

    Object.defineProperty(objectPrototype, '$parseRaw', {
      value: inheritedParser,
      configurable: true,
      writable: true,
    });

    try {
      const chat = parseChatCompletion(makeChatCompletion(null, validContent), {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [chatTool],
      });
      const response = parseResponse(makeResponse('', validContent), {
        model: 'gpt-test',
        input: 'hello',
        tools: [responseTool],
      });

      expect(chat.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { parsed_arguments: { ok: true } },
      });
      expect(response.output[0]).toMatchObject({ parsed_arguments: { ok: true } });
      expect(inheritedParser).not.toHaveBeenCalled();
    } finally {
      if (previous) {
        Object.defineProperty(objectPrototype, '$parseRaw', previous);
      } else {
        Reflect.deleteProperty(objectPrototype, '$parseRaw');
      }
    }
  });
});

describe('public chat streaming structured-tool diagnostic privacy', () => {
  const streamingScenarios = [
    { title: 'plain strict function', tool: chatTool },
    ...helperFamilies.map((family) => ({
      title: `${family.title} SDK function helper`,
      tool: family.chatTool,
    })),
  ];

  test.each(streamingScenarios)(
    '$title redacts malformed arguments across every stream boundary',
    async ({ tool }) => {
      const stream = createStreamingToolClient(malformedContent, tool);
      const emittedErrors: unknown[] = [];
      stream.on('error', (error) => emittedErrors.push(error));

      const results = await Promise.allSettled([
        stream.done(),
        stream.finalChatCompletion(),
        stream.finalMessage(),
      ]);
      const failures = results.map((result) => (result.status === 'rejected' ? result.reason : undefined));
      const [failure] = failures;

      expect(failure).toBeInstanceOf(OpenAIError);
      const streamFailure = failure as OpenAIError & { cause?: unknown };
      expect(streamFailure.message).toBe(safeErrorMessage);
      for (const sensitive of [patient, credential, malformedContent]) {
        expect(streamFailure.message).not.toContain(sensitive);
        expect(streamFailure.stack).not.toContain(sensitive);
      }
      expectPrivateSyntaxError(streamFailure.cause);
      expect(failures.every((result) => result === failure)).toBe(true);
      expect(emittedErrors).toEqual([failure]);
    },
  );

  test.each(streamingScenarios)(
    '$title preserves valid arguments and done-event output',
    async ({ tool }) => {
      const stream = createStreamingToolClient(validContent, tool);
      const parsedArguments: unknown[] = [];
      stream.on('tool_calls.function.arguments.done', (event) =>
        parsedArguments.push(event.parsed_arguments),
      );

      const completion = await stream.finalChatCompletion();

      expect(parsedArguments).toEqual([{ ok: true }]);
      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { parsed_arguments: { ok: true } },
      });
    },
  );

  test('preserves exact custom streaming parser errors and their causes', async () => {
    const customFailure = new SyntaxError('User-owned streaming parser diagnostic.');
    const customCause = new Error('User-owned streaming parser cause.');
    (customFailure as SyntaxError & { cause?: unknown }).cause = customCause;
    const parser = vi.fn(() => {
      throw customFailure;
    });
    const tool = makeParseableTool(chatTool, { parser, callback: undefined });
    const stream = createStreamingToolClient(malformedContent, tool);

    let failure: unknown;
    try {
      await stream.done();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as OpenAIError & { cause?: unknown }).cause).toBe(customFailure);
    expect(parser).toHaveBeenCalledTimes(1);
    expect((customFailure as SyntaxError & { cause?: unknown }).cause).toBe(customCause);
  });

  test('does not parse malformed non-strict streaming tool arguments', async () => {
    const nonStrictTool = { ...chatTool, function: { ...chatTool.function, strict: false } };
    const stream = createStreamingToolClient(malformedContent, nonStrictTool);

    const completion = await stream.finalChatCompletion();

    const toolCall = completion.choices[0]?.message.tool_calls?.[0];
    expect(toolCall).toMatchObject({ function: { arguments: malformedContent } });
    if (toolCall?.type !== 'function') {
      throw new Error('Expected a function tool call.');
    }
    expect(toolCall.function).not.toHaveProperty('parsed_arguments');
  });

  test('never invokes an inherited parser while decoding a plain strict streaming tool', async () => {
    const inheritedParser = vi.fn(() => ({ hijacked: true }));
    const objectPrototype: object = Object.prototype;
    const previous = Object.getOwnPropertyDescriptor(objectPrototype, '$parseRaw');
    Object.defineProperty(objectPrototype, '$parseRaw', {
      value: inheritedParser,
      configurable: true,
      writable: true,
    });

    try {
      const completion = await createStreamingToolClient(validContent, chatTool).finalChatCompletion();

      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { parsed_arguments: { ok: true } },
      });
      expect(inheritedParser).not.toHaveBeenCalled();
    } finally {
      if (previous) {
        Object.defineProperty(objectPrototype, '$parseRaw', previous);
      } else {
        Reflect.deleteProperty(objectPrototype, '$parseRaw');
      }
    }
  });
});
