import { APIUserAbortError, OpenAIError } from '../../../core/error';
import { buildHeaders } from '../../../internal/headers';
import type { RequestOptions } from '../../../internal/request-options';
import type { Sessions, SessionCreateParams } from '../../../resources/beta/agents/sessions/sessions';
import type { AgentToolHandler } from '../../agents/agent-session-stream';
import { TurnState } from '../../agents/turn-state';
import { AgentToolDispatcher } from './tool-dispatcher';
import type { AgentOutputFormat, AgentResult } from './output-format-types';
import type { Stream } from '../../../core/streaming';
import type { AgentSessionEvent } from '../../../resources/beta/agents/agents';
import { parseAgentResultPromise } from './parse-result';
import { ResultCollection } from './result-collection';

/** Beta: the original creation stream with optional collection of its initial root turn. */
export type AgentSessionCreateStream<T = never> = Stream<AgentSessionEvent> & {
  /** Drain through the selected turn's completion and idle event, then return its final messages. */
  finalResult: () => Promise<AgentResult<T>>;
  /** Opt into retaining completed final messages before iterating progress events. */
  withResultCollection: () => AgentSessionCreateStream<T>;
};

async function* dispatchCreationTools(
  source: () => AsyncIterator<AgentSessionEvent>,
  dispatcher: AgentToolDispatcher,
  signal: AbortSignal,
): AsyncGenerator<AgentSessionEvent> {
  const state = new TurnState();
  let sessionID: string | undefined;
  for await (const event of { [Symbol.asyncIterator]: source }) {
    if (event.type === 'agent.session.created') {
      sessionID ??= event.session.id;
    }
    const dispatch = state.accept(event) ? dispatcher.prepare(state.call(event), sessionID) : undefined;
    yield event;
    if (signal.aborted) {
      return;
    }
    try {
      await dispatch?.();
    } catch (error) {
      if (signal.aborted && error instanceof APIUserAbortError) {
        return;
      }
      throw error;
    }
  }
}

/** Add beta result collection without replacing custom stream instances.
 * @internal
 */
export function withAgentTurnResult<T = never>(
  stream: Stream<AgentSessionEvent>,
  format?: AgentOutputFormat<T>,
  tools?: {
    sessions: Sessions;
    handlers: Record<string, AgentToolHandler>;
    options?: RequestOptions | undefined;
  },
): AgentSessionCreateStream<T> {
  let collection: ResultCollection;
  stream.__betaTransformIterator((source) => {
    // A tool result has its own POST endpoint, independent of creation overrides.
    const { path: _path, method: _method, stream: _stream, ...options } = tools?.options ?? {};
    const dispatcher =
      tools && new AgentToolDispatcher(tools.sessions, tools.handlers, stream.controller, options);
    collection = new ResultCollection(
      dispatcher ? () => dispatchCreationTools(source, dispatcher, stream.controller.signal) : source,
      dispatcher ? (name) => dispatcher.canHandle(name) : undefined,
      undefined,
      stream.controller.signal,
    );
    return () => collection.iterate();
  });
  let parsed: Promise<AgentResult<T>> | undefined;
  const result: AgentSessionCreateStream<T> = Object.assign(stream, {
    finalResult: () => (parsed ??= parseAgentResultPromise(collection.finalResult(), format)),
    withResultCollection: (): AgentSessionCreateStream<T> => {
      collection.enable();
      return result;
    },
  });
  return result;
}

/** Remove local callbacks without changing ordinary creation requests. @internal */
export function captureCreationTools(body: SessionCreateParams, options?: RequestOptions) {
  const descriptor = Object.getOwnPropertyDescriptor(body, 'toolHandlers');
  if (!descriptor) {
    return { body, options };
  }
  const handlers = body.toolHandlers;
  if (handlers === undefined && 'value' in descriptor) {
    return { body, options };
  }
  const descriptors = Object.getOwnPropertyDescriptors(body);
  delete descriptors.toolHandlers;
  const capturedOptions = { ...options };
  if ('toJSON' in body || capturedOptions.body !== undefined) {
    throw new OpenAIError('Creation tool handlers cannot customize request body serialization');
  }
  if (handlers === undefined) {
    // SAFETY: Preserve request fields while removing the accessor so serialization cannot evaluate it again.
    return {
      body: Object.create(Object.getPrototypeOf(body), descriptors) as SessionCreateParams,
      options: capturedOptions,
    };
  }
  const { stream } = body;
  if (stream !== true) {
    throw new OpenAIError('toolHandlers requires stream: true');
  }
  capturedOptions.headers = buildHeaders([capturedOptions.headers]);
  descriptors.stream = { value: stream, enumerable: true, configurable: true, writable: true };
  // SAFETY: Preserve request fields, omitting callbacks and fixing the validated streaming mode.
  const request = Object.create(Object.getPrototypeOf(body), descriptors) as SessionCreateParams;
  return {
    body: request,
    options: capturedOptions,
    handlers: handlers && Object.fromEntries(Object.entries(handlers)),
  };
}
