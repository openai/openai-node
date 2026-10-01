import type { AgentOutputFormat } from './output-format-types';

import type { JSONSchema } from '../../jsonschema';

export type { AgentOutputFormat, AgentResult } from './output-format-types';

export { ParsedAgentTurnResult } from './parsed-agent-turn-result';
export { AgentOutputParseError } from './output-parse-error';

/** Beta: bind a JSON schema to its local output parser; the API validates schema support. */
export function agentOutputFormat<T>(schema: JSONSchema, parse: (text: string) => T): AgentOutputFormat<T> {
  // Keep spread-compatible parsing without exposing caller-owned serialization hooks.
  const parser = Object.defineProperty((text: string) => parse(text), 'toJSON', {
    value: () => {
      /* Parser metadata is omitted from JSON requests. */
    },
  });
  // SAFETY: The API schema type exposes JSON Schema keywords as a record; preserve the supplied schema unchanged.
  return { type: 'json_schema', schema: schema as AgentOutputFormat<T>['schema'], $parseRaw: parser };
}
