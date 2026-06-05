import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from '../resources/chat/completions/completions';

/**
 * Result of a token estimation for a chat completion request.
 */
export interface TokenEstimate {
  /**
   * Estimated number of tokens in the input (messages + tool definitions).
   */
  inputTokens: number;

  /**
   * Estimated maximum number of tokens that could be generated,
   * based on the model's context window minus the estimated input tokens.
   * Returns undefined if the model is unknown.
   */
  maxOutputTokens?: number;

  /**
   * The total context window size for the model, if known.
   */
  contextWindow?: number | undefined;
}

/**
 * Known context window sizes for common models.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // GPT-4 class
  'gpt-4': 8192,
  'gpt-4-0314': 8192,
  'gpt-4-0613': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-32k-0314': 32768,
  'gpt-4-32k-0613': 32768,
  'gpt-4-1106-preview': 128000,
  'gpt-4-0125-preview': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-2024-04-09': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4-vision-preview': 128000,
  'gpt-4-1106-vision-preview': 128000,

  // GPT-4.1 class
  'gpt-4.1': 1048576,
  'gpt-4.1-mini': 1048576,
  'gpt-4.1-nano': 1048576,

  // GPT-4o class
  'gpt-4o': 128000,
  'gpt-4o-2024-05-13': 128000,
  'gpt-4o-2024-08-06': 128000,
  'gpt-4o-2024-11-20': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4o-mini-2024-07-18': 128000,
  'gpt-4o-audio-preview': 128000,
  'gpt-4o-audio-preview-2024-10-01': 128000,
  'gpt-4o-audio-preview-2024-12-17': 128000,
  'gpt-4o-mini-audio-preview': 128000,
  'gpt-4o-mini-audio-preview-2024-12-17': 128000,

  // GPT-5 class
  'gpt-5': 262144,
  'gpt-5-mini': 262144,
  'gpt-5-nano': 262144,
  'gpt-5-2025-02-10': 262144,
  'gpt-5-mini-2025-02-10': 262144,
  'gpt-5-nano-2025-02-10': 262144,
  'gpt-5.1': 262144,
  'gpt-5.1-codex': 262144,
  'gpt-5.1-codex-max': 262144,
  'gpt-5.1-codex-mini': 262144,
  'gpt-5.4': 262144,
  'gpt-5.4-pro': 400000,
  'gpt-5.5': 272000,
  'gpt-5.5-pro': 400000,

  // o-series
  'o1': 200000,
  'o1-2024-12-17': 200000,
  'o1-mini': 128000,
  'o1-mini-2024-09-12': 128000,
  'o1-pro': 200000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  'o3-2025-04-16': 200000,
  'o4-mini-2025-04-16': 200000,

  // GPT-3.5 class
  'gpt-3.5-turbo': 4096,
  'gpt-3.5-turbo-0301': 4096,
  'gpt-3.5-turbo-0613': 4096,
  'gpt-3.5-turbo-1106': 16385,
  'gpt-3.5-turbo-0125': 16385,
  'gpt-3.5-turbo-16k': 16385,
  'gpt-3.5-turbo-16k-0613': 16385,
};

/**
 * Characters-per-token ratio used for estimation. This is a conservative
 * estimate based on typical English text. Actual token counts depend on the
 * specific tokenizer and the content being tokenized.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Fixed token overhead per message for the chat format.
 * This accounts for role markers, separators, and other formatting tokens
 * that the chat template adds around each message.
 */
const TOKENS_PER_MESSAGE = 4;

/**
 * Additional token overhead if the message has a `name` field.
 */
const TOKENS_PER_NAME = 1;

/**
 * Base overhead for the entire chat completion request.
 */
const BASE_OVERHEAD = 3;

/**
 * Estimate the number of tokens in a string value.
 * Uses a character-counting heuristic.
 */
function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the number of tokens in the text content of a message.
 * Handles both string content and content arrays.
 */
function estimateMessageContent(content: unknown): number {
  if (typeof content === 'string') {
    return estimateStringTokens(content);
  }

  if (Array.isArray(content)) {
    let tokens = 0;
    for (const part of content) {
      if (part && typeof part === 'object') {
        if ('text' in part && typeof part.text === 'string') {
          tokens += estimateStringTokens(part.text);
        } else if ('image_url' in part) {
          // Images are tokenized into a fixed number of tokens depending on detail level
          const detail = part.image_url?.detail || 'auto';
          if (detail === 'low' || detail === 'auto') {
            tokens += 85; // low-res images: 85 tokens
          } else {
            tokens += 765; // high-res images: roughly 765 tokens (may vary)
          }
        } else if ('input_audio' in part) {
          // Audio is tokenized separately; rough estimate
          tokens += 50;
        } else if ('refusal' in part && typeof part.refusal === 'string') {
          tokens += estimateStringTokens(part.refusal);
        }
      }
    }
    return tokens;
  }

  return 0;
}

/**
 * Estimate the number of tokens for a single chat completion message,
 * including the overhead from role and formatting.
 */
function estimateMessageTokens(message: ChatCompletionMessageParam): number {
  let tokens = TOKENS_PER_MESSAGE;

  // Content tokens
  const content = (message as any).content;
  if (content !== undefined && content !== null) {
    tokens += estimateMessageContent(content);
  }

  // Name field overhead
  if ('name' in message && message.name) {
    tokens += TOKENS_PER_NAME + estimateStringTokens(message.name);
  }

  // Tool call ID overhead
  if ('tool_call_id' in message && (message as any).tool_call_id) {
    tokens += estimateStringTokens((message as any).tool_call_id);
  }

  // Function call (deprecated) in assistant messages
  if ('function_call' in message && (message as any).function_call) {
    const fc = (message as any).function_call;
    if (fc) {
      tokens += estimateStringTokens(JSON.stringify(fc));
    }
  }

  // Tool calls in assistant messages
  if ('tool_calls' in message && (message as any).tool_calls) {
    tokens += estimateStringTokens(JSON.stringify((message as any).tool_calls));
  }

  return tokens;
}

/**
 * Estimate the number of tokens used by tool/function definitions.
 */
function estimateToolTokens(tools: ChatCompletionTool[]): number {
  let tokens = 0;
  for (const tool of tools) {
    // Account for separator tokens between tools
    tokens += 1;
    tokens += estimateStringTokens(JSON.stringify(tool));
  }
  return tokens;
}

/**
 * Find the context window size for a given model name.
 * Supports partial matching (e.g., "gpt-4o-2024-05-13" matches "gpt-4o" prefix).
 */
function getContextWindow(model?: string): number | undefined {
  if (!model) return undefined;

  // Exact match first
  if (model in MODEL_CONTEXT_WINDOWS) {
    return MODEL_CONTEXT_WINDOWS[model];
  }

  // Try prefix matching (longest first)
  const prefixes = Object.keys(MODEL_CONTEXT_WINDOWS).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) {
      return MODEL_CONTEXT_WINDOWS[prefix];
    }
  }

  return undefined;
}

export interface EstimateTokensParams {
  /**
   * The messages to estimate tokens for.
   */
  messages: Array<ChatCompletionMessageParam>;

  /**
   * The model ID. Used to look up the context window size.
   */
  model?: string;

  /**
   * Tool/function definitions included in the request.
   */
  tools?: Array<ChatCompletionTool>;

  /**
   * The maximum number of tokens the caller plans to request (max_completion_tokens).
   * If provided, the estimate will include this as an estimate of potential output tokens
   * alongside the input token count.
   */
  maxCompletionTokens?: number;
}

/**
 * Estimates the number of tokens that a chat completion request would consume,
 * without making an API call.
 *
 * The estimation is based on a character-counting heuristic (~3.5 characters
 * per token for English text) plus fixed per-message overhead. This provides
 * a useful approximation for cost estimation and context window management,
 * but may differ from the actual token count computed by the model's tokenizer.
 *
 * For precise token counts, use the `tiktoken` package or rely on the `usage`
 * field in the API response.
 *
 * @example
 * ```ts
 * const estimate = estimateTokens({
 *   messages: [{ role: 'user', content: 'Hello, how are you?' }],
 *   model: 'gpt-4o',
 * });
 * console.log(estimate.inputTokens);
 * // => ~12
 * console.log(estimate.maxOutputTokens);
 * // => ~127988
 * ```
 */
export function estimateTokens(params: EstimateTokensParams): TokenEstimate {
  const { messages, model, tools, maxCompletionTokens } = params;

  let inputTokens = BASE_OVERHEAD;

  // Sum tokens across all messages
  for (const message of messages) {
    inputTokens += estimateMessageTokens(message);
  }

  // Add tokens for tool/function definitions
  if (tools && tools.length > 0) {
    inputTokens += estimateToolTokens(tools);
  }

  const contextWindow = getContextWindow(model);
  const maxOutputTokens =
    contextWindow !== undefined ? Math.max(0, contextWindow - inputTokens) : undefined;

  const result: TokenEstimate = {
    inputTokens,
  };

  if (contextWindow !== undefined) {
    result.contextWindow = contextWindow;
  }

  if (maxOutputTokens !== undefined) {
    result.maxOutputTokens = maxOutputTokens;
  }

  return result;
}
