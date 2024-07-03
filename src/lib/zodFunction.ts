import { ChatCompletionTool, FunctionDefinition, FunctionParameters } from 'openai/resources';
import type { ZodType } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

export type ZodFunctionOptions = Pick<FunctionDefinition, 'name' | 'description'> & {
  parameters: ZodType;
};

export function zodFunction({ name, description, parameters }: ZodFunctionOptions): ChatCompletionTool {
  // zodToJsonSchema is pretty smart
  // all properties are considered required unless specified with `.optional()`
  // additionalProperties is set to `false` by default

  return {
    // @ts-expect-error
    function: {
      name,
      description,
      parameters: zodToJsonSchema(parameters) as FunctionParameters,
      strict: true,
    },
    type: 'function',
  };
}
