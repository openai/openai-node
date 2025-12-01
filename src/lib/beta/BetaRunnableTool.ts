import { FunctionTool } from '../../resources/beta';
import type { ChatCompletionTool } from '../../resources';

export type Promisable<T> = T | Promise<T>;

// this type is just an extension of BetaTool with a run and parse method
// that will be called by `toolRunner()` helpers
export type BetaRunnableTool<Input = any> = ChatCompletionTool & {
  run: (args: Input) => Promisable<string | Array<FunctionTool>>;
  parse: (content: unknown) => Input;
};
