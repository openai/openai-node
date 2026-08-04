import OpenAI from 'openai';
import {
  makeParseableResponseTool,
  maybeParseResponse,
  parseResponse,
  type ExtractParsedContentFromParams,
} from '../../src/lib/ResponsesParser';
import { makeParseableTextFormat, type AutoParseableTextFormat } from '../../src/lib/parser';
import type { Response, ResponseCreateParamsBase } from '../../src/resources/responses/responses';
import { compareType } from '../utils/typing';

const structuredTextParams = {
  model: 'gpt-5.4-mini',
  input: 'Good large pea',
  text: {
    format: {
      type: 'json_schema',
      name: 'pea_schema',
      schema: { type: 'object' },
    },
  },
} as ResponseCreateParamsBase;

function makeResponse(status: Response['status'], text: string): Response {
  return {
    id: 'resp_123',
    created_at: 0,
    error: null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: null,
    metadata: null,
    model: 'gpt-5.4-mini',
    object: 'response',
    output: [
      {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        status,
        content: [
          {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text,
          },
        ],
      },
    ],
    output_text: text,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    status,
  } as Response;
}

function makeToolCallResponse(arguments_: string): Response {
  const response = makeResponse('completed', '');
  response.output = [
    {
      type: 'function_call',
      id: 'fc_123',
      call_id: 'call_123',
      name: 'get_weather',
      arguments: arguments_,
      status: 'completed',
    },
  ];
  return response;
}

describe('ResponsesParser', () => {
  it('parses structured output for completed responses', () => {
    const response = parseResponse(
      makeResponse('completed', '{"size":"large","quality":"good"}'),
      structuredTextParams,
    );

    expect(response.output_parsed).toEqual({ size: 'large', quality: 'good' });
  });

  it('leaves incomplete structured output unparsed so incomplete_details remain inspectable', () => {
    const response = parseResponse(
      makeResponse('incomplete', '{"size":"large","quality":"good","pea_description":"unterminated'),
      structuredTextParams,
    );

    expect(response.status).toBe('incomplete');
    expect(response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(response.output_parsed).toBeNull();
    expect(response.output[0]?.type).toBe('message');
    if (response.output[0]?.type === 'message') {
      expect(response.output[0].content[0]).toMatchObject({
        type: 'output_text',
        parsed: null,
      });
    }
  });

  it('passes programmatic tool calling items through unchanged', () => {
    const raw = makeResponse('completed', '{"size":"large"}');
    raw.output.push({
      type: 'program',
      id: 'program_123',
      call_id: 'program_call_123',
      code: 'return 42',
      fingerprint: 'program_fingerprint_123',
    });
    raw.output.push({
      type: 'program_output',
      id: 'program_output_123',
      call_id: 'program_call_123',
      result: '42',
      status: 'completed',
    });

    const response = parseResponse(raw, structuredTextParams);

    expect(response.output.slice(1)).toEqual(raw.output.slice(1));
  });

  it('auto-parses response tools when finalizing streamed responses', () => {
    const tool = makeParseableResponseTool<any>(
      {
        type: 'function',
        name: 'get_weather',
        parameters: { type: 'object' },
        strict: true,
      },
      {
        callback: undefined,
        parser: (content) => JSON.parse(content),
      },
    );

    const response = maybeParseResponse(makeToolCallResponse('{"city":"Paris"}'), {
      model: 'gpt-5.4-mini',
      input: 'What is the weather?',
      tools: [tool],
    });

    expect(response.output[0]).toMatchObject({
      type: 'function_call',
      parsed_arguments: { city: 'Paris' },
    });
  });

  it('parses raw json_schema text format in maybeParseResponse', () => {
    const response = maybeParseResponse(
      makeResponse('completed', '{"size":"large","quality":"good"}'),
      structuredTextParams,
    );

    expect(response.output_parsed).toEqual({ size: 'large', quality: 'good' });
  });

  it('prefers the branded callback over generic JSON for helper text formats', () => {
    const parseRaw = jest.fn(() => ({ branded: true }));
    const response = maybeParseResponse(makeResponse('completed', '{"size":"large"}'), {
      model: 'gpt-5.4-mini',
      input: 'Good large pea',
      text: {
        format: makeParseableTextFormat(
          { type: 'json_schema', name: 'pea_schema', schema: { type: 'object' } },
          parseRaw,
        ),
      },
    });

    expect(response.output_parsed).toEqual({ branded: true });
    expect(parseRaw).toHaveBeenCalledWith('{"size":"large"}');
  });
});

describe('ExtractParsedContentFromParams', () => {
  it('resolves raw json_schema text formats to unknown', () => {
    compareType<
      ExtractParsedContentFromParams<{
        text: { format: { type: 'json_schema'; name: 'pea_schema'; schema: {} } };
      }>,
      unknown
    >(true);
  });

  it('resolves branded helper text formats to the helper output type', () => {
    compareType<
      ExtractParsedContentFromParams<{
        text: { format: AutoParseableTextFormat<{ size: string }> };
      }>,
      { size: string }
    >(true);
  });

  it('resolves text formats without parsed output to null', () => {
    compareType<ExtractParsedContentFromParams<{}>, null>(true);
    compareType<ExtractParsedContentFromParams<{ text: { format: { type: 'text' } } }>, null>(true);
    compareType<ExtractParsedContentFromParams<{ text: { format: { type: 'json_object' } } }>, null>(true);
  });
});

// Compile-time only; `tsc` covers this file, and the function is never called.
async function _responsesParsedTypes(client: OpenAI) {
  const rawSchemaResponse = await client.responses.parse({
    model: 'gpt-5.4-mini',
    input: 'Good large pea',
    text: { format: { type: 'json_schema', name: 'pea_schema', schema: { type: 'object' } } },
  });
  compareType<(typeof rawSchemaResponse)['output_parsed'], unknown>(true);

  const rawSchemaStream = await client.responses
    .stream({
      model: 'gpt-5.4-mini',
      input: 'Good large pea',
      text: { format: { type: 'json_schema', name: 'pea_schema', schema: { type: 'object' } } },
    })
    .finalResponse();
  compareType<(typeof rawSchemaStream)['output_parsed'], unknown>(true);

  const textResponse = await client.responses.parse({
    model: 'gpt-5.4-mini',
    input: 'Good large pea',
    text: { format: { type: 'text' } },
  });
  compareType<(typeof textResponse)['output_parsed'], null>(true);
}
