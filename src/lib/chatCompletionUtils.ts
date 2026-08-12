import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from '../resources';

/** Returns whether a conversation message was produced by the assistant. */
export const isAssistantMessage = (
  message: ChatCompletionMessageParam | null | undefined,
): message is ChatCompletionAssistantMessageParam => message?.role === 'assistant';

/** Returns whether a conversation message contains the result of a tool call. */
export const isToolMessage = (
  message: ChatCompletionMessageParam | null | undefined,
): message is ChatCompletionToolMessageParam => message?.role === 'tool';

/** Narrows a value by excluding both `null` and `undefined`. */
export function isPresent<T>(obj: T | null | undefined): obj is T {
  return obj != null;
}
