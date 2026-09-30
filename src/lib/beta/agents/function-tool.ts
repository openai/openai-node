import { OpenAIError } from '../../../core/error';
import type { AgentToolHandler } from '../../agents/agent-session-stream';
import type { AutoParseableResponseTool } from '../../ResponsesParser';
import type { AgentToolParam } from '../../../resources/beta/agents/agents';

/** A beta Agents function definition paired with its local, validating handler. */
export interface AgentFunctionTool {
  /** Model-visible function name, also used as the key in `toolHandlers`. */
  readonly name: string;
  /** Hosted configuration for `agent.tools`; contains no local callback or parser. */
  readonly definition: AgentToolParam.AgentToolConfigParamFunction;
  /** Validates arguments before invoking the callback through the existing stream dispatcher. */
  readonly handler: AgentToolHandler;
}

/**
 * Adapts a `zodResponsesFunction` or `standardResponsesFunction` to beta Agents.
 * Pass `definition` to `agent.tools` and register `handler` under `name` in
 * `sessions.stream()`'s `toolHandlers`. Creating a definition does not execute it.
 * The existing dispatcher handles callback results, failures, and submission retries.
 *
 * @throws {OpenAIError} If the tool has no callback or argument schema.
 */
export function functionTool<Arguments>(
  tool: AutoParseableResponseTool<{ name: string; arguments: Arguments }>,
): AgentFunctionTool {
  const execute = tool.$callback;
  const parse = tool.$parseRaw;
  if (!execute || !tool.parameters) {
    throw new OpenAIError('Agents function tools require a callback and argument schema');
  }
  return {
    name: tool.name,
    definition: {
      type: 'function',
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters,
      ...(tool.defer_loading === undefined ? {} : { defer_loading: tool.defer_loading }),
    },
    handler: (arguments_) => execute(parse(JSON.stringify(arguments_))),
  };
}
