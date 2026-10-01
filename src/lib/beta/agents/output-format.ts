import type { AgentOutputFormat } from './output-format-types';

import { OpenAIError } from '../../../core/error';
import type { JSONSchema } from '../../jsonschema';
import { toStrictJsonSchema } from '../../transform';

export type { AgentOutputFormat, AgentResult } from './output-format-types';

export { ParsedAgentTurnResult } from './parsed-agent-turn-result';
export { AgentOutputParseError } from './output-parse-error';

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
