import type { AgentSessionMessage } from '../../resources/beta/agents/agents';

/** Joins output_text blocks in content order, without filtering phase, fetching, or mutating the message. */
export function outputText(message: AgentSessionMessage): string {
  return message.content.map((block) => (block.type === 'output_text' ? block.text : '')).join('');
}
