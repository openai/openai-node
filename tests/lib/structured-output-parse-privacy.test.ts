import { vi } from 'vitest';
import OpenAI from 'openai';
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

describe('built-in structured JSON parse diagnostic privacy', () => {
  test.each(scenarios)('$title excludes model content from syntax diagnostics', async ({ parse }) => {
    let failure: unknown;

    try {
      await parse(malformedContent);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SyntaxError);
    const syntaxError = failure as SyntaxError & { cause?: unknown };

    for (const sensitive of [patient, credential, malformedContent]) {
      expect(syntaxError.message).not.toContain(sensitive);
      expect(syntaxError.stack).not.toContain(sensitive);
    }

    expect(syntaxError.message).toBe(safeErrorMessage);
    expect(syntaxError.cause).toBeUndefined();
  });

  test.each(scenarios)('$title preserves valid parsed output', async ({ parse, expected }) => {
    await expect(parse(validContent)).resolves.toMatchObject(expected);
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
