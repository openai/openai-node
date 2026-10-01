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

/** Add beta result collection without replacing custom stream instances.
 * @internal
 */
export function withAgentTurnResult<T = never>(
  stream: Stream<AgentSessionEvent>,
  format?: AgentOutputFormat<T>,
): AgentSessionCreateStream<T> {
  let collection: ResultCollection;
  stream.__betaTransformIterator((source) => {
    collection = new ResultCollection(source, undefined, undefined, stream.controller.signal);
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
