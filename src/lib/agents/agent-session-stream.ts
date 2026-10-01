import type { AgentOutputFormat, AgentResult } from '../beta/agents/output-format-types';
import { AttachedTurn } from '../beta/agents/attached-turn';
import { TurnState } from './turn-state';
import { agentFormatParser, parseAgentResultPromise } from '../beta/agents/parse-result';
import { ResultCollection } from '../beta/agents/result-collection';
import { APIUserAbortError, BadRequestError, OpenAIError } from '../../core/error';
import type { Stream } from '../../core/streaming';
import { buildHeaders } from '../../internal/headers';
import type { RequestOptions } from '../../internal/request-options';
import { uuid4 } from '../../internal/utils/uuid';
import { isObj } from '../../internal/utils/values';
import { isInputContent } from '../beta/agents/tool-output';
import type {
  AgentFunctionCallItem,
  AgentFunctionCallOutputParam,
  AgentSessionEvent,
  AgentSessionInputMessageParam,
  AgentSessionInputParam,
} from '../../resources/beta/agents/agents';
import type { Sessions } from '../../resources/beta/agents/sessions/sessions';

/** A function result; object results are serialized as JSON text. */
export type AgentToolOutput = AgentFunctionCallOutputParam | object | null;
/** Receives a detached JSON object and may return a result asynchronously. */
export type AgentToolHandler = (
  arguments_: Record<string, unknown>,
) => AgentToolOutput | PromiseLike<AgentToolOutput>;

/** Input or attachment with optional sequential tool handlers. */
export type AgentSessionStreamParams<T = never> = {
  /** Beta: parse this turn locally; does not change the existing session schema. */
  outputFormat?: AgentOutputFormat<T>;
  /** User messages, or text normalized to a single user message. Omit to reattach without submitting input. */
  input?: string | AgentSessionInputMessageParam[];
  /** Registered functions run after their call event is yielded; unknown functions remain manual. */
  toolHandlers?: Record<string, AgentToolHandler>;
  /** Key for the input submission only; request headers take precedence, case-insensitively. */
  idempotencyKey?: string;
} & ([T] extends [never] ? unknown : { outputFormat: AgentOutputFormat<T> });

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

async function cancelBody(response: Response | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The response may already be cancelled or owned by its stream reader.
  }
}

/**
 * A single-use, lazy async iterable of original session events for one turn.
 * With input, requires an idle session and a single input writer. Omitting input
 * reattaches to hosted work without submitting another message. Pending functions
 * replayed by the stream use the same handlers; result collection also recovers
 * saved output for the selected root turn.
 *
 * Tool handlers run sequentially during iteration. Handler failures submit a
 * generic error without exception text. Each submission has a distinct retry-safe
 * idempotency key. Breaking iteration or calling abort closes local requests;
 * neither cancels the backend turn. No work starts until iteration begins.
 */
export class AgentSessionStream<T = never> implements AsyncIterable<AgentSessionEvent> {
  /** Aborts local requests and iteration without cancelling the backend turn. */
  readonly controller = new AbortController();
  #consumed = false;
  #format: AgentOutputFormat<T> | undefined;
  #parsedResult: Promise<AgentResult<T>> | undefined;
  #collection: ResultCollection;
  #stream: Stream<AgentSessionEvent> | undefined;
  #response: Response | undefined;
  #reading = false;
  #sessions: Sessions;
  #sessionID: string;
  #input: AgentSessionInputParam.SessionInputParamAgentSessionInputMessage | undefined;
  #attachment: AttachedTurn | undefined;
  #settled = false;
  #handlers: Map<string, AgentToolHandler>;
  #inputKey: string | undefined;
  #options: RequestOptions;

  /** Creates an unstarted helper. Prefer client.beta.agents.sessions.stream(). */
  constructor(
    sessions: Sessions,
    sessionID: string,
    params: AgentSessionStreamParams<T> = {},
    options?: RequestOptions,
  ) {
    const input: AgentSessionInputMessageParam[] | undefined =
      typeof params.input === 'string'
        ? [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }]
        : params.input;
    if (params.input?.length === 0) {
      throw new OpenAIError('input must not be empty');
    }
    this.#format = agentFormatParser<T>(params.outputFormat);
    if (params.outputFormat && !this.#format) {
      throw new OpenAIError('outputFormat must have its own parser function');
    }
    this.#sessions = sessions;
    this.#sessionID = sessionID;
    this.#input = input === undefined ? undefined : { type: 'agent.session.input.message', input };
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
    this.#collection = new ResultCollection(
      () => this.#iterate(),
      (name) => this.#handlers.has(name),
      sessionID,
      this.controller.signal,
      () => this.#reconcile(),
    );
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
    return this.#collection.iterate();
  }

  /** Beta: opt into retaining completed final messages before iterating progress events. */
  withResultCollection(): this {
    this.#collection.enable();
    return this;
  }

  /** Beta: drain this turn, dispatch registered tools, and collect its final assistant messages. */
  finalResult(): Promise<AgentResult<T>> {
    return (this.#parsedResult ??= parseAgentResultPromise(this.#collection.finalResult(), this.#format));
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
      const stream = await this.#start(state, options);
      if (!stream) {
        return;
      }
      this.#reading = true;
      for await (const event of this.#events(stream)) {
        this.#checkAbort();
        if (!(await this.#observeAttachment(event, state))) {
          this.#settled = true;
          return;
        }
        if (!state.accept(event)) {
          continue;
        }
        const terminal =
          state.terminal(event) ||
          this.#attachment?.settled ||
          (this.#attachment !== undefined && event.type === 'agent.session.idle');
        const pendingCall = state.call(event);
        const handler = pendingCall && this.#handlers.get(pendingCall.name);
        // Freeze dispatch identity and arguments before exposing the original event.
        const call = pendingCall && handler ? structuredClone(pendingCall) : undefined;
        if (terminal) {
          this.#settled = true;
          stream.controller.abort();
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
    } finally {
      externalSignal?.removeEventListener('abort', abort);
      this.controller.signal.removeEventListener('abort', abort);
      await this.#closeObservation();
    }
  }

  async *#events(stream: Stream<AgentSessionEvent>): AsyncGenerator<AgentSessionEvent> {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        let next: IteratorResult<AgentSessionEvent>;
        try {
          // oxlint-disable-next-line no-await-in-loop -- Pull one SSE event at a time.
          next = await iterator.next();
          if (next.done) {
            throw new OpenAIError('Session event stream ended before the turn reached idle or failed');
          }
        } catch (error) {
          this.#checkAbort();
          // oxlint-disable-next-line no-await-in-loop -- One recovery read is allowed only after a failed SSE pull.
          const recovered = await this.#attachment?.recover(
            this.#collection.enabled ? this.#collection.collector : undefined,
          );
          if (recovered) {
            this.#settled = true;
            return;
          }
          throw error;
        }
        yield next.value;
      }
    } finally {
      await iterator.return?.();
    }
  }

  async #observeAttachment(event: AgentSessionEvent, state: TurnState): Promise<boolean> {
    if (!this.#attachment) {
      return true;
    }
    if (!(await this.#attachment.observe(event))) {
      return false;
    }
    state.select(this.#attachment.turn);
    if (this.#collection.enabled) {
      this.#attachment.snapshot(this.#collection.collector);
    }
    return true;
  }

  async #closeObservation(): Promise<void> {
    if (this.#settled && this.#attachment) {
      this.#stream?.controller.abort();
      if (!this.#reading) {
        await cancelBody(this.#response);
      }
    } else {
      this.abort();
    }
  }

  async #start(state: TurnState, options: RequestOptions): Promise<Stream<AgentSessionEvent> | undefined> {
    if (this.#input) {
      const session = await this.#sessions.retrieve(this.#sessionID, options);
      if (session.status !== 'idle') {
        throw new OpenAIError('sessions.stream with input requires an idle session; omit input to reattach');
      }
    } else {
      this.#attachment = new AttachedTurn(this.#sessions, this.#sessionID, options);
      await this.#attachment.prepare();
      state.select(this.#attachment.turn);
    }
    const subscription = await this.#sessions.events.stream(this.#sessionID, options).withResponse();
    this.#stream = subscription.data;
    this.#response = subscription.response;
    this.#checkAbort();
    if (this.#input) {
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
    } else if (this.#attachment) {
      const session = await this.#attachment.refresh();
      state.select(this.#attachment.turn);
      if (this.#collection.enabled) {
        this.#attachment.snapshot(this.#collection.collector, session);
        if (await this.#attachment.blockedManualAction(session)) {
          this.#collection.collector.checkAction(() => false);
        }
      }
      if (this.#attachment.settled || session.status === 'idle' || session.status === 'failed') {
        this.#settled = true;
        return undefined;
      }
    }
    this.#checkAbort();
    return this.#stream;
  }

  async #reconcile(): Promise<void> {
    if (!this.#attachment) {
      return;
    }
    const external = this.#options.signal;
    const abort = () => this.abort(external?.reason);
    external?.addEventListener('abort', abort, { once: true });
    try {
      if (external?.aborted) {
        abort();
      }
      this.#checkAbort();
      await this.#attachment.reconcile(this.#collection.collector);
    } finally {
      external?.removeEventListener('abort', abort);
    }
  }

  async #result(call: AgentFunctionCallItem, handler: AgentToolHandler): Promise<ToolResult> {
    try {
      const args: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      if (!isObj(args)) {
        throw new OpenAIError('Function arguments must be a JSON object');
      }
      // SAFETY: Arguments were parsed as JSON and checked to be a non-null non-array object before invoking the handler.
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

  async #wait<Value>(action: () => Value | PromiseLike<Value>): Promise<Value> {
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
