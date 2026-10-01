import { OpenAIError } from '../../../core/error';
import type { JSONSchema } from '../../jsonschema';
import { toStrictJsonSchema } from '../../transform';
import type { AgentTurnResult } from './agent-turn-result';
import type { TextFormatParam } from '../../../resources/beta/agents/agents';
import type { ParsedAgentTurnResult } from './parsed-agent-turn-result';

export { ParsedAgentTurnResult } from './parsed-agent-turn-result';
export { AgentOutputParseError } from './output-parse-error';

/** Beta: an Agents JSON Schema format with a local output validator. */
export interface AgentOutputFormat<T> extends TextFormatParam.TextFormatParamJSONSchema {
  /** SDK-only parser; omitted from serialized requests. */
  $parseRaw: (text: string) => T;
}

/** Beta: normalize an object-root schema and bind its local output validator. */
export function agentOutputFormat<T>(schema: JSONSchema, parse: (text: string) => T): AgentOutputFormat<T> {
  const normalized = toStrictJsonSchema(schema);
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'enum', 'not']) {
    if (keyword in normalized) {
      throw new OpenAIError(`Agents output schemas cannot contain top-level ${keyword}`);
    }
  }
  // SAFETY: defineProperty installs the non-enumerable parser required by AgentOutputFormat.
  return Object.defineProperty({ type: 'json_schema' as const, schema: normalized }, '$parseRaw', {
    value: parse,
    enumerable: false,
  }) as AgentOutputFormat<T>;
}

/** Beta: raw results remain unchanged unless a typed format is supplied. */
export type AgentResult<T> = [T] extends [never] ? AgentTurnResult : ParsedAgentTurnResult<T>;
