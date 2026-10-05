import type { AgentOutputFormat, AgentResult } from '../beta/agents/output-format-types';
import { TurnState } from './turn-state';
import { AgentToolDispatcher } from '../beta/agents/tool-dispatcher';
import { agentFormatParser, parseAgentResultPromise } from '../beta/agents/parse-result';
import { ResultCollection } from '../beta/agents/result-collection';
import { APIUserAbortError, OpenAIError } from '../../core/error';
import type { Stream } from '../../core/streaming';
import { buildHeaders } from '../../internal/headers';
import type { RequestOptions } from '../../internal/request-options';
import { uuid4 } from '../../internal/utils/uuid';
import type { AgentToolError } from '../beta/agents/tool-error';
import type {
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

/** Input and optional sequential tool handlers for one turn on an idle session. */
export type AgentSessionStreamParams<T = never> = {
  /** Beta: parse this turn locally; does not change the existing session schema. */
  outputFormat?: AgentOutputFormat<T>;
  /** User messages, or text normalized to a single user message. Must not be empty. */
  input: string | AgentSessionInputMessageParam[];
  /** Registered functions run after their call event is yielded; unknown functions remain manual. */
  toolHandlers?: Record<string, AgentToolHandler>;
  /**
   * Beta: use alongside `toolHandlers` to log or monitor local argument validation,
   * handler execution, and output serialization failures. Does not observe API or
   * transport errors. Observer errors are ignored; model-visible errors remain sanitized.
   */
  onToolError?: (failure: AgentToolError) => void | PromiseLike<void>;
  /** Key for the input submission only; request headers take precedence, case-insensitively. */
  idempotencyKey?: string;
} & ([T] extends [never] ? unknown : { outputFormat: AgentOutputFormat<T> });

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
  #input: AgentSessionInputParam.SessionInputParamAgentSessionInputMessage;
  #dispatcher: AgentToolDispatcher;
  #inputKey: string | undefined;
  #options: RequestOptions;

  /** Creates an unstarted helper. Prefer client.beta.agents.sessions.stream(). */
  constructor(
    sessions: Sessions,
    sessionID: string,
    params: AgentSessionStreamParams<T>,
    options?: RequestOptions,
  ) {
    const input: AgentSessionInputMessageParam[] =
      typeof params.input === 'string'
        ? [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }]
        : params.input;
    if (params.input.length === 0) {
      throw new OpenAIError('input must not be empty');
    }
    this.#format = agentFormatParser<T>(params.outputFormat);
    if (params.outputFormat && !this.#format) {
      throw new OpenAIError('outputFormat must have its own parser function');
    }
    this.#sessions = sessions;
    this.#sessionID = sessionID;
    this.#input = { type: 'agent.session.input.message', input };
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
    this.#dispatcher = new AgentToolDispatcher(
      sessions,
      params.toolHandlers ?? {},
      this.controller,
      this.#options,
      params.onToolError,
    );
    this.#collection = new ResultCollection(
      () => this.#iterate(),
      (name) => this.#dispatcher.canHandle(name),
      sessionID,
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
          // Spread creates an own data property without invoking inherited setters or changing the object prototype.
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
        const dispatch = this.#dispatcher.prepare(state.call(event), this.#sessionID);
        if (terminal) {
          this.#stream.controller.abort();
        }
        yield event;
        if (terminal) {
          return;
        }
        this.#checkAbort();
        await dispatch?.();
      }
      this.#checkAbort();
      throw new OpenAIError('Session event stream ended before the turn reached idle or failed');
    } finally {
      externalSignal?.removeEventListener('abort', abort);
      this.controller.signal.removeEventListener('abort', abort);
      this.abort();
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
}
