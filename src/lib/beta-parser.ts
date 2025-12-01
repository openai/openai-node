import { OpenAIError } from '../core/error';
import {
  BetaContentBlock,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaTextBlock,
  MessageCreateParams,
} from '../resources/beta/messages/messages';

// vendored from typefest just to make things look a bit nicer on hover
type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

export type BetaParseableMessageCreateParams = Simplify<
  Omit<MessageCreateParams, 'output_format'> & {
    output_format?: BetaJSONOutputFormat | AutoParseableBetaOutputFormat<any> | null;
  }
>;

export type ExtractParsedContentFromBetaParams<Params extends BetaParseableMessageCreateParams> =
  Params['output_format'] extends AutoParseableBetaOutputFormat<infer P> ? P : null;

export type AutoParseableBetaOutputFormat<ParsedT> = BetaJSONOutputFormat & {
  parse(content: string): ParsedT;
};

export type ParsedBetaMessage<ParsedT> = BetaMessage & {
  content: Array<ParsedBetaContentBlock<ParsedT>>;
  parsed_output: ParsedT | null;
};

export type ParsedBetaContentBlock<ParsedT> =
  | (BetaTextBlock & { parsed: ParsedT | null })
  | Exclude<BetaContentBlock, BetaTextBlock>;

export function maybeParseBetaMessage<Params extends BetaParseableMessageCreateParams | null>(
  message: BetaMessage,
  params: Params,
): ParsedBetaMessage<ExtractParsedContentFromBetaParams<NonNullable<Params>>> {
  if (!params || !('parse' in (params.output_format ?? {}))) {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === 'text') {
          return {
            ...block,
            parsed: null,
          };
        }
        return block;
      }),
      parsed_output: null,
    } as ParsedBetaMessage<ExtractParsedContentFromBetaParams<NonNullable<Params>>>;
  }

  return parseBetaMessage(message, params);
}

export function parseBetaMessage<Params extends BetaParseableMessageCreateParams>(
  message: BetaMessage,
  params: Params,
): ParsedBetaMessage<ExtractParsedContentFromBetaParams<Params>> {
  let firstParsed: ReturnType<typeof parseBetaOutputFormat<Params>> | null = null;

  const content: Array<ParsedBetaContentBlock<ExtractParsedContentFromBetaParams<Params>>> =
    message.content.map((block) => {
      if (block.type === 'text') {
        const parsed = parseBetaOutputFormat(params, block.text);

        if (firstParsed === null) {
          firstParsed = parsed;
        }

        return {
          ...block,
          parsed,
        };
      }
      return block;
    });

  return {
    ...message,
    content,
    parsed_output: firstParsed,
  } as ParsedBetaMessage<ExtractParsedContentFromBetaParams<Params>>;
}

function parseBetaOutputFormat<Params extends BetaParseableMessageCreateParams>(
  params: Params,
  content: string,
): ExtractParsedContentFromBetaParams<Params> | null {
  if (params.output_format?.type !== 'json_schema') {
    return null;
  }

  try {
    if ('parse' in params.output_format) {
      return params.output_format.parse(content);
    }

    return JSON.parse(content);
  } catch (error) {
    throw new OpenAIError(`Failed to parse structured output: ${error}`);
  }
}
