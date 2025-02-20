import {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from '../resources/chat/completions';
import {
  ChatCompletionStreamingToolRunnerParams,
  ChatCompletionStreamParams,
  ChatCompletionToolRunnerParams,
  ParsedChatCompletion,
  ParsedChoice,
  ParsedFunctionToolCall,
} from '../resources/beta/chat/completions';
import { ResponseFormatJSONSchema } from '../resources/shared';
import { ContentFilterFinishReasonError, LengthFinishReasonError, OpenAIError } from '../error';

type AnyChatCompletionCreateParams =
  | ChatCompletionCreateParams
  | ChatCompletionToolRunnerParams<any>
  | ChatCompletionStreamingToolRunnerParams<any>
  | ChatCompletionStreamParams;

export type ExtractParsedContentFromParams<Params extends AnyChatCompletionCreateParams> =
  Params['response_format'] extends AutoParseableResponseFormat<infer P> ? P : null;

export type AutoParseableResponseFormat<ParsedT> = ResponseFormatJSONSchema & {
  __output: ParsedT; // type-level only

  $brand: 'auto-parseable-response-format';
  $parseRaw(content: string): ParsedT;
};

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

export function isAutoParsableResponseFormat<ParsedT>(
  response_format: any,
): response_format is AutoParseableResponseFormat<ParsedT> {
  return response_format?.['$brand'] === 'auto-parseable-response-format';
}

type ToolOptions = {
  name: string;
  arguments: any;
  function?: ((args: any) => any) | undefined;
};

export type AutoParseableTool<
  OptionsT extends ToolOptions,
  HasFunction = OptionsT['function'] extends Function ? true : false,
> = ChatCompletionTool & {
  __arguments: OptionsT['arguments']; // type-level only
  __name: OptionsT['name']; // type-level only
  __hasFunction: HasFunction; // type-level only

  $brand: 'auto-parseable-tool';
  $callback: ((args: OptionsT['arguments']) => any) | undefined;
  $parseRaw(args: string): OptionsT['arguments'];
};

export function makeParseableTool<OptionsT extends ToolOptions>(
  tool: ChatCompletionTool,
  {
    parser,
    callback,
  }: {
    parser: (content: string) => OptionsT['arguments'];
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

export function isAutoParsableTool(tool: any): tool is AutoParseableTool<any> {
  return tool?.['$brand'] === 'auto-parseable-tool';
}

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
          ...(choice.message.tool_calls ?
            {
              tool_calls: choice.message.tool_calls,
            }
          : undefined),
        },
      })),
    };
  }

  return parseChatCompletion(completion, params);
}

export function parseChatCompletion<
  Params extends ChatCompletionCreateParams,
  ParsedT = ExtractParsedContentFromParams<Params>,
>(completion: ChatCompletion, params: Params): ParsedChatCompletion<ParsedT> {
  const choices: Array<ParsedChoice<ParsedT>> = completion.choices.map((choice): ParsedChoice<ParsedT> => {
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
        ...(choice.message.tool_calls ?
          {
            tool_calls:
              choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? undefined,
          }
        : undefined),
        parsed:
          choice.message.content && !choice.message.refusal ?
            parseResponseFormat(params, choice.message.content)
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
  if (params.response_format?.type !== 'json_schema') {
    return null;
  }

  if (params.response_format?.type === 'json_schema') {
    if ('$parseRaw' in params.response_format) {
      const response_format = params.response_format as AutoParseableResponseFormat<ParsedT>;

      return response_format.$parseRaw(content);
    }

    return JSON.parse(content);
  }

  return null;
}

function parseToolCall<Params extends ChatCompletionCreateParams>(
  params: Params,
  toolCall: ChatCompletionMessageToolCall,
): ParsedFunctionToolCall {
  const inputTool = params.tools?.find((inputTool) => inputTool.function?.name === toolCall.function.name);
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      parsed_arguments:
        isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.function.arguments)
        : inputTool?.function.strict ? JSON.parse(toolCall.function.arguments)
        : null,
    },
  };
}

export function shouldParseToolCall(
  params: ChatCompletionCreateParams | null | undefined,
  toolCall: ChatCompletionMessageToolCall,
): boolean {
  if (!params) {
    return false;
  }

  const inputTool = params.tools?.find((inputTool) => inputTool.function?.name === toolCall.function.name);
  return isAutoParsableTool(inputTool) || inputTool?.function.strict || false;
}

export function hasAutoParseableInput(params: AnyChatCompletionCreateParams): boolean {
  if (isAutoParsableResponseFormat(params.response_format)) {
    return true;
  }

  return (
    params.tools?.some(
      (t) => isAutoParsableTool(t) || (t.type === 'function' && t.function.strict === true),
    ) ?? false
  );
}

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
