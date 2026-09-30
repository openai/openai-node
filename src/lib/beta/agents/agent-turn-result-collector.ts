import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionMessage,
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
  #items = new Map<string, { index: number; message: AgentSessionMessage; done: boolean }>();
  #unresolved = new Set<string>();
  #requiredActions: AgentSession['required_actions'] = [];
  #pendingCalls = new Map<string, AgentSession.SessionRequiredActionResourceFunctionCall>();
  #sessionFailed = false;
  #terminal = false;
  #idle = false;

  constructor(sessionID?: string) {
    this.#sessionID = sessionID;
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
    this.#acceptCall(event);
    let turnID = 'turn_id' in event ? event.turn_id : undefined;
    if ('item' in event) {
      turnID = event.item.turn_id;
    }
    if (!this.#turn || turnID !== this.#turn.id) {
      return;
    }
    this.#acceptTurn(event);
  }

  #acceptCall(event: AgentSessionEvent): void {
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'function_call') {
      const call = event.item;
      this.#pendingCalls.set(`${call.turn_id}:${call.call_id}`, {
        type: 'function_call',
        turn_id: call.turn_id,
        call_id: call.call_id,
        name: call.name,
        arguments: structuredClone(call.arguments),
      });
    }
    if (event.type === 'agent.session.turn.item.done' && event.item.type === 'function_call') {
      this.#pendingCalls.delete(`${event.item.turn_id}:${event.item.call_id}`);
    }
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
    if (event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') {
      if (event.item.type !== 'message' || event.item.role !== 'assistant' || event.item.id === null) {
        return;
      }
      if (event.output_index === null) {
        this.#unresolved.add(event.item.id);
        return;
      }
      const done = event.type === 'agent.session.turn.item.done' && event.item.status === 'completed';
      const previous = this.#items.get(event.item.id);
      if (!previous?.done || done) {
        this.#items.set(event.item.id, {
          index: event.output_index,
          message: structuredClone(event.item),
          done,
        });
      }
      if (done) {
        this.#unresolved.delete(event.item.id);
      }
    } else if (
      'item_id' in event &&
      !this.#items.get(event.item_id)?.done &&
      (event.type === 'agent.session.turn.output_text.delta' ||
        event.type === 'agent.session.turn.output_text.done' ||
        event.type === 'agent.session.turn.content_part.added' ||
        event.type === 'agent.session.turn.content_part.done')
    ) {
      this.#unresolved.add(event.item_id);
    }
  }

  #messages(): AgentSessionMessage[] {
    return (
      [...this.#items.values()]
        // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array; ES2020 declarations do not include toSorted.
        .sort((a, b) => a.index - b.index)
        .filter(({ message, done }) => done && message.phase === 'final_answer')
        .map(({ message }) => structuredClone(message))
    );
  }

  error(reason: AgentTurnResultError['reason'], cause?: unknown): AgentTurnResultError {
    return new AgentTurnResultError(
      reason,
      this.#sessionID,
      this.#turn && structuredClone(this.#turn),
      this.#messages(),
      structuredClone([...this.#requiredActions, ...this.#pendingCalls.values()]),
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
    if (
      [...this.#requiredActions, ...this.#pendingCalls.values()].some(
        (action) => action.type !== 'function_call' || !canHandle(action.name),
      )
    ) {
      throw this.error('requires_action');
    }
  }

  get ready(): boolean {
    return this.#terminal && this.#idle;
  }

  release(): void {
    this.#items.clear();
    this.#unresolved.clear();
    this.#pendingCalls.clear();
    this.#requiredActions = [];
  }

  finish(): AgentTurnResult {
    this.checkAction(() => this.ready);
    if (!this.#terminal || this.#turn?.status !== 'completed' || !this.#idle) {
      throw this.error('observation');
    }
    if (
      [...this.#unresolved].some((id) => this.#items.get(id)?.message.phase !== 'commentary') ||
      [...this.#items.values()].some(
        ({ message, done }) => message.phase !== 'commentary' && (!done || message.phase === null),
      )
    ) {
      throw this.error('output_selection');
    }
    return new AgentTurnResult(structuredClone(this.#turn), this.#messages());
  }
}
