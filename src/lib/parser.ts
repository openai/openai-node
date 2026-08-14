import { ContentFilterFinishReasonError, LengthFinishReasonError, OpenAIError } from '../error';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsBase,
  ChatCompletionFunctionTool,
  ChatCompletionMessage,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
  ChatCompletionStreamingToolRunnerParams,
  ChatCompletionStreamingToolRunnerParamsWithContext,
  ChatCompletionStreamParams,
  ChatCompletionToolRunnerParams,
  ChatCompletionToolRunnerParamsWithContext,
  ParsedChatCompletion,
  ParsedChatCompletionMessageToolCall,
  ParsedChoice,
} from '../resources/chat/completions';
import type { ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';
import type { ResponseFormatJSONSchema } from '../resources/shared';

/** Chat completion creation, parsing, streaming, or tool-runner request parameters. */
type AnyChatCompletionCreateParams =
  | ChatCompletionCreateParams
  | ChatCompletionToolRunnerParams<any>
  | ChatCompletionToolRunnerParamsWithContext<any, any>
  | ChatCompletionStreamingToolRunnerParams<any>
  | ChatCompletionStreamingToolRunnerParamsWithContext<any, any>
  | ChatCompletionStreamParams;

/** Extracts the element type from an array while preserving non-array values. */
type Unpacked<T> = T extends (infer U)[] ? U : T;

/** One optional tool definition accepted by a chat completion request. */
type ToolCall = Unpacked<ChatCompletionCreateParamsBase['tools']>;

/** Returns whether an optional chat completion tool contains a function-tool definition. */
export function isChatCompletionFunctionTool(tool: ToolCall): tool is ChatCompletionFunctionTool {
  return tool !== undefined && 'function' in tool && tool.function !== undefined;
}

/** Infers parsed output for each member of a possibly optional response-format union. */
type ParsedResponseFormat<Format> = [Format] extends [never]
  ? null
  : Format extends AutoParseableResponseFormat<infer ParsedT>
    ? ParsedT
    : Format extends ResponseFormatJSONSchema
      ? unknown
      : null;

/**
 * Resolves the type of `message.parsed` / `content[].parsed` for the given params.
 *
 * This must stay in sync with {@link isParseableResponseFormat} and
 * {@link parseResponseFormatContent}: formats built by an SDK helper carry their
 * parsed type in the brand, while a raw `{ type: 'json_schema' }` format is parsed
 * with `JSON.parse()` and so can only be described as `unknown`.
 */
export type ExtractParsedContentFromParams<Params extends AnyChatCompletionCreateParams> =
  ParsedResponseFormat<Params['response_format']>;

/** A Chat Completions JSON Schema response format with an attached structured-output parser. */
export type AutoParseableResponseFormat<ParsedT> = ResponseFormatJSONSchema & {
  /** Type-only marker used to infer the parser's output; this property does not exist at runtime. */
  __output: ParsedT; // type-level only

  /** Non-enumerable SDK marker identifying a response format with an attached parser. */
  $brand: 'auto-parseable-response-format';
  /** Parses the completed raw assistant text into the response format's output type. */
  $parseRaw(content: string): ParsedT;
};

/** Copies a JSON Schema response format and attaches a non-enumerable structured-output parser. */
export function makeParseableResponseFormat<ParsedT>(
  response_format: ResponseFormatJSONSchema,
  parser: (content: string) => ParsedT,
): AutoParseableResponseFormat<ParsedT> {
  const obj = { ...response_format };

  Object.defineProperties(obj, {
    $brand: {
      value: 'auto-parseable-response-format',
      enumerable: false,
    },
    $parseRaw: {
      value: parser,
      enumerable: false,
    },
  });

  return obj as AutoParseableResponseFormat<ParsedT>;
}

/** A Responses API JSON Schema text format with an attached structured-output parser. */
export type AutoParseableTextFormat<ParsedT> = ResponseFormatTextJSONSchemaConfig & {
  /** Type-only marker used to infer the parser's output; this property does not exist at runtime. */
  __output: ParsedT; // type-level only

  /** Non-enumerable SDK marker identifying a text format with an attached parser. */
  $brand: 'auto-parseable-response-format';
  /** Parses completed output text into the text format's structured output type. */
  $parseRaw(content: string): ParsedT;
};

/** Copies a Responses API text format and attaches a non-enumerable structured-output parser. */
export function makeParseableTextFormat<ParsedT>(
  response_format: ResponseFormatTextJSONSchemaConfig,
  parser: (content: string) => ParsedT,
): AutoParseableTextFormat<ParsedT> {
  const obj = { ...response_format };

  Object.defineProperties(obj, {
    $brand: {
      value: 'auto-parseable-response-format',
      enumerable: false,
    },
    $parseRaw: {
      value: parser,
      enumerable: false,
    },
  });

  return obj as AutoParseableTextFormat<ParsedT>;
}

/**
 * Whether the given format was built by an SDK helper (e.g. `zodResponseFormat()`)
 * and therefore carries its own `$parseRaw` callback.
 *
 * Prefer {@link isParseableResponseFormat} when deciding whether output should be
 * parsed at all; raw `{ type: 'json_schema' }` formats are parsed too, but are not
 * branded.
 */
export function isAutoParsableResponseFormat<ParsedT>(
  response_format: any,
): response_format is AutoParseableResponseFormat<ParsedT> {
  return response_format?.['$brand'] === 'auto-parseable-response-format';
}

/**
 * The canonical definition of an auto-parseable response format, covering both the
 * Chat Completions `response_format` and the Responses `text.format` shapes.
 *
 * Every gate that decides whether output should be parsed must go through this
 * predicate so the runtime, the streaming events and
 * {@link ExtractParsedContentFromParams} cannot drift apart.
 */
export function isParseableResponseFormat(format: unknown): boolean {
  return isAutoParsableResponseFormat(format) || (format as { type?: string } | null)?.type === 'json_schema';
}

/**
 * The canonical parser for auto-parseable response formats. This is the only place
 * that chooses between an existing `$parseRaw` callback and generic `JSON.parse()`.
 *
 * Returns `null` for formats that are not auto-parseable.
 */
export function parseResponseFormatContent<ParsedT>(format: unknown, content: string): ParsedT | null {
  if (!isParseableResponseFormat(format)) {
    return null;
  }

  if (
    typeof format === 'object' &&
    format !== null &&
    '$parseRaw' in format &&
    typeof format.$parseRaw === 'function'
  ) {
    return format.$parseRaw(content) as ParsedT;
  }

  return JSON.parse(content) as ParsedT;
}

/** Type-level details used to infer a chat function tool's parser and execution callback. */
type ToolOptions = {
  /** Model-visible function name used to match generated tool calls. */
  name: string;
  /** Parsed argument value accepted by the optional execution callback. */
  arguments: any;
  /** Optional callback invoked by chat completion tool-running helpers. */
  function?: ((args: any) => any) | undefined;
};

/** A Chat Completions function tool with an argument parser and optional executable callback. */
export type AutoParseableTool<
  OptionsT extends ToolOptions,
  HasFunction = OptionsT['function'] extends (...args: never[]) => unknown ? true : false,
> = ChatCompletionFunctionTool & {
  /** Type-only marker for parsed tool arguments; this property does not exist at runtime. */
  __arguments: OptionsT['arguments']; // type-level only
  /** Type-only marker for the tool name; this property does not exist at runtime. */
  __name: OptionsT['name']; // type-level only
  /** Type-only marker indicating whether a runnable callback was supplied. */
  __hasFunction: HasFunction; // type-level only

  /** Non-enumerable SDK marker identifying a tool with an attached argument parser. */
  $brand: 'auto-parseable-tool';
  /** Optional runnable callback used by `.runTools()` after arguments are parsed. */
  $callback: ((args: OptionsT['arguments']) => any) | undefined;
  /** Parses the raw JSON argument string into the callback's typed argument value. */
  $parseRaw(args: string): OptionsT['arguments'];
};

/** Copies a function tool and attaches non-enumerable parsing and callback metadata. */
export function makeParseableTool<OptionsT extends ToolOptions>(
  tool: ChatCompletionFunctionTool,
  {
    parser,
    callback,
  }: {
    /** Converts the raw JSON argument string into the tool's typed argument value. */
    parser: (content: string) => OptionsT['arguments'];
    /** Optional callback invoked by a chat completion tool runner. */
    callback: ((args: any) => any) | undefined;
  },
): AutoParseableTool<OptionsT['arguments']> {
  const obj = { ...tool };

  Object.defineProperties(obj, {
    $brand: {
      value: 'auto-parseable-tool',
      enumerable: false,
    },
    $parseRaw: {
      value: parser,
      enumerable: false,
    },
    $callback: {
      value: callback,
      enumerable: false,
    },
  });

  return obj as AutoParseableTool<OptionsT['arguments']>;
}

/** Returns whether a Chat Completions tool carries the SDK's argument-parser marker. */
export function isAutoParsableTool(tool: any): tool is AutoParseableTool<any> {
  return tool?.['$brand'] === 'auto-parseable-tool';
}

/**
 * Adds parsed-content fields to a chat completion, invoking parsers only when the
 * request includes an auto-parseable response format or a strict function tool.
 */
export function maybeParseChatCompletion<
  Params extends ChatCompletionCreateParams | null,
  ParsedT = Params extends null ? null : ExtractParsedContentFromParams<NonNullable<Params>>,
>(completion: ChatCompletion, params: Params): ParsedChatCompletion<ParsedT> {
  if (!params || !hasAutoParseableInput(params)) {
    return {
      ...completion,
      choices: completion.choices.map((choice) => ({
        ...choice,
        message: {
          ...choice.message,
          parsed: null,
          ...(choice.message.tool_calls
            ? {
                tool_calls: choice.message.tool_calls,
              }
            : undefined),
        },
      })),
    };
  }

  return parseChatCompletion(completion, params);
}

/**
 * Parses structured assistant content and strict function-tool arguments.
 *
 * @throws {LengthFinishReasonError} If generation stopped at its token limit.
 * @throws {ContentFilterFinishReasonError} If generation stopped because of content filtering.
 * @throws {OpenAIError} If the completion contains an unsupported tool-call type.
 */
export function parseChatCompletion<
  Params extends ChatCompletionCreateParams,
  ParsedT = ExtractParsedContentFromParams<Params>,
>(completion: ChatCompletion, params: Params): ParsedChatCompletion<ParsedT> {
  const choices: ParsedChoice<ParsedT>[] = completion.choices.map((choice): ParsedChoice<ParsedT> => {
    if (choice.finish_reason === 'length') {
      throw new LengthFinishReasonError();
    }

    if (choice.finish_reason === 'content_filter') {
      throw new ContentFilterFinishReasonError();
    }

    return {
      ...choice,
      message: {
        ...choice.message,
        ...(choice.message.tool_calls
          ? {
              tool_calls:
                choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? undefined,
            }
          : undefined),
        parsed:
          choice.message.content !== null &&
          choice.message.content !== undefined &&
          !choice.message.refusal &&
          (choice.message.content !== '' ||
            (!choice.message.tool_calls?.length && !choice.message.function_call))
            ? parseResponseFormat(params, choice.message.content)
            : null,
      },
    };
  });

  return { ...completion, choices };
}

function parseResponseFormat<
  Params extends ChatCompletionCreateParams,
  ParsedT = ExtractParsedContentFromParams<Params>,
>(params: Params, content: string): ParsedT | null {
  return parseResponseFormatContent<ParsedT>(params.response_format, content);
}

function parseToolCall<Params extends ChatCompletionCreateParams>(
  params: Params,
  toolCall: ChatCompletionMessageToolCall,
): ParsedChatCompletionMessageToolCall {
  if (toolCall.type === 'custom') {
    return toolCall;
  }

  if (toolCall.type !== 'function') {
    const unsupportedType = (toolCall as { type: string }).type;
    throw new OpenAIError(
      `Currently only \`function\` and \`custom\` tool calls are supported; Received \`${unsupportedType}\``,
    );
  }

  const inputTool = params.tools?.find(
    (inputTool) =>
      isChatCompletionFunctionTool(inputTool) && inputTool.function?.name === toolCall.function.name,
  ) as ChatCompletionFunctionTool | undefined; // TS doesn't narrow based on isChatCompletionTool
  let parsedArguments: unknown = null;
  if (isAutoParsableTool(inputTool)) {
    parsedArguments = inputTool.$parseRaw(toolCall.function.arguments);
  } else if (inputTool?.function.strict) {
    parsedArguments = JSON.parse(toolCall.function.arguments);
  }

  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      parsed_arguments: parsedArguments,
    },
  };
}

/** Returns whether a tool call matches a strict or auto-parseable function in the request. */
export function shouldParseToolCall(
  params: ChatCompletionCreateParams | null | undefined,
  // accepts partially accumulated tool calls so streaming snapshots can be checked as they build up
  toolCall: {
    type?: ChatCompletionMessageToolCall['type'];
    function?: { name?: string };
  },
): boolean {
  if (!params || !('tools' in params) || !params.tools || toolCall.type !== 'function') {
    return false;
  }

  const inputTool = params.tools?.find(
    (inputTool) =>
      isChatCompletionFunctionTool(inputTool) && inputTool.function?.name === toolCall.function?.name,
  );
  return (
    isChatCompletionFunctionTool(inputTool) &&
    (isAutoParsableTool(inputTool) || inputTool?.function.strict || false)
  );
}

/** Returns whether the request contains an auto-parseable response format or strict function tool. */
export function hasAutoParseableInput(params: AnyChatCompletionCreateParams): boolean {
  if (isParseableResponseFormat(params.response_format)) {
    return true;
  }

  return (
    params.tools?.some(
      (t) => isAutoParsableTool(t) || (t.type === 'function' && t.function.strict === true),
    ) ?? false
  );
}

/**
 * Narrows completion tool calls to function calls supported by parsing helpers.
 *
 * @throws {OpenAIError} If any tool call has a non-function type.
 */
export function assertToolCallsAreChatCompletionFunctionToolCalls(
  toolCalls: ChatCompletionMessage['tool_calls'],
): asserts toolCalls is ChatCompletionMessageFunctionToolCall[] {
  for (const toolCall of toolCalls || []) {
    if (toolCall.type !== 'function') {
      throw new OpenAIError(
        `Currently only \`function\` tool calls are supported; Received \`${toolCall.type}\``,
      );
    }
  }
}

/**
 * Validates strict function tools while preserving supported custom tools.
 *
 * @throws {OpenAIError} If a tool is unsupported or a function is missing `strict: true`.
 */
export function validateInputTools(tools: ChatCompletionCreateParamsBase['tools']) {
  for (const tool of tools ?? []) {
    if (tool.type === 'custom') {
      continue;
    }

    if (tool.type !== 'function') {
      const unsupportedType = (tool as { type: string }).type;
      throw new OpenAIError(
        `Currently only \`function\` and \`custom\` tool types are supported; Received \`${unsupportedType}\``,
      );
    }

    if (tool.function.strict !== true) {
      throw new OpenAIError(
        `The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`,
      );
    }
  }
}
