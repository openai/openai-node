import { vi } from 'vitest';
import {
  addOutputText,
  hasAutoParseableInput,
  isAutoParsableTool,
  makeParseableResponseTool,
  maybeParseResponse,
  parseResponse,
  shouldParseToolCall,
  validateInputTools,
} from 'openai/lib/ResponsesParser';
import { makeParseableTextFormat } from 'openai/lib/parser';
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsBase,
  ResponseFunctionToolCall,
} from 'openai/resources/responses/responses';

const strictTool: FunctionTool = {
  type: 'function',
  name: 'get_weather',
  parameters: { type: 'object' },
  strict: true,
};

function makeResponse(output: Response['output']): Response {
  return {
    id: 'resp_123',
    object: 'response',
    created_at: 1,
    status: 'completed',
    output,
  } as Response;
}

function makeFunctionCall(name = 'get_weather'): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: 'fc_123',
    call_id: 'call_123',
    name,
    arguments: '{"city":"Paris"}',
    status: 'completed',
  };
}

describe('response tool parsing', () => {
  test('detects strict and auto-parseable response tools', () => {
    const parseable = makeParseableResponseTool(strictTool, {
      parser: JSON.parse,
      callback: undefined,
    });

    expect(isAutoParsableTool(parseable)).toBe(true);
    expect(isAutoParsableTool(strictTool)).toBe(false);
    expect(isAutoParsableTool(undefined)).toBe(false);
    expect(hasAutoParseableInput({ model: 'gpt-5', tools: [parseable] })).toBe(true);
    expect(hasAutoParseableInput({ model: 'gpt-5', tools: [strictTool] })).toBe(true);
    expect(hasAutoParseableInput({ model: 'gpt-5', tools: [{ ...strictTool, strict: false }] })).toBe(false);
    expect(hasAutoParseableInput({ model: 'gpt-5' })).toBe(false);
    expect(
      hasAutoParseableInput({
        model: 'gpt-5',
        text: {
          format: makeParseableTextFormat(
            { type: 'json_schema', name: 'parsed', schema: { type: 'object' } },
            JSON.parse,
          ),
        },
      }),
    ).toBe(true);
  });

  test('retains non-enumerable tool parsing metadata and callbacks', () => {
    const parser = vi.fn(JSON.parse);
    const callback = vi.fn();
    const parseable = makeParseableResponseTool(strictTool, { parser, callback });

    expect(parseable.$parseRaw('{"city":"Paris"}')).toEqual({ city: 'Paris' });
    expect(parseable.$callback).toBe(callback);
    expect(Object.keys(parseable)).toEqual(Object.keys(strictTool));
  });

  test('determines whether a function call matches a strict or parseable tool', () => {
    const call = makeFunctionCall();
    const parseable = makeParseableResponseTool(strictTool, {
      parser: JSON.parse,
      callback: undefined,
    });

    expect(shouldParseToolCall(null, call)).toBe(false);
    expect(shouldParseToolCall(undefined, call)).toBe(false);
    expect(shouldParseToolCall({ model: 'gpt-5' }, call)).toBe(false);
    expect(shouldParseToolCall({ model: 'gpt-5', tools: [] }, call)).toBe(false);
    expect(shouldParseToolCall({ model: 'gpt-5', tools: [{ ...strictTool, strict: false }] }, call)).toBe(
      false,
    );
    expect(shouldParseToolCall({ model: 'gpt-5', tools: [strictTool] }, call)).toBe(true);
    expect(shouldParseToolCall({ model: 'gpt-5', tools: [parseable] }, call)).toBe(true);
    expect(shouldParseToolCall({ model: 'gpt-5', tools: [strictTool] }, makeFunctionCall('other'))).toBe(
      false,
    );
  });

  test('accepts only strict function tools for chat completion auto-parsing', () => {
    expect(() => validateInputTools(undefined)).not.toThrow();
    expect(() =>
      validateInputTools([
        {
          type: 'function',
          function: { name: 'get_weather', parameters: { type: 'object' }, strict: true },
        },
      ]),
    ).not.toThrow();

    expect(() =>
      validateInputTools([
        {
          type: 'function',
          function: { name: 'get_weather', parameters: { type: 'object' }, strict: false },
        },
      ]),
    ).toThrow('get_weather` tool is not marked with `strict: true`');

    expect(() => validateInputTools([{ type: 'custom' } as any])).toThrow(
      'only `function` tool types support auto-parsing',
    );
  });
});

describe('response output normalization', () => {
  test('normalizes unparsed function calls, messages, and passthrough items', () => {
    const response = makeResponse([
      makeFunctionCall(),
      {
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'hello', annotations: [], logprobs: [] }],
      },
      { type: 'reasoning', id: 'reasoning_123', summary: [] },
    ]);

    const parsed = maybeParseResponse(response, null);

    expect(parsed.output_parsed).toBeNull();
    expect(parsed.output[0]).toMatchObject({ type: 'function_call', parsed_arguments: null });
    expect(parsed.output[1]).toMatchObject({
      type: 'message',
      content: [{ type: 'output_text', text: 'hello', parsed: null }],
    });
    expect(parsed.output[2]).toEqual(response.output[2]);
    expect(parsed.output_text).toBe('hello');
  });

  test('parses only matching strict tool calls', () => {
    const response = makeResponse([makeFunctionCall(), makeFunctionCall('unconfigured')]);
    const parsed = parseResponse(response, { model: 'gpt-5', tools: [strictTool] });

    expect(parsed.output[0]).toMatchObject({ parsed_arguments: { city: 'Paris' } });
    expect(parsed.output[1]).toMatchObject({ parsed_arguments: null });
    expect(parsed.output_parsed).toBeNull();
  });

  test('does not parse tool calls from incomplete responses', () => {
    const response = makeResponse([makeFunctionCall()]);
    response.status = 'incomplete';

    const parsed = parseResponse(response, { model: 'gpt-5', tools: [strictTool] });

    expect(parsed.output[0]).toMatchObject({ parsed_arguments: null });
  });

  test('leaves message content unparsed when structured output was not requested', () => {
    const response = makeResponse([
      {
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'ordinary text', annotations: [], logprobs: [] }],
      },
    ]);

    const parsed = parseResponse(response, { model: 'gpt-5' });

    expect(parsed.output_parsed).toBeNull();
  });

  test('uses custom raw text parsers and returns the first parsed message', () => {
    const rawParser = vi.fn((raw: string) => ({ raw }));
    const format = {
      type: 'json_schema',
      name: 'custom',
      schema: { type: 'object' },
      $parseRaw: rawParser,
    };
    const response = makeResponse([
      {
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'refusal', refusal: 'no' },
          { type: 'output_text', text: 'raw value', annotations: [], logprobs: [] },
        ],
      },
    ]);

    const parsed = parseResponse(response, {
      model: 'gpt-5',
      text: { format },
    } as ResponseCreateParamsBase);

    expect(rawParser).toHaveBeenCalledWith('raw value');
    expect(parsed.output_parsed).toEqual({ raw: 'raw value' });
    expect(parsed.output_text).toBe('raw value');
  });

  test('concatenates output text while ignoring non-message and refusal content', () => {
    const response = makeResponse([
      makeFunctionCall(),
      {
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'refusal', refusal: 'skip' },
          { type: 'output_text', text: 'hello ', annotations: [], logprobs: [] },
          { type: 'output_text', text: 'world', annotations: [], logprobs: [] },
        ],
      },
    ]);

    addOutputText(response);

    expect(response.output_text).toBe('hello world');
  });
});
