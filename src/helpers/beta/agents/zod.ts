import { zodTextFormat } from '../../zod';
import type { JSONSchema } from '../../../lib/jsonschema';
import { agentOutputFormat } from '../../../lib/beta/agents/output-format';

/** Beta: bind a Zod v3/v4/Mini schema to an Agents text format and completed result. */
export function zodAgentTextFormat<S extends Parameters<typeof zodTextFormat>[0]>(schema: S) {
  const format = zodTextFormat(schema, 'agent_output');
  // SAFETY: The native Responses helper owns Zod schema conversion and validation.
  return agentOutputFormat(format.schema as JSONSchema, format.$parseRaw);
}
