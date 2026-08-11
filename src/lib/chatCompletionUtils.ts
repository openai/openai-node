import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from '../resources';

export const isAssistantMessage = (
  message: ChatCompletionMessageParam | null | undefined,
): message is ChatCompletionAssistantMessageParam => message?.role === 'assistant';

export const isToolMessage = (
  message: ChatCompletionMessageParam | null | undefined,
): message is ChatCompletionToolMessageParam => message?.role === 'tool';

export function isPresent<T>(obj: T | null | undefined): obj is T {
  return obj != null;
}
