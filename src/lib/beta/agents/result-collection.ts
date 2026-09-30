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
  #enabled = false;
  #uncollectedEvents = false;
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

  enable(): void {
    if (!this.#enabled && this.#uncollectedEvents) {
      throw new OpenAIError(
        'Call withResultCollection() before consuming events, or call finalResult() on a fresh stream.',
      );
    }
    this.#enabled = true;
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
        if (this.#enabled) {
          this.collector.accept(next.value);
        } else {
          this.#uncollectedEvents = true;
        }
        yield next.value;
      }
    } catch (error) {
      if (this.#enabled) {
        this.#error = error;
      }
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
    this.enable();
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
