import { AgentTurnResult } from './agent-turn-result';

/** Beta: a completed hosted turn whose output passed the local parser. */
export class ParsedAgentTurnResult<T> extends AgentTurnResult {
  readonly output_parsed: T;
  readonly raw_result: AgentTurnResult;
  constructor(result: AgentTurnResult, parsed: T) {
    super(result.turn, result.messages);
    this.raw_result = result;
    this.output_parsed = parsed;
  }
}
