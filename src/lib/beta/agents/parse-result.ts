import type { SessionCreateParams } from '../../../resources/beta/agents/sessions/sessions';
import type { AgentTurnResult } from './agent-turn-result';
import type { TextFormatParam } from '../../../resources/beta/agents/agents';
import type { AgentOutputFormat, AgentResult } from './output-format-types';
import { ParsedAgentTurnResult } from './parsed-agent-turn-result';
import { AgentOutputParseError } from './output-parse-error';

/** @internal */
export function parseAgentResult<T>(result: AgentTurnResult, format?: AgentOutputFormat<T>): AgentResult<T> {
  try {
    // SAFETY: Callers preserve the format's inferred T; absent formats use the default never/raw overload.
    return (
      format ? new ParsedAgentTurnResult(result, format.$parseRaw(result.output_text)) : result
    ) as AgentResult<T>;
  } catch {
    throw new AgentOutputParseError(result);
  }
}

/** @internal */
export function agentFormatParser(
  format: TextFormatParam | null | undefined,
): AgentOutputFormat<unknown> | undefined {
  if (format?.type !== 'json_schema') {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(format, '$parseRaw');
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only an own data-property function can opt a public API format into local parsing.
  if (descriptor && 'value' in descriptor && typeof descriptor.value === 'function') {
    // SAFETY: The own descriptor was checked for a callable parser; retain its receiver and never reread the property.
    const parse = descriptor.value as AgentOutputFormat<unknown>['$parseRaw'];
    return { type: 'json_schema', schema: format.schema, $parseRaw: (text) => parse.call(format, text) };
  }
  return undefined;
}

/** @internal */
export function captureAgentOutput(body: SessionCreateParams) {
  const { agent } = body;
  const text = agent?.text;
  const format = agentFormatParser(text?.format);
  if (!format) {
    return { body };
  }
  return {
    body: {
      ...body,
      agent: {
        ...agent,
        text: { ...text, format: { type: 'json_schema', schema: structuredClone(format.schema) } },
      },
    },
    format,
  };
}

/** @internal */
export async function parseAgentResultPromise<T>(
  result: Promise<AgentTurnResult>,
  format?: AgentOutputFormat<T>,
): Promise<AgentResult<T>> {
  return parseAgentResult(await result, format);
}
