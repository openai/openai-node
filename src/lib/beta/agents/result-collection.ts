import { OpenAIError } from '../../../core/error';
import type { AgentSessionEvent } from '../../../resources/beta/agents/agents';
import type { AgentTurnResult } from './agent-turn-result';
import { AgentTurnResultCollector } from './agent-turn-result-collector';
import { AgentTurnResultError } from './agent-turn-result-error';

/** Shares collection between a raw creation stream and the follow-up helper.
 * @internal
 */
export class ResultCollection {
  #iterator: AsyncGenerator<AgentSessionEvent, void> | undefined;
  #ended = false;
  #error: unknown;
  #result: Promise<AgentTurnResult> | undefined;
  readonly collector: AgentTurnResultCollector;

  readonly #source: () => AsyncIterator<AgentSessionEvent>;
  readonly #signal: AbortSignal | undefined;
  readonly #canHandle: (name: string) => boolean;

  constructor(
    source: () => AsyncIterator<AgentSessionEvent>,
    canHandle: (name: string) => boolean = () => false,
    sessionID?: string,
    signal?: AbortSignal,
  ) {
    this.#source = source;
    this.#signal = signal;
    this.#canHandle = canHandle;
    this.collector = new AgentTurnResultCollector(sessionID);
  }

  iterate(): AsyncIterator<AgentSessionEvent> {
    if (this.#iterator) {
      throw new OpenAIError('An agent result stream can only be consumed once');
    }
    return (this.#iterator = this.#observe());
  }

  async *#observe(): AsyncGenerator<AgentSessionEvent, void> {
    const iterator = this.#source();
    let done = false;
    try {
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- Pull the single-use stream sequentially.
        const next = await iterator.next();
        if (next.done) {
          done = true;
          return;
        }
        this.collector.accept(next.value);
        yield next.value;
      }
    } catch (error) {
      this.#error = error;
      throw error;
    } finally {
      this.#ended = true;
      if (!done) {
        await iterator.return?.();
      }
    }
  }

  finalResult(): Promise<AgentTurnResult> {
    return (this.#result ??= this.#collect());
  }

  async #collect(): Promise<AgentTurnResult> {
    try {
      const iterator = this.#iterator ?? this.iterate();
      while (!this.#ended && !this.collector.ready) {
        this.collector.checkAction(this.#canHandle);
        // oxlint-disable-next-line no-await-in-loop -- Each event can dispatch tools before the next pull.
        const next = await iterator.next();
        if (next.done) {
          break;
        }
      }
      if (this.#error !== undefined && !this.collector.ready) {
        throw this.#error;
      }
      if (!this.collector.ready && this.#signal?.aborted) {
        throw this.collector.error('observation', this.#signal.reason);
      }
      return this.collector.finish();
    } catch (error) {
      throw error instanceof AgentTurnResultError ? error : this.collector.error('observation', error);
    } finally {
      try {
        await this.#iterator?.return();
      } finally {
        this.collector.release();
      }
    }
  }
}
