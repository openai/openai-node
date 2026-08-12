import { OpenAIError } from '../error';
import type { ChatCompletionTool } from '../resources/chat/completions';
import type {
  FunctionTool,
  ParsedContent,
  ParsedResponse,
  ParsedResponseFunctionToolCall,
  ParsedResponseOutputItem,
  Response,
  ResponseCreateParamsBase,
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
  ResponseFunctionToolCall,
  ResponseTextConfig,
  Tool,
} from '../resources/responses/responses';
import { isParseableResponseFormat, parseResponseFormatContent } from '../lib/parser';
import type { AutoParseableTextFormat } from '../lib/parser';

/** Response tools, a compatible chat completion tool, or no tools. */
export type ParseableToolsParams = Tool[] | ChatCompletionTool | null;

/** Response-creation parameters that may include tools recognized by parsing helpers. */
export type ResponseCreateParamsWithTools = ResponseCreateParamsBase & {
  /** Tools available to the model while producing the response. */
  tools?: ParseableToolsParams;
};

/** Request fields that can select a plain-text or structured Responses API output format. */
type TextConfigParams = {
  /** Optional text output configuration, including its structured JSON format. */
  text?: ResponseTextConfig;
};

/** Infers parsed output for each member of a possibly optional text-format union. */
type ParsedTextFormat<Format> = [Format] extends [never]
  ? null
  : Format extends AutoParseableTextFormat<infer ParsedT>
    ? ParsedT
    : Format extends ResponseFormatTextJSONSchemaConfig
      ? unknown
      : null;

/**
 * Resolves the type of `output_parsed` / `content[].parsed` for the given params.
 *
 * This must stay in sync with `isParseableResponseFormat()` and
 * `parseResponseFormatContent()`: formats built by an SDK helper carry their parsed
 * type in the brand, while a raw `{ type: 'json_schema' }` format is parsed with
 * `JSON.parse()` and so can only be described as `unknown`.
 */
export type ExtractParsedContentFromParams<Params extends TextConfigParams> = ParsedTextFormat<
  NonNullable<Params['text']>['format']
>;

/**
 * Adds parsed-output fields to a response, invoking parsers only when its request
 * includes an auto-parseable text format or strict function tool.
 */
export function maybeParseResponse<
  Params extends ResponseCreateParamsBase | null,
  ParsedT = Params extends null ? null : ExtractParsedContentFromParams<NonNullable<Params>>,
>(response: Response, params: Params): ParsedResponse<ParsedT> {
  if (!params || !hasAutoParseableInput(params)) {
    const parsed = {
      ...response,
      output_parsed: null,
      output: response.output.map((item) => {
        if (item.type === 'function_call') {
          return {
            ...item,
            parsed_arguments: null,
          };
        }

        if (item.type === 'message') {
          return {
            ...item,
            content: item.content.map((content) => ({
              ...content,
              parsed: null,
            })),
          };
        }
        return item;
      }),
    };

    if (needsOutputText(response, parsed)) {
      addOutputText(parsed as Response);
    }

    return parsed;
  }

  return parseResponse(response, params);
}

/**
 * Parses completed response text and strict function-tool arguments.
 *
 * Incomplete or nonterminal responses keep their parsed values as `null`, and
 * `output_parsed` returns the first successfully parsed output-text item.
 */
export function parseResponse<
  Params extends ResponseCreateParamsBase,
  ParsedT = ExtractParsedContentFromParams<Params>,
>(response: Response, params: Params): ParsedResponse<ParsedT> {
  const shouldParse = !response.status || response.status === 'completed';
  const output: ParsedResponseOutputItem<ParsedT>[] = response.output.map(
    (item): ParsedResponseOutputItem<ParsedT> => {
      if (item.type === 'function_call') {
        return shouldParse ? parseToolCall(params, item) : { ...item, parsed_arguments: null };
      }
      if (item.type === 'message') {
        const content: ParsedContent<ParsedT>[] = item.content.map((content) => {
          if (content.type === 'output_text') {
            return {
              ...content,
              parsed: shouldParse ? parseTextFormat(params, content.text) : null,
            };
          }

          return content;
        });

        return {
          ...item,
          content,
        };
      }

      return item;
    },
  );

  const parsed: Omit<ParsedResponse<ParsedT>, 'output_parsed'> = { ...response, output };
  if (needsOutputText(response, parsed)) {
    addOutputText(parsed);
  }

  Object.defineProperty(parsed, 'output_parsed', {
    enumerable: true,
    get() {
      for (const output of parsed.output) {
        if (output.type !== 'message') {
          continue;
        }

        for (const content of output.content) {
          if (content.type === 'output_text' && content.parsed !== null) {
            return content.parsed;
          }
        }
      }

      return null;
    },
  });

  return parsed as ParsedResponse<ParsedT>;
}

function parseTextFormat<
  Params extends ResponseCreateParamsBase,
  ParsedT = ExtractParsedContentFromParams<Params>,
>(params: Params, content: string): ParsedT | null {
  return parseResponseFormatContent<ParsedT>(params.text?.format, content);
}

/** Returns whether the request includes an auto-parseable text format or strict function tool. */
export function hasAutoParseableInput(params: ResponseCreateParamsWithTools): boolean {
  if (isParseableResponseFormat(params.text?.format)) {
    return true;
  }

  return (
    Array.isArray(params.tools) &&
    params.tools.some(
      (tool) => isAutoParsableTool(tool) || (tool.type === 'function' && tool.strict === true),
    )
  );
}

/** Type-level details used to infer a Responses API function tool's parser and callback. */
type ToolOptions = {
  /** Model-visible function name used to match generated tool calls. */
  name: string;
  /** Parsed argument value accepted by the optional execution callback. */
  arguments: any;
  /** Optional callback metadata associated with the parsed function tool. */
  function?: ((args: any) => any) | undefined;
};

/** A Responses API function tool with an argument parser and optional executable callback. */
export type AutoParseableResponseTool<
  OptionsT extends ToolOptions,
  HasFunction = OptionsT['function'] extends (...args: never[]) => unknown ? true : false,
> = FunctionTool & {
  /** Type-only marker for parsed tool arguments; this property does not exist at runtime. */
  __arguments: OptionsT['arguments']; // type-level only
  /** Type-only marker for the function name; this property does not exist at runtime. */
  __name: OptionsT['name']; // type-level only

  /** Non-enumerable SDK marker identifying a tool with an attached argument parser. */
  $brand: 'auto-parseable-tool';
  /** Optional callback available to helpers that execute parsed function tools. */
  $callback: ((args: OptionsT['arguments']) => any) | undefined;
  /** Parses the raw JSON argument string into the function's typed argument value. */
  $parseRaw(args: string): OptionsT['arguments'];
};

/** Copies a Responses API function tool and attaches non-enumerable parser and callback metadata. */
export function makeParseableResponseTool<OptionsT extends ToolOptions>(
  tool: FunctionTool,
  {
    parser,
    callback,
  }: {
    /** Converts the raw JSON argument string into the function's typed argument value. */
    parser: (content: string) => OptionsT['arguments'];
    /** Optional callback available to helpers that execute the parsed function. */
    callback: ((args: any) => any) | undefined;
  },
): AutoParseableResponseTool<OptionsT['arguments']> {
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

  return obj as AutoParseableResponseTool<OptionsT['arguments']>;
}

/** Returns whether a Responses API tool carries the SDK's argument-parser marker. */
export function isAutoParsableTool(tool: any): tool is AutoParseableResponseTool<any> {
  return tool?.['$brand'] === 'auto-parseable-tool';
}

function getInputToolByName(input_tools: Tool[], name: string): FunctionTool | undefined {
  return input_tools.find((tool) => tool.type === 'function' && tool.name === name) as
    | FunctionTool
    | undefined;
}

function parseToolCall<Params extends ResponseCreateParamsBase>(
  params: Params,
  toolCall: ResponseFunctionToolCall,
): ParsedResponseFunctionToolCall {
  const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);

  let parsedArguments: unknown = null;
  if (isAutoParsableTool(inputTool)) {
    parsedArguments = inputTool.$parseRaw(toolCall.arguments);
  } else if (inputTool?.strict) {
    parsedArguments = JSON.parse(toolCall.arguments);
  }

  return {
    ...toolCall,
    parsed_arguments: parsedArguments,
  };
}

/** Returns whether a response function call matches a strict or auto-parseable request tool. */
export function shouldParseToolCall(
  params: ResponseCreateParamsNonStreaming | null | undefined,
  toolCall: ResponseFunctionToolCall,
): boolean {
  if (!params) {
    return false;
  }

  const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
  return isAutoParsableTool(inputTool) || inputTool?.strict || false;
}

/**
 * Validates that compatible chat completion tools can be automatically parsed.
 *
 * @throws {OpenAIError} If a tool is not a function or is missing `strict: true`.
 */
export function validateInputTools(tools: ChatCompletionTool[] | undefined) {
  for (const tool of tools ?? []) {
    if (tool.type !== 'function') {
      throw new OpenAIError(
        `Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``,
      );
    }

    if (tool.function.strict !== true) {
      throw new OpenAIError(
        `The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`,
      );
    }
  }
}

function needsOutputText(
  response: Response,
  target: { output_text?: Response['output_text'] | null },
): boolean {
  return !Object.getOwnPropertyDescriptor(response, 'output_text') || target.output_text == null;
}

/** Replaces `output_text` with the concatenated text from every response output message. */
export function addOutputText(rsp: Response): void {
  const texts: string[] = [];
  for (const output of rsp.output) {
    if (output.type !== 'message') {
      continue;
    }

    for (const content of output.content) {
      if (content.type === 'output_text') {
        texts.push(content.text);
      }
    }
  }

  rsp.output_text = texts.join('');
}
