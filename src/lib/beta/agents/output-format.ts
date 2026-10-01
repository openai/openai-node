import type { AgentOutputFormat } from './output-format-types';

import { hasOwn } from '../../../internal/utils/values';
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
    if (hasOwn(normalized, keyword)) {
      throw new OpenAIError(`Agents output schemas cannot contain top-level ${keyword}`);
    }
  }
  // Functions survive object spread but are omitted by JSON serialization.
  // SAFETY: Strict normalization returns an object JSON Schema; the API schema type exposes its JSON keywords as a record.
  return { type: 'json_schema', schema: normalized as AgentOutputFormat<T>['schema'], $parseRaw: parse };
}
