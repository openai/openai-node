import type { infer as zodInfer, ZodType } from 'zod/v4';
import * as z from 'zod/v4';
import type { BetaRunnableTool, Promisable } from '../../lib/beta/BetaRunnableTool';
import type { FunctionTool } from '../../resources/beta';

/**
 * Creates a tool using the provided Zod schema that can be passed
 * into the `.toolRunner()` method. The Zod schema will automatically be
 * converted into JSON Schema when passed to the API. The provided function's
 * input arguments will also be validated against the provided schema.
 */
export function betaZodTool<InputSchema extends ZodType>(options: {
  name: string;
  parameters: InputSchema;
  description: string;
  run: (args: zodInfer<InputSchema>) => Promisable<string | Array<FunctionTool>>; // TODO: I changed this but double check
}): BetaRunnableTool<zodInfer<InputSchema>> {
  const jsonSchema = z.toJSONSchema(options.parameters, { reused: 'ref' });

  if (jsonSchema.type !== 'object') {
    throw new Error(`Zod schema for tool "${options.name}" must be an object, but got ${jsonSchema.type}`);
  }

  // TypeScript doesn't narrow the type after the runtime check, so we need to assert it
  const objectSchema = jsonSchema as typeof jsonSchema & { type: 'object' };

  return {
    type: 'function',
    function: {
      name: options.name,
      description: options.description,
      parameters: {
        type: 'object',
        properties: objectSchema.properties,
      },
    },
    run: options.run,
    parse: (args: unknown) => options.parameters.parse(args),
  };
}
