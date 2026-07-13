import { type ChatCompletionRunner } from './ChatCompletionRunner';
import { type ChatCompletionStreamingRunner } from './ChatCompletionStreamingRunner';
import { JSONSchema } from './jsonschema';

type PromiseOrValue<T> = T | Promise<T>;

export type RunnableFunctionWithParse<Args extends object, ToolContext = unknown> = {
  /**
   * @param args the return value from `parse`.
   * @param runner the runner evaluating this callback.
   * @param toolContext the context passed to `.runTools()`.
   * @returns a string to send back to OpenAI.
   */
  function: (
    args: Args,
    runner: ChatCompletionRunner<unknown> | ChatCompletionStreamingRunner<unknown>,
    toolContext: ToolContext,
  ) => PromiseOrValue<unknown>;
  /**
   * @param input the raw args from the OpenAI function call.
   * @returns the parsed arguments to pass to `function`
   */
  parse: (input: string) => PromiseOrValue<Args>;
  /**
   * The parameters the function accepts, describes as a JSON Schema object.
   */
  parameters: JSONSchema;
  /**
   * A description of what the function does, used by the model to choose when and how to call the function.
   */
  description: string;
  /**
   * The name of the function to be called. Will default to function.name if omitted.
   */
  name?: string | undefined;
  strict?: boolean | undefined;
};

export type RunnableFunctionWithoutParse<ToolContext = unknown> = {
  /**
   * @param args the raw args from the OpenAI function call.
   * @param runner the runner evaluating this callback.
   * @param toolContext the context passed to `.runTools()`.
   * @returns a string to send back to OpenAI
   */
  function: (
    args: string,
    runner: ChatCompletionRunner<unknown> | ChatCompletionStreamingRunner<unknown>,
    toolContext: ToolContext,
  ) => PromiseOrValue<unknown>;
  /**
   * The parameters the function accepts, describes as a JSON Schema object.
   */
  parameters: JSONSchema;
  /**
   * A description of what the function does, used by the model to choose when and how to call the function.
   */
  description: string;
  /**
   * The name of the function to be called. Will default to function.name if omitted.
   */
  name?: string | undefined;
  strict?: boolean | undefined;
};

export type RunnableFunction<Args extends object | string, ToolContext = unknown> = Args extends string ?
  RunnableFunctionWithoutParse<ToolContext>
: Args extends object ? RunnableFunctionWithParse<Args, ToolContext>
: never;

export type RunnableToolFunction<Args extends object | string, ToolContext = unknown> = Args extends string ?
  RunnableToolFunctionWithoutParse<ToolContext>
: Args extends object ? RunnableToolFunctionWithParse<Args, ToolContext>
: never;

export type RunnableToolFunctionWithoutParse<ToolContext = unknown> = {
  type: 'function';
  function: RunnableFunctionWithoutParse<ToolContext>;
};
export type RunnableToolFunctionWithParse<Args extends object, ToolContext = unknown> = {
  type: 'function';
  function: RunnableFunctionWithParse<Args, ToolContext>;
};

/**
 * A broad tool shape for contextually typing callbacks when the argument type is inferred.
 */
export type RunnableToolFunctionWithContext<ToolContext> = {
  type: 'function';
  function: {
    function: (
      args: any,
      runner: ChatCompletionRunner<unknown> | ChatCompletionStreamingRunner<unknown>,
      toolContext: ToolContext,
    ) => PromiseOrValue<unknown>;
    parse?: (input: string) => PromiseOrValue<any>;
    parameters: JSONSchema;
    description: string;
    name?: string | undefined;
    strict?: boolean | undefined;
  };
};

export function isRunnableFunctionWithParse<Args extends object, ToolContext = unknown>(
  fn: any,
): fn is RunnableFunctionWithParse<Args, ToolContext> {
  return typeof (fn as any).parse === 'function';
}

export type BaseFunctionsArgs = readonly (object | string)[];

export type RunnableFunctions<FunctionsArgs extends BaseFunctionsArgs, ToolContext = unknown> = [
  any[],
] extends [FunctionsArgs] ?
  readonly RunnableFunction<any, ToolContext>[]
: {
    [Index in keyof FunctionsArgs]: Index extends number ? RunnableFunction<FunctionsArgs[Index], ToolContext>
    : FunctionsArgs[Index];
  };

export type RunnableTools<FunctionsArgs extends BaseFunctionsArgs, ToolContext = unknown> = [any[]] extends (
  [FunctionsArgs]
) ?
  readonly RunnableToolFunction<any, ToolContext>[]
: {
    [Index in keyof FunctionsArgs]: Index extends number ?
      RunnableToolFunction<FunctionsArgs[Index], ToolContext>
    : FunctionsArgs[Index];
  };

/**
 * This is helper class for passing a `function` and `parse` where the `function`
 * argument type matches the `parse` return type.
 */
export class ParsingToolFunction<Args extends object, ToolContext = unknown> {
  type: 'function';
  function: RunnableFunctionWithParse<Args, ToolContext>;

  constructor(input: RunnableFunctionWithParse<Args, ToolContext>) {
    this.type = 'function';
    this.function = input;
  }
}
