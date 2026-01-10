import type { ChatCompletionContentPart, ChatCompletionFunctionTool } from '../../resources';

export type Promisable<T> = T | Promise<T>;

// this type is just an extension of ChatCompletionFunctionTool with a run and parse method
// that will be called by `toolRunner()` helpers
export type BetaRunnableChatCompletionFunctionTool<Input = any> = ChatCompletionFunctionTool & {
  run: (args: Input) => Promisable<string | ChatCompletionContentPart[]>;
  parse: (content: unknown) => Input;
};
