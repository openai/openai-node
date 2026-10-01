import { OpenAIError } from '../../../core/error';
import type { AgentTurnResult } from './agent-turn-result';

/** Beta: hosted execution completed, but local output parsing failed. */
export class AgentOutputParseError extends OpenAIError {
  override name = 'AgentOutputParseError';
  readonly #rawResult: AgentTurnResult;
  constructor(result: AgentTurnResult) {
    super('The completed agent output could not be parsed');
    this.#rawResult = result;
  }
  /** Inspect the completed output explicitly; ordinary error logging omits it. */
  get raw_result(): AgentTurnResult {
    return this.#rawResult;
  }
}
