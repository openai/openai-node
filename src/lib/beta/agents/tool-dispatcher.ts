import { APIUserAbortError, BadRequestError, OpenAIError } from '../../../core/error';
import { buildHeaders } from '../../../internal/headers';
import type { RequestOptions } from '../../../internal/request-options';
import { uuid4 } from '../../../internal/utils/uuid';
import { isObj } from '../../../internal/utils/values';
import { isInputContent } from './tool-output';
import type { AgentToolError } from './tool-error';
import { toolStages } from './tool-stages';
import type { StagedToolHandler } from './tool-stages';
import type {
  AgentToolHandler,
  AgentToolOutput,
  AgentSessionStreamParams,
} from '../../agents/agent-session-stream';
import type {
  AgentFunctionCallItem,
  AgentFunctionCallOutputParam,
  AgentSessionInputParam,
} from '../../../resources/beta/agents/agents';
import type { Sessions } from '../../../resources/beta/agents/sessions/sessions';

type ToolResult = AgentSessionInputParam.SessionInputParamAgentSessionInputToolResult;

function normalizedOutput(value: unknown): AgentFunctionCallOutputParam | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || (Array.isArray(value) && value.every(isInputContent))) {
    return value;
  }
  throw new OpenAIError('Tool output must be text, content, a JSON object, or null');
}

// oxlint-disable-next-line anti-slop/no-object-parameters -- The public AgentToolOutput contract accepts arbitrary JSON-serializable object results.
function toolResult(call: AgentFunctionCallItem, value: AgentToolOutput): ToolResult {
  const output = isObj(value) ? JSON.stringify(value) : value;
  // Detect unserializable callback results inside the redacted failure boundary.
  const serialized = JSON.stringify(output);
  if (serialized === undefined) {
    throw new OpenAIError('Tool output must be JSON serializable');
  }
  return {
    type: 'agent.session.input.tool_result',
    turn_id: call.turn_id,
    call_id: call.call_id,
    success: true,
    output: normalizedOutput(typeof output === 'string' ? output : JSON.parse(serialized)),
  };
}

/** Shared local function dispatch for creation and follow-up streams. @internal */
export class AgentToolDispatcher {
  readonly #handlers: Map<string, AgentToolHandler>;
  readonly #options: RequestOptions;
  readonly #sessions: Sessions;
  readonly #controller: AbortController;
  readonly #onToolError: AgentSessionStreamParams['onToolError'];

  constructor(
    sessions: Sessions,
    handlers: Record<string, AgentToolHandler>,
    controller: AbortController,
    options?: RequestOptions,
    onToolError?: AgentSessionStreamParams['onToolError'],
  ) {
    this.#sessions = sessions;
    this.#controller = controller;
    this.#onToolError = onToolError;
    this.#handlers = new Map(Object.entries(handlers));
    const headers = buildHeaders([options?.headers]);
    headers.values.delete('idempotency-key');
    headers.nulls.delete('idempotency-key');
    const { idempotencyKey: _key, ...rest } = options ?? {};
    this.#options = { ...rest, headers, signal: controller.signal };
  }

  canHandle(name: string): boolean {
    return typeof this.#handlers.get(name) === 'function';
  }

  /** Capture routing and arguments before the caller can mutate the yielded event. */
  prepare(
    call: AgentFunctionCallItem | undefined,
    sessionID: string | undefined,
  ): (() => Promise<void>) | undefined {
    const handler = call && this.#handlers.get(call.name);
    if (!call || typeof handler !== 'function') {
      return;
    }
    if (!sessionID) {
      throw new OpenAIError('Tool call received before the session creation event');
    }
    const snapshot = structuredClone(call);
    return async () => {
      this.#checkAbort();
      const result = await this.#result(snapshot, handler, sessionID);
      this.#checkAbort();
      await this.#submit(sessionID, result);
    };
  }

  async #result(
    call: AgentFunctionCallItem,
    handler: StagedToolHandler,
    sessionID: string,
  ): Promise<ToolResult> {
    let stage: AgentToolError['stage'] = 'arguments';
    try {
      const args: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      if (!isObj(args)) {
        throw new OpenAIError('Function arguments must be a JSON object');
      }
      stage = 'execution';
      // SAFETY: Arguments were parsed as JSON and checked to be a non-null non-array object before invoking the handler.
      const arguments_ = args as Record<string, unknown>;
      const output = await this.#wait(() =>
        this.#onToolError && handler[toolStages]
          ? handler(arguments_, (value) => {
              stage = value;
            })
          : handler(arguments_),
      );
      stage = 'output';
      return toolResult(call, output);
    } catch (error) {
      this.#checkAbort();
      if (this.#onToolError) {
        const failure: AgentToolError = Object.freeze({
          error,
          stage,
          tool_name: call.name,
          session_id: sessionID,
          turn_id: call.turn_id,
          call_id: call.call_id,
        });
        try {
          await this.#wait(() => this.#onToolError?.(failure));
        } catch {
          // Observers must not prevent the original sanitized tool failure from being submitted.
          this.#checkAbort();
        }
      }
      return {
        type: 'agent.session.input.tool_result',
        turn_id: call.turn_id,
        call_id: call.call_id,
        success: false,
        error: 'Tool handler failed.',
      };
    }
  }

  #checkAbort(): void {
    if (this.#controller.signal.aborted) {
      throw this.#abortError();
    }
  }

  #abortError(): APIUserAbortError {
    const error = new APIUserAbortError();
    Object.defineProperty(error, 'cause', {
      value: this.#controller.signal.reason,
      writable: true,
      configurable: true,
    });
    return error;
  }

  async #wait<Value>(action: () => Value | PromiseLike<Value>): Promise<Value> {
    let onAbort: (() => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Bridge the caller's AbortSignal while a handler or registration delay is pending.
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(this.#abortError());
      this.#controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      this.#checkAbort();
      // Capture synchronous throws before racing cancellation, so both promises
      // always have rejection handlers even if the callback aborts and throws.
      const invoke = async () => await action();
      return await Promise.race([invoke(), aborted]);
    } finally {
      if (onAbort) {
        this.#controller.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  async #submit(sessionID: string, result: ToolResult, key = uuid4(), attempt = 0): Promise<void> {
    this.#checkAbort();
    try {
      await this.#sessions.events.create(
        sessionID,
        { events: [result], 'Idempotency-Key': key },
        this.#options,
      );
    } catch (error) {
      const delay = [100, 300, 600][attempt];
      if (
        delay === undefined ||
        !(error instanceof BadRequestError) ||
        error.code !== 'invalid_request_error' ||
        !error.error ||
        !('message' in error.error) ||
        error.error.message !== `Unknown pending tool call: ${result.call_id}`
      ) {
        throw error;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.#wait(
          () =>
            // oxlint-disable-next-line promise/avoid-new -- Own the registration timer so cancellation clears it promptly.
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, delay);
            }),
        );
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
      await this.#submit(sessionID, result, key, attempt + 1);
    }
  }
}
