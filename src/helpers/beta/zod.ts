import type { infer as zodInfer, ZodType } from 'zod/v4';
import * as z from 'zod/v4';
import type { BetaRunnableChatCompletionFunctionTool, Promisable } from '../../lib/beta/BetaRunnableTool';
import type { ChatCompletionContentPart } from '../../resources';

/**
 * Creates a tool using the provided Zod schema that can be passed
 * into the `.toolRunner()` method. The Zod schema will automatically be
 * converted into JSON Schema when passed to the API. The provided function's
 * input arguments will also be validated against the provided schema.
 */
export function betaZodFunctionTool<InputSchema extends ZodType>(options: {
  name: string;
  parameters: InputSchema;
  description: string;
  run: (args: zodInfer<InputSchema>) => Promisable<string | ChatCompletionContentPart[]>;
}): BetaRunnableChatCompletionFunctionTool<zodInfer<InputSchema>> {
  const jsonSchema = z.toJSONSchema(options.parameters, { reused: 'ref' });

  return {
    type: 'function',
    function: {
      name: options.name,
      description: options.description,
      parameters: jsonSchema,
    },
    run: options.run,
    parse: (args: unknown) => options.parameters.parse(args),
  };
}
