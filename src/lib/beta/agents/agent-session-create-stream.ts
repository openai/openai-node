import { Stream } from '../../../core/streaming';
import type { AgentSessionEvent } from '../../../resources/beta/agents/agents';
import type { AgentTurnResult } from './agent-turn-result';
import { ResultCollection } from './result-collection';

/** Beta: a creation event stream with optional collection of its initial root turn. */
export class AgentSessionCreateStream extends Stream<AgentSessionEvent> {
  readonly #collection: ResultCollection;

  constructor(stream: Stream<AgentSessionEvent>) {
    const collection = new ResultCollection(() => stream[Symbol.asyncIterator]());
    super(() => collection.iterate(), stream.controller);
    this.#collection = collection;
  }

  /** Drain this stream through the completed turn and idle event, then return its final messages. */
  finalResult(): Promise<AgentTurnResult> {
    return this.#collection.finalResult();
  }
}
