import type { AgentSessionEvent, AgentFunctionCallItem } from '../../resources/beta/agents/agents';

/** Tracks one helper invocation's coordinator turn and duplicate deliveries.
 * @internal
 */
export class TurnState {
  #turnID: string | undefined;
  #turnEnded = false;
  #eventIDs = new Set<string>();
  #calls = new Set<string>();

  /** Records a delivery unless its event ID is in the bounded recent window. */
  accept(event: AgentSessionEvent): boolean {
    if (this.#eventIDs.has(event.event_id)) {
      return false;
    }
    if (this.#eventIDs.size === 1024) {
      const oldest = this.#eventIDs.values().next();
      if (!oldest.done) {
        this.#eventIDs.delete(oldest.value);
      }
    }
    this.#eventIDs.add(event.event_id);
    if (
      event.type === 'agent.session.turn.created' &&
      event.turn.subagent_id === null &&
      this.#turnID === undefined
    ) {
      this.#turnID = event.turn_id;
    }
    if (
      (event.type === 'agent.session.turn.completed' ||
        event.type === 'agent.session.turn.failed' ||
        event.type === 'agent.session.turn.cancelled') &&
      this.#turnID !== undefined &&
      event.turn_id === this.#turnID
    ) {
      this.#turnEnded = true;
    }
    return true;
  }

  /** Checks session termination after updating the selected turn state. */
  terminal(event: AgentSessionEvent): boolean {
    return event.type === 'agent.session.failed' || (event.type === 'agent.session.idle' && this.#turnEnded);
  }

  /** Returns each tool call once for the full invocation, including subagent turns. */
  call(event: AgentSessionEvent): AgentFunctionCallItem | undefined {
    if (event.type !== 'agent.session.turn.item.added' || event.item.type !== 'function_call') {
      return;
    }
    const call = event.item;
    const key = JSON.stringify([call.turn_id, call.call_id]);
    if (this.#calls.has(key)) {
      return;
    }
    this.#calls.add(key);
    return call;
  }
}
