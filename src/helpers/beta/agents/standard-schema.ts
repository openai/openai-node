import { standardTextFormat } from '../../standard-schema';
import type { JSONSchema } from '../../../lib/jsonschema';
import { agentOutputFormat } from '../../../lib/beta/agents/output-format';

/** Beta: bind a synchronous Standard Schema validator to Agents output. */
export function standardAgentTextFormat<S extends Parameters<typeof standardTextFormat>[0]>(
  schema: S,
  jsonSchema?: JSONSchema,
) {
  const format = standardTextFormat(schema, 'agent_output', { schema: jsonSchema });
  // SAFETY: The native Responses helper owns Standard Schema conversion and validation.
  return agentOutputFormat(format.schema as JSONSchema, format.$parseRaw);
}
