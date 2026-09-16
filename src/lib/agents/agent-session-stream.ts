import { TurnState } from './turn-state';
import { APIUserAbortError, BadRequestError, OpenAIError } from '../../core/error';
import type { Stream } from '../../core/streaming';
import { buildHeaders } from '../../internal/headers';
import type { RequestOptions } from '../../internal/request-options';
import { uuid4 } from '../../internal/utils/uuid';
import { hasOwn, isObj } from '../../internal/utils/values';
import type {
  AgentFunctionCallItem,
  AgentFunctionCallOutputParam,
  AgentSessionEvent,
  AgentSessionInputMessageParam,
  AgentSessionInputParam,
  InputContentParam,
} from '../../resources/beta/agents/agents';
import type { Sessions } from '../../resources/beta/agents/sessions/sessions';

/** A function result; object results are serialized as JSON text. */
export type AgentToolOutput = AgentFunctionCallOutputParam | object | null;
/** Receives a detached JSON object and may return a result asynchronously. */
export type AgentToolHandler = (
  arguments_: Record<string, unknown>,
) => AgentToolOutput | PromiseLike<AgentToolOutput>;

/** Input and optional sequential tool handlers for one turn on an idle session. */
export interface AgentSessionStreamParams {
  /** User messages, or text normalized to a single user message. Must not be empty. */
  input: string | AgentSessionInputMessageParam[];
  /** Registered functions run after their call event is yielded; unknown functions remain manual. */
  toolHandlers?: Record<string, AgentToolHandler>;
  /** Key for the input submission only; request headers take precedence, case-insensitively. */
  idempotencyKey?: string;
}

type ToolResult = AgentSessionInputParam.SessionInputParamAgentSessionInputToolResult;

function isInputContent(value: unknown): value is InputContentParam {
  if (!isObj(value)) {
    return false;
  }
  const content = value;
  let field: string;
  if (content['type'] === 'input_text') {
    field = 'text';
  } else if (content['type'] === 'input_image') {
    field = 'image_url';
  } else {
    return false;
  }
  return hasOwn(content, 'type') && hasOwn(content, field) && typeof content[field] === 'string';
}

function normalizedOutput(value: unknown): AgentFunctionCallOutputParam | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || (Array.isArray(value) && value.every(isInputContent))) {
    return value;
  }
  throw new OpenAIError('Tool output must be text, content, a JSON object, or null');
}

function toolResult(call: AgentFunctionCallItem, value: AgentToolOutput): ToolResult {
  const output =
    value !== null && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value;
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

async function cancelBody(response: Response | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The response may already be cancelled or owned by its stream reader.
  }
}

/**
 * A single-use, lazy async iterable of original session events for one turn.
 * Requires an idle session and a single input writer: the input endpoint does not
 * return a turn ID. Subscribe-before-input avoids losing events; the first
 * coordinator turn selects the turn to follow. Initial idle events and subagent
 * completion do not end iteration. A selected turn's terminal event followed by
 * session.idle, or session.failed, ends iteration. Unexpected EOF throws.
 *
 * Tool handlers run sequentially during iteration. Handler failures submit a
 * generic error without exception text. Each submission has a distinct retry-safe
 * idempotency key. Breaking iteration or calling abort closes local requests;
 * neither cancels the backend turn. No work starts until iteration begins.
 */
export class AgentSessionStream implements AsyncIterable<AgentSessionEvent> {
  /** Aborts local requests and iteration without cancelling the backend turn. */
  readonly controller = new AbortController();
  #consumed = false;
  #stream: Stream<AgentSessionEvent> | undefined;
  #response: Response | undefined;
  #reading = false;
  #sessions: Sessions;
  #sessionID: string;
  #input: AgentSessionInputParam.SessionInputParamAgentSessionInputMessage;
  #handlers: Map<string, AgentToolHandler>;
  #inputKey: string | undefined;
  #options: RequestOptions;

  /** Creates an unstarted helper. Prefer client.beta.agents.sessions.stream(). */
  constructor(
    sessions: Sessions,
    sessionID: string,
    params: AgentSessionStreamParams,
    options?: RequestOptions,
  ) {
    const input: AgentSessionInputMessageParam[] =
      typeof params.input === 'string'
        ? [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }]
        : params.input;
    if (params.input.length === 0) {
      throw new OpenAIError('input must not be empty');
    }
    this.#sessions = sessions;
    this.#sessionID = sessionID;
    this.#input = { type: 'agent.session.input.message', input };
    this.#handlers = new Map(Object.entries(params.toolHandlers ?? {}));
    const headers = buildHeaders([options?.headers]);
    this.#inputKey = headers.nulls.has('idempotency-key')
      ? undefined
      : (headers.values.get('idempotency-key') ??
        params.idempotencyKey ??
        options?.idempotencyKey ??
        uuid4());
    headers.values.delete('idempotency-key');
    headers.nulls.delete('idempotency-key');
    const { idempotencyKey: _key, ...rest } = options ?? {};
    this.#options = { ...rest, headers };
  }

  /** Closes local requests without cancelling the turn; an optional reason becomes the abort error's cause. */
  abort(reason?: unknown): void {
    this.controller.abort(reason);
    this.#stream?.controller.abort(this.controller.signal.reason);
    if (!this.#reading) {
      void cancelBody(this.#response);
    }
  }

  /** Starts iteration once; use for await to ensure early exits close the connection. */
  [Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
    if (this.#consumed) {
      throw new OpenAIError('An AgentSessionStream can only be consumed once');
    }
    this.#consumed = true;
    return this.#iterate();
  }

  async *#iterate(): AsyncGenerator<AgentSessionEvent> {
    const externalSignal = this.#options.signal;
    const abort = () =>
      this.abort(externalSignal?.aborted ? externalSignal.reason : this.controller.signal.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    this.controller.signal.addEventListener('abort', abort, { once: true });
    const options = { ...this.#options, signal: this.controller.signal };
    const state = new TurnState();
    try {
      if (externalSignal?.aborted) {
        this.abort(externalSignal.reason);
      }
      this.#checkAbort();
      const session = await this.#sessions.retrieve(this.#sessionID, options);
      if (session.status !== 'idle') {
        throw new OpenAIError(
          'sessions.stream requires an idle session; use sessions.events.stream for active sessions',
        );
      }
      const subscription = await this.#sessions.events.stream(this.#sessionID, options).withResponse();
      this.#stream = subscription.data;
      this.#response = subscription.response;
      this.#checkAbort();
      await this.#sessions.events.create(
        this.#sessionID,
        {
          events: [this.#input],
          ...(this.#inputKey === undefined ? {} : { 'Idempotency-Key': this.#inputKey }),
        },
        {
          ...options,
          headers: buildHeaders([options.headers, { 'Idempotency-Key': this.#inputKey ?? null }]),
        },
      );
      this.#checkAbort();
      this.#reading = true;
      for await (const event of this.#stream) {
        this.#checkAbort();
        if (!state.accept(event)) {
          continue;
        }
        const terminal = state.terminal(event);
        const pendingCall = state.call(event);
        const handler = pendingCall && this.#handlers.get(pendingCall.name);
        // Freeze dispatch identity and arguments before exposing the original event.
        const call = pendingCall && handler ? structuredClone(pendingCall) : undefined;
        if (terminal) {
          this.#stream.controller.abort();
        }
        yield event;
        if (terminal) {
          return;
        }
        this.#checkAbort();
        if (!call || !handler) {
          continue;
        }
        const result = await this.#result(call, handler);
        this.#checkAbort();
        await this.#submit(result, options);
      }
      this.#checkAbort();
      throw new OpenAIError('Session event stream ended before the turn reached idle or failed');
    } finally {
      externalSignal?.removeEventListener('abort', abort);
      this.controller.signal.removeEventListener('abort', abort);
      this.abort();
    }
  }

  async #result(call: AgentFunctionCallItem, handler: AgentToolHandler): Promise<ToolResult> {
    try {
      const args: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new OpenAIError('Function arguments must be a JSON object');
      }
      return toolResult(call, await this.#wait(() => handler(args as Record<string, unknown>)));
    } catch {
      this.#checkAbort();
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
    if (this.controller.signal.aborted) {
      throw this.#abortError();
    }
  }

  #abortError(): APIUserAbortError {
    const error = new APIUserAbortError();
    Object.defineProperty(error, 'cause', {
      value: this.controller.signal.reason,
      writable: true,
      configurable: true,
    });
    return error;
  }

  async #wait<T>(action: () => T | PromiseLike<T>): Promise<T> {
    let onAbort: (() => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Bridge the caller's AbortSignal while a handler or registration delay is pending.
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(this.#abortError());
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      this.#checkAbort();
      // Capture synchronous throws before racing cancellation, so both promises
      // always have rejection handlers even if the callback aborts and throws.
      const invoke = async () => await action();
      return await Promise.race([invoke(), aborted]);
    } finally {
      if (onAbort) {
        this.controller.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  async #submit(result: ToolResult, options: RequestOptions, key = uuid4(), attempt = 0): Promise<void> {
    this.#checkAbort();
    try {
      await this.#sessions.events.create(
        this.#sessionID,
        { events: [result], 'Idempotency-Key': key },
        options,
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
      await this.#submit(result, options, key, attempt + 1);
    }
  }
}
