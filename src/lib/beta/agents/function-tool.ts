import { OpenAIError } from '../../../core/error';
import type { AgentToolHandler } from '../../agents/agent-session-stream';
import type { AutoParseableResponseTool } from '../../ResponsesParser';
import type { AgentToolParam } from '../../../resources/beta/agents/agents';
import { isInputContent } from './tool-output';
import { toolStages } from './tool-stages';
import type { StagedToolHandler } from './tool-stages';

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
 * Scalar results and business-data arrays become JSON text; `undefined` becomes
 * the text `undefined`. Supported text/image content arrays retain their format.
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
  const handler: StagedToolHandler = async (arguments_, setStage) => {
    setStage?.('arguments');
    const parsed = parse(JSON.stringify(arguments_));
    setStage?.('execution');
    const result: unknown = await execute(parsed);
    setStage?.('output');
    if (Array.isArray(result)) {
      return result.length > 0 && result.every(isInputContent) ? result : JSON.stringify(result);
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Existing schema-tool callbacks return arbitrary application values; adapt them to the Agents dispatcher's output contract.
    if (typeof result === 'object' || typeof result === 'string') {
      return result;
    }
    const text = result === undefined ? 'undefined' : JSON.stringify(result);
    if (text === undefined) {
      throw new OpenAIError('Tool output must be JSON serializable');
    }
    return text;
  };
  Object.defineProperty(handler, toolStages, { value: true });
  return {
    name: tool.name,
    definition: {
      type: 'function',
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters,
      ...(tool.defer_loading === undefined ? {} : { defer_loading: tool.defer_loading }),
    },
    handler,
  };
}
