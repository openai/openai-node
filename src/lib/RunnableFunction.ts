import type { ChatCompletionRunner } from './ChatCompletionRunner';
import type { ChatCompletionStreamingRunner } from './ChatCompletionStreamingRunner';
import type { JSONSchema } from './jsonschema';

/** A synchronous callback result or a promise that resolves to the same result. */
type PromiseOrValue<T> = T | Promise<T>;

/** A function tool that parses raw JSON arguments before invoking its callback. */
export type RunnableFunctionWithParse<Args extends object, ToolContext = unknown> = {
  /**
   * @param args the return value from `parse`.
   * @param runner the runner evaluating this callback.
   * @param toolContext the context passed to `.runTools()`.
   * @returns A value that the runner serializes into a tool-result message.
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
   * The parameters the function accepts, described as a JSON Schema object.
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
  /** Whether the tool's parameters use strict Structured Outputs validation. */
  strict?: boolean | undefined;
};

/** A function tool whose callback receives the model's raw JSON argument string. */
export type RunnableFunctionWithoutParse<ToolContext = unknown> = {
  /**
   * @param args the raw args from the OpenAI function call.
   * @param runner the runner evaluating this callback.
   * @param toolContext the context passed to `.runTools()`.
   * @returns A value that the runner serializes into a tool-result message.
   */
  function: (
    args: string,
    runner: ChatCompletionRunner<unknown> | ChatCompletionStreamingRunner<unknown>,
    toolContext: ToolContext,
  ) => PromiseOrValue<unknown>;
  /**
   * The parameters the function accepts, described as a JSON Schema object.
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
  /** Whether the tool's parameters use strict Structured Outputs validation. */
  strict?: boolean | undefined;
};

/** Selects a raw-argument or parsed-argument runnable function from its argument type. */
export type RunnableFunction<Args extends object | string, ToolContext = unknown> = Args extends string
  ? RunnableFunctionWithoutParse<ToolContext>
  : Args extends object
    ? RunnableFunctionWithParse<Args, ToolContext>
    : never;

/** Wraps a raw-argument or parsed-argument runnable function in an API function-tool shape. */
export type RunnableToolFunction<Args extends object | string, ToolContext = unknown> = Args extends string
  ? RunnableToolFunctionWithoutParse<ToolContext>
  : Args extends object
    ? RunnableToolFunctionWithParse<Args, ToolContext>
    : never;

/** An executable API function tool whose callback receives raw JSON arguments. */
export type RunnableToolFunctionWithoutParse<ToolContext = unknown> = {
  /** Identifies this tool as a callable function. */
  type: 'function';
  /** The function definition, callback, and raw-argument configuration. */
  function: RunnableFunctionWithoutParse<ToolContext>;
};
/** An executable API function tool whose callback receives parsed arguments. */
export type RunnableToolFunctionWithParse<Args extends object, ToolContext = unknown> = {
  /** Identifies this tool as a callable function. */
  type: 'function';
  /** The function definition, argument parser, and callback. */
  function: RunnableFunctionWithParse<Args, ToolContext>;
};

/**
 * A broad tool shape for contextually typing callbacks when the argument type is inferred.
 */
export type RunnableToolFunctionWithContext<ToolContext> = {
  /** Identifies this tool as a callable function. */
  type: 'function';
  /** The function definition whose callback receives the runner's context value. */
  function: {
    /** Invokes the tool with its arguments, active runner, and supplied context. */
    function: (
      args: any,
      runner: ChatCompletionRunner<unknown> | ChatCompletionStreamingRunner<unknown>,
      toolContext: ToolContext,
    ) => PromiseOrValue<unknown>;
    /** Optionally converts raw JSON arguments into the callback's argument value. */
    parse?: (input: string) => PromiseOrValue<any>;
    /** JSON Schema describing the arguments accepted by the function. */
    parameters: JSONSchema;
    /** Model-facing explanation of what the function does and when to call it. */
    description: string;
    /** Explicit function name; defaults to the JavaScript callback's name. */
    name?: string | undefined;
    /** Whether the tool's parameters use strict Structured Outputs validation. */
    strict?: boolean | undefined;
  };
};

/** Returns whether a runnable function provides a parser for its raw argument string. */
export function isRunnableFunctionWithParse<Args extends object, ToolContext = unknown>(
  fn: any,
): fn is RunnableFunctionWithParse<Args, ToolContext> {
  return typeof (fn as any).parse === 'function';
}

/** The ordered raw-string or parsed-object argument types accepted by runnable functions. */
export type BaseFunctionsArgs = readonly (object | string)[];

/** Runnable function definitions whose callback arguments correspond to an argument-type tuple. */
export type RunnableFunctions<FunctionsArgs extends BaseFunctionsArgs, ToolContext = unknown> = [
  any[],
] extends [FunctionsArgs]
  ? readonly RunnableFunction<any, ToolContext>[]
  : {
      [Index in keyof FunctionsArgs]: Index extends number
        ? RunnableFunction<FunctionsArgs[Index], ToolContext>
        : FunctionsArgs[Index];
    };

/** Runnable function tools whose callback arguments correspond to an argument-type tuple. */
export type RunnableTools<FunctionsArgs extends BaseFunctionsArgs, ToolContext = unknown> = [any[]] extends [
  FunctionsArgs,
]
  ? readonly RunnableToolFunction<any, ToolContext>[]
  : {
      [Index in keyof FunctionsArgs]: Index extends number
        ? RunnableToolFunction<FunctionsArgs[Index], ToolContext>
        : FunctionsArgs[Index];
    };

/**
 * This is helper class for passing a `function` and `parse` where the `function`
 * argument type matches the `parse` return type.
 */
export class ParsingToolFunction<Args extends object, ToolContext = unknown> {
  /** Identifies the wrapped tool as a callable function. */
  type = 'function' as const;
  /** The wrapped function definition, argument parser, and callback. */
  function: RunnableFunctionWithParse<Args, ToolContext>;

  /** Wraps a parsed-argument function definition in the function-tool shape. */
  constructor(input: RunnableFunctionWithParse<Args, ToolContext>) {
    this.function = input;
  }
}
