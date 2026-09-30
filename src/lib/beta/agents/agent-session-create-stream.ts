import type { Stream } from '../../../core/streaming';
import type { AgentSessionEvent } from '../../../resources/beta/agents/agents';
import type { AgentTurnResult } from './agent-turn-result';
import { ResultCollection } from './result-collection';

/** Beta: the original creation stream with optional collection of its initial root turn. */
export type AgentSessionCreateStream = Stream<AgentSessionEvent> & {
  /** Drain through the selected turn's completion and idle event, then return its final messages. */
  finalResult: () => Promise<AgentTurnResult>;
  /** Opt into retaining completed final messages before iterating progress events. */
  withResultCollection: () => AgentSessionCreateStream;
};

/** Add beta result collection without replacing custom stream instances.
 * @internal
 */
export function withAgentTurnResult(stream: Stream<AgentSessionEvent>): AgentSessionCreateStream {
  let collection: ResultCollection;
  stream.__betaTransformIterator((source) => {
    collection = new ResultCollection(source, undefined, undefined, stream.controller.signal);
    return () => collection.iterate();
  });
  const result: AgentSessionCreateStream = Object.assign(stream, {
    finalResult: () => collection.finalResult(),
    withResultCollection: (): AgentSessionCreateStream => {
      collection.enable();
      return result;
    },
  });
  return result;
}
