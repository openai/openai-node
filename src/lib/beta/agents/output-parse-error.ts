import { OpenAIError } from '../../../core/error';
import type { AgentTurnResult } from './agent-turn-result';

/** Beta: hosted execution completed, but local output parsing failed. */
export class AgentOutputParseError extends OpenAIError {
  override name = 'AgentOutputParseError';
  readonly raw_result: AgentTurnResult;
  readonly cause: unknown;
  constructor(result: AgentTurnResult, cause: unknown) {
    super('The completed agent output could not be parsed');
    this.raw_result = result;
    this.cause = cause;
  }
}
