import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionAssistantMessage,
  AgentSessionMessage,
  AgentFunctionCallItem,
} from '../../../resources/beta/agents/agents';
import type { Turn } from '../../../resources/beta/agents/sessions/turns';
import { AgentTurnResult } from './agent-turn-result';
import { AgentTurnResultError } from './agent-turn-result-error';

/** Accumulates completed items independently of transport and tool execution.
 * @internal
 */
export class AgentTurnResultCollector {
  #sessionID: string | undefined;
  #turn: Turn | undefined;
  #messages = new Map<string, { index: number; message: AgentSessionAssistantMessage }>();
  #requiredActions: AgentSession['required_actions'] = [];
  #sessionFailed = false;
  #terminal = false;
  #idle = false;

  constructor(sessionID?: string) {
    this.#sessionID = sessionID;
  }

  /** Seed a selected root without synthesizing public SSE events. */
  snapshot(turn: Turn | undefined, session?: AgentSession, settled = false): void {
    if (turn && turn.subagent_id === null && (!this.#turn || this.#turn.id === turn.id)) {
      this.#turn = structuredClone(turn);
      this.#sessionID = turn.session_id;
      this.#terminal = turn.status === 'completed' || turn.status === 'failed' || turn.status === 'cancelled';
    }
    if (settled && this.#terminal) {
      this.#idle = true;
      this.#requiredActions = [];
      return;
    }
    if (session) {
      this.#requiredActions = structuredClone(session.required_actions ?? []);
      this.#sessionFailed ||= session.status === 'failed';
      this.#idle ||= session.status === 'idle' && this.#terminal;
    }
  }

  /** A replayed unhandled function is a diagnostic, never a snapshot execution queue. */
  pendingFunction(call: AgentFunctionCallItem): void {
    this.#requiredActions = [
      {
        type: 'function_call',
        turn_id: call.turn_id,
        call_id: call.call_id,
        name: call.name,
        arguments: structuredClone(call.arguments),
      },
    ];
  }

  /** Preserve an observed SSE snapshot, including extra fields omitted from history. */
  history(item: AgentSessionMessage, index: number): void {
    if (item.id === null || item.content.some((part) => part.type !== 'output_text')) {
      throw this.error('observation');
    }
    const observed = this.#messages.get(item.id)?.message;
    const message: AgentSessionAssistantMessage = observed ?? {
      ...item,
      id: item.id,
      role: 'assistant',
      content: item.content.flatMap((part) => (part.type === 'output_text' ? [{ ...part }] : [])),
    };
    this.#messages.set(item.id, { index, message });
  }

  accept(event: AgentSessionEvent): void {
    if (this.ready) {
      return;
    }
    if ('session' in event) {
      this.#sessionID ??= event.session.id;
      this.#requiredActions = structuredClone(event.session.required_actions ?? []);
      this.#sessionFailed ||= event.type === 'agent.session.failed';
      this.#idle ||= event.type === 'agent.session.idle' && this.#terminal;
    }
    if (event.type === 'agent.session.turn.created' && event.turn.subagent_id === null && !this.#turn) {
      this.#turn = structuredClone(event.turn);
      this.#sessionID = event.turn.session_id;
    }
    let turnID = 'turn_id' in event ? event.turn_id : undefined;
    if ('item' in event) {
      turnID = event.item.turn_id;
    }
    if (!this.#turn || turnID !== this.#turn.id) {
      return;
    }
    this.#acceptTurn(event);
  }

  #acceptTurn(event: AgentSessionEvent): void {
    if ('turn' in event) {
      this.#turn = structuredClone(event.turn);
      this.#terminal ||=
        event.type === 'agent.session.turn.completed' ||
        event.type === 'agent.session.turn.failed' ||
        event.type === 'agent.session.turn.cancelled';
    }
    this.#acceptOutput(event);
  }

  #acceptOutput(event: AgentSessionEvent): void {
    if (
      event.type !== 'agent.session.turn.item.done' ||
      event.item.type !== 'message' ||
      event.item.status !== 'completed' ||
      event.item.phase === 'commentary' ||
      this.#messages.has(event.item.id)
    ) {
      return;
    }
    this.#messages.set(event.item.id, { index: event.output_index, message: structuredClone(event.item) });
  }

  #finalMessages(): AgentSessionAssistantMessage[] {
    return (
      [...this.#messages.values()]
        // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array; ES2020 declarations do not include toSorted.
        .sort((a, b) => a.index - b.index)
        .map(({ message }) => message)
    );
  }

  error(reason: AgentTurnResultError['reason'], cause?: unknown): AgentTurnResultError {
    return new AgentTurnResultError(
      reason,
      this.#sessionID,
      this.#turn,
      this.#finalMessages(),
      this.#requiredActions,
      cause,
    );
  }

  checkAction(canHandle: (name: string) => boolean): void {
    if (this.#sessionFailed || this.#turn?.status === 'failed') {
      throw this.error('failed');
    }
    if (this.#turn?.status === 'cancelled') {
      throw this.error('cancelled');
    }
    if (this.#requiredActions.some((action) => action.type !== 'function_call' || !canHandle(action.name))) {
      throw this.error('requires_action');
    }
  }

  get ready(): boolean {
    return this.#terminal && this.#idle;
  }

  release(): void {
    this.#messages.clear();
    this.#requiredActions = [];
  }

  finish(): AgentTurnResult {
    this.checkAction(() => this.ready);
    if (!this.#terminal || this.#turn?.status !== 'completed' || !this.#idle) {
      throw this.error('observation');
    }
    return new AgentTurnResult(this.#turn, this.#finalMessages());
  }
}
