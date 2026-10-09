import type { AgentSessionAssistantMessage } from '../../../resources/beta/agents/agents';
import type { Turn } from '../../../resources/beta/agents/sessions/turns';
import { outputText } from '../../agents/output-text';

/** Beta: the completed final assistant messages from one hosted root turn. */
export class AgentTurnResult {
  readonly turn: Turn;
  readonly messages: AgentSessionAssistantMessage[];
  constructor(turn: Turn, messages: AgentSessionAssistantMessage[]) {
    this.turn = turn;
    this.messages = messages;
  }
  get session_id(): string {
    return this.turn.session_id;
  }
  get turn_id(): string {
    return this.turn.id;
  }
  get output_text(): string {
    return this.messages.map(outputText).join('');
  }
}
