import type { AgentOutputFormat } from './output-format-types';

import { hasOwn } from '../../../internal/utils/values';
import { OpenAIError } from '../../../core/error';
import type { JSONSchema, JSONSchemaDefinition } from '../../jsonschema';
import { toStrictJsonSchema } from '../../transform';

export type { AgentOutputFormat, AgentResult } from './output-format-types';

export { ParsedAgentTurnResult } from './parsed-agent-turn-result';
export { AgentOutputParseError } from './output-parse-error';

const AGENT_FORMATS = new Set([
  '',
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
]);

function validateFormats(schema: JSONSchemaDefinition): void {
  if (schema === true || schema === false) {
    return;
  }
  if (hasOwn(schema, 'format') && schema.format !== undefined && !AGENT_FORMATS.has(schema.format)) {
    throw new OpenAIError(`Agents output schemas do not support string format ${schema.format}`);
  }
  for (const keyword of ['properties', '$defs', 'definitions'] as const) {
    if (hasOwn(schema, keyword)) {
      for (const child of Object.values(schema[keyword] ?? {})) {
        validateFormats(child);
      }
    }
  }
  for (const keyword of ['items', 'additionalProperties', 'allOf', 'anyOf', 'oneOf'] as const) {
    if (!hasOwn(schema, keyword)) {
      continue;
    }
    const child = schema[keyword];
    if (child === undefined) {
      continue;
    }
    if (Array.isArray(child)) {
      for (const entry of child) {
        validateFormats(entry);
      }
    } else {
      validateFormats(child);
    }
  }
}

/** Beta: normalize an object-root schema and bind its local output validator. */
export function agentOutputFormat<T>(schema: JSONSchema, parse: (text: string) => T): AgentOutputFormat<T> {
  const normalized = toStrictJsonSchema(schema);
  validateFormats(normalized);
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'enum', 'not']) {
    if (hasOwn(normalized, keyword)) {
      throw new OpenAIError(`Agents output schemas cannot contain top-level ${keyword}`);
    }
  }
  // Keep spread-compatible parsing without exposing caller-owned serialization hooks.
  const parser = Object.defineProperty((text: string) => parse(text), 'toJSON', {
    value: () => {
      /* Parser metadata is omitted from JSON requests. */
    },
  });
  // SAFETY: Strict normalization returns an object JSON Schema; the API schema type exposes its JSON keywords as a record.
  return { type: 'json_schema', schema: normalized as AgentOutputFormat<T>['schema'], $parseRaw: parser };
}
