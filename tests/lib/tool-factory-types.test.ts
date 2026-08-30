import type OpenAI from 'openai';
import { makeParseableTool } from 'openai/lib/parser';
import { makeParseableResponseTool } from 'openai/lib/ResponsesParser';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { compareType } from '../utils/typing';

interface Arguments {
  city: string;
}
interface Metadata {
  name: 'lookup';
  arguments: Arguments;
  function: (args: Arguments) => string;
}

const chatDefinition: ChatCompletionFunctionTool = {
  type: 'function',
  function: { name: 'lookup', parameters: {}, strict: true },
};
const responseDefinition: FunctionTool = {
  type: 'function',
  name: 'lookup',
  parameters: {},
  strict: true,
};
const parser = (raw: string): Arguments => ({ city: raw });
const callback = (args: Arguments) => args.city;
const wrongCallback = (args: { count: number }) => args.count;

function makeOptionalTool(optionalCallback?: typeof callback) {
  return makeParseableTool<Metadata>(chatDefinition, { parser, callback: optionalCallback });
}

test('preserves explicit parser, callback-argument, and name metadata in both factories', () => {
  const chatTool = makeParseableTool<Metadata>(chatDefinition, { parser, callback });
  const responseTool = makeParseableResponseTool<Metadata>(responseDefinition, { parser, callback });

  for (const [tool, definition] of [
    [chatTool, chatDefinition],
    [responseTool, responseDefinition],
  ] as const) {
    compareType<ReturnType<typeof tool.$parseRaw>, Arguments>(true);
    compareType<typeof tool.__arguments, Arguments>(true);
    compareType<typeof tool.__name, 'lookup'>(true);
    compareType<Parameters<NonNullable<typeof tool.$callback>>[0], Arguments>(true);
    expect(tool.$parseRaw('Paris').city).toBe('Paris');
    expect(tool.$callback).toBe(callback);
    expect(tool.$parseRaw).toBe(parser);
    expect(Object.keys(tool)).toEqual(Object.keys(definition));
    expect(JSON.stringify(tool)).toBe(JSON.stringify(definition));
  }
});

test('derives runnable availability from the supplied callback, not argument properties', async () => {
  const runnable = makeParseableTool<Metadata>(chatDefinition, { parser, callback });
  const parseOnly = makeParseableTool<Metadata>(chatDefinition, { parser, callback: undefined });
  const optional = makeOptionalTool();
  const withoutFunctionMetadata = makeParseableTool<Omit<Metadata, 'function'>>(chatDefinition, {
    parser,
    callback,
  });
  const asyncRunnable = makeParseableTool<Metadata>(chatDefinition, {
    parser,
    callback: async (args) => args.city,
  });

  compareType<typeof runnable.__hasFunction, true>(true);
  compareType<typeof parseOnly.__hasFunction, false>(true);
  compareType<typeof optional.__hasFunction, boolean>(true);
  compareType<typeof withoutFunctionMetadata.__hasFunction, true>(true);
  compareType<typeof asyncRunnable.__hasFunction, true>(true);
  expect(parseOnly.$callback).toBeUndefined();
  expect(optional.$callback).toBeUndefined();
  await expect(asyncRunnable.$callback?.({ city: 'Paris' })).resolves.toBe('Paris');

  // Compile-only public-entrypoint checks; no requests are started.
  const checkRunnerTypes = (client: OpenAI) => {
    const params = { model: 'gpt-test', messages: [] };
    client.chat.completions.runTools({ ...params, tools: [runnable] });
    client.chat.completions.runTools({ ...params, tools: [runnable], stream: true });
    client.chat.completions.runTools({ ...params, tools: [withoutFunctionMetadata, asyncRunnable] });
    // @ts-expect-error A missing callback cannot be executed.
    client.chat.completions.runTools({ ...params, tools: [parseOnly] });
    // @ts-expect-error Streaming runners also require a guaranteed callback.
    client.chat.completions.runTools({ ...params, tools: [parseOnly], stream: true });
    // @ts-expect-error A possibly absent callback cannot be executed.
    client.chat.completions.runTools({ ...params, tools: [optional] });
    // @ts-expect-error Streaming runners cannot execute a possibly absent callback either.
    client.chat.completions.runTools({ ...params, tools: [optional], stream: true });
    client.chat.completions.parse({ ...params, tools: [parseOnly] });
    client.chat.completions.stream({ ...params, tools: [parseOnly] });
    // @ts-expect-error The parser output does not contain a numeric city.
    const wrongCity: number = runnable.$parseRaw('Paris').city;
    void wrongCity;
    // @ts-expect-error A callback must accept the parser's declared output.
    makeParseableTool<Metadata>(chatDefinition, { parser, callback: wrongCallback });
    // @ts-expect-error Responses callbacks must accept the same declared output.
    makeParseableResponseTool<Metadata>(responseDefinition, { parser, callback: wrongCallback });
  };
  void checkRunnerTypes;
});

test('preserves non-object and nested argument shapes', () => {
  function checkArguments<Args>(value: Args) {
    interface Options {
      name: 'lookup';
      arguments: Args;
    }
    const props = { parser: (_raw: string) => value, callback: undefined };
    const chatTool = makeParseableTool<Options>(chatDefinition, props);
    const responseTool = makeParseableResponseTool<Options>(responseDefinition, props);

    compareType<ReturnType<typeof chatTool.$parseRaw>, Args>(true);
    compareType<ReturnType<typeof responseTool.$parseRaw>, Args>(true);
    compareType<typeof chatTool.__hasFunction, false>(true);
    expect(chatTool.$parseRaw('{}')).toBe(value);
    expect(responseTool.$parseRaw('{}')).toBe(value);
  }

  checkArguments('raw result');
  checkArguments(['one', 'two']);
  checkArguments({ name: 42, arguments: 'nested', function: () => 'not the callback' });
});
