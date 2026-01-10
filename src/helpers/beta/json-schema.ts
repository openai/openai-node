import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import type { BetaRunnableChatCompletionFunctionTool, Promisable } from '../../lib/beta/BetaRunnableTool';
import type { FunctionTool } from '../../resources/beta';

type NoInfer<T> = T extends infer R ? R : never;

/**
 * Creates a Tool with a provided JSON schema that can be passed
 * to the `.toolRunner()` method. The schema is used to automatically validate
 * the input arguments for the tool.
 */
export function betaFunctionTool<
  const Schema extends Exclude<JSONSchema, boolean> & { type: 'object' },
>(options: {
  name: string;
  parameters: Schema;
  description: string;
  run: (args: NoInfer<FromSchema<Schema>>) => Promisable<string | Array<FunctionTool>>;
}): BetaRunnableChatCompletionFunctionTool<NoInfer<FromSchema<Schema>>> {
  return {
    type: 'function',
    function: {
      name: options.name,
      parameters: options.parameters,
      description: options.description,
    },
    run: options.run,
    parse: (content: unknown) => content as FromSchema<Schema>,
  } as any; // For some reason this causes infinite inference so we cast to any to not crash lsp
}
