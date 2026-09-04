import { expectTypeOf } from 'vitest';
import type OpenAI from 'openai';
import type {
  ChatCompletionStreamingToolRunnerParams,
  ChatCompletionToolRunnerParams,
} from 'openai/resources/chat/completions';
import type {
  RunnableFunction,
  RunnableFunctions,
  RunnableToolFunction,
  RunnableTools,
} from 'openai/lib/RunnableFunction';

interface ParsedArgs {
  city: string;
}
interface Context {
  requestId: string;
}

test('maps each fixed argument tuple position to its runnable function or tool', () => {
  expectTypeOf<RunnableFunctions<[ParsedArgs, string], Context>>().toEqualTypeOf<
    [RunnableFunction<ParsedArgs, Context>, RunnableFunction<string, Context>]
  >();
  expectTypeOf<RunnableTools<[ParsedArgs, string], Context>>().toEqualTypeOf<
    [RunnableToolFunction<ParsedArgs, Context>, RunnableToolFunction<string, Context>]
  >();
});

test('preserves readonly and variadic tuple shapes', () => {
  expectTypeOf<RunnableFunctions<readonly [ParsedArgs, ...string[]]>>().toEqualTypeOf<
    readonly [RunnableFunction<ParsedArgs>, ...RunnableFunction<string>[]]
  >();
  expectTypeOf<RunnableTools<readonly [ParsedArgs, ...string[]]>>().toEqualTypeOf<
    readonly [RunnableToolFunction<ParsedArgs>, ...RunnableToolFunction<string>[]]
  >();
});

test('preserves empty tuples and the existing unconstrained array fallback', () => {
  expectTypeOf<RunnableFunctions<[]>>().toEqualTypeOf<[]>();
  expectTypeOf<RunnableTools<[]>>().toEqualTypeOf<[]>();
  expectTypeOf<RunnableFunctions<any[]>>().toEqualTypeOf<readonly RunnableFunction<any>[]>();
  expectTypeOf<RunnableTools<any[]>>().toEqualTypeOf<readonly RunnableToolFunction<any>[]>();
});

function _typeTests(
  client: OpenAI,
  parsedTool: RunnableToolFunction<ParsedArgs, Context>,
  rawTool: RunnableToolFunction<string, Context>,
) {
  const tools: RunnableTools<[ParsedArgs, string], Context> = [parsedTool, rawTool];
  const request = {
    model: 'gpt-4o',
    messages: [],
    tools,
    toolContext: { requestId: 'req_synthetic' },
  } satisfies ChatCompletionToolRunnerParams<[ParsedArgs, string], Context>;
  const streamingRequest = {
    ...request,
    stream: true,
  } satisfies ChatCompletionStreamingToolRunnerParams<[ParsedArgs, string], Context>;

  client.chat.completions.runTools(request);
  client.chat.completions.runTools(streamingRequest);

  // @ts-expect-error The parsed-argument tool cannot occupy the raw-string position.
  const reversed: RunnableTools<[ParsedArgs, string], Context> = [rawTool, parsedTool];
  void reversed;
}
