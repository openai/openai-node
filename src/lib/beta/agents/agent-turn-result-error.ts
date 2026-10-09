import { OpenAIError } from '../../../core/error';
import type { AgentSession, AgentSessionAssistantMessage } from '../../../resources/beta/agents/agents';
import type { Turn } from '../../../resources/beta/agents/sessions/turns';

/** Beta: final collection failed; partial state is evidence, not a successful result. */
export class AgentTurnResultError extends OpenAIError {
  override name = 'AgentTurnResultError';
  readonly reason: 'failed' | 'cancelled' | 'requires_action' | 'observation';
  readonly session_id: string | undefined;
  readonly turn: Turn | undefined;
  readonly messages: AgentSessionAssistantMessage[];
  readonly required_actions: AgentSession['required_actions'];
  readonly cause: unknown;
  constructor(
    reason: 'failed' | 'cancelled' | 'requires_action' | 'observation',
    session_id: string | undefined,
    turn: Turn | undefined,
    messages: AgentSessionAssistantMessage[],
    required_actions: AgentSession['required_actions'] = [],
    cause?: unknown,
  ) {
    super(`Could not collect the agent turn result: ${reason}`);
    this.reason = reason;
    this.session_id = session_id;
    this.turn = turn;
    this.messages = messages;
    this.required_actions = required_actions;
    this.cause = cause;
  }
  get turn_id(): string | undefined {
    return this.turn?.id;
  }
}
