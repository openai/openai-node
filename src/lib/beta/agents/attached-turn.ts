import { OpenAIError } from '../../../core/error';
import type { AgentSession, AgentSessionEvent } from '../../../resources/beta/agents/agents';
import type { Sessions } from '../../../resources/beta/agents/sessions/sessions';
import type { Turn } from '../../../resources/beta/agents/sessions/turns';
import type { RequestOptions } from '../../../internal/request-options';
import type { AgentTurnResultCollector } from './agent-turn-result-collector';

function active(turn: Turn): boolean {
  return turn.status === 'queued' || turn.status === 'in_progress' || turn.status === 'waiting';
}

/** Selects the root work observed by one attachment; never dispatches snapshot actions. @internal */
export class AttachedTurn {
  turn: Turn | undefined;
  #baselineID: string | undefined;
  #reconciled = false;
  #idle = false;
  readonly #sessions: Sessions;
  readonly #sessionID: string;
  readonly #options: RequestOptions;

  constructor(sessions: Sessions, sessionID: string, options: RequestOptions) {
    this.#sessions = sessions;
    this.#sessionID = sessionID;
    this.#options = options;
  }

  get settled(): boolean {
    return this.turn !== undefined && !active(this.turn);
  }

  terminal(event: AgentSessionEvent): boolean {
    return this.settled || (!this.turn && this.#idle && event.type === 'agent.session.idle');
  }

  #ordered(order: 'asc' | 'desc'): RequestOptions {
    return { ...this.#options, query: { ...this.#options.query, order, after: undefined } };
  }

  snapshot(
    collector: AgentTurnResultCollector,
    session?: AgentSession,
    requiredActions: AgentSession['required_actions'] = [],
  ): void {
    // Function delivery is authoritative in SSE. Only separately validated manual actions seed a snapshot.
    collector.snapshot(this.turn, session && { ...session, required_actions: requiredActions }, this.settled);
  }

  async manualActions(session: AgentSession): Promise<AgentSession['required_actions']> {
    if (this.turn?.status !== 'waiting' || session.status !== 'requires_action') {
      return [];
    }
    const actions: AgentSession['required_actions'] = session.required_actions.filter(
      (action) => action.type === 'computer_use_approval_request' && action.turn_id === this.turn?.id,
    );
    const environment = session.required_actions.filter((action) => action.type === 'environment_connection');
    if (environment.length) {
      const latest = await this.#latestRoot();
      if (latest?.id === this.turn.id) {
        actions.push(...environment);
      }
    }
    return actions;
  }

  async #latestRoot(): Promise<Turn | undefined> {
    for await (const turn of this.#sessions.turns.list(this.#sessionID, {}, this.#ordered('desc'))) {
      if (turn.subagent_id === null) {
        // Root lookup stops at the newest root, including an idle baseline.
        return turn;
      }
    }
    return undefined;
  }

  async prepare(): Promise<void> {
    const root = await this.#latestRoot();
    this.#baselineID = root?.id;
    this.turn = root && active(root) ? root : undefined;
  }

  async #newRoot(): Promise<Turn | undefined> {
    const root = await this.#latestRoot();
    return root && (active(root) || root.id !== this.#baselineID) ? root : undefined;
  }

  async refresh(): Promise<AgentSession> {
    this.turn = this.turn
      ? await this.#sessions.turns.retrieve(this.turn.id, { session_id: this.#sessionID }, this.#options)
      : await this.#newRoot();
    const session = await this.#sessions.retrieve(this.#sessionID, this.#options);
    this.#idle = session.status === 'idle';
    return session;
  }

  async observe(event: AgentSessionEvent): Promise<boolean> {
    if (event.type === 'agent.session.idle' && !this.settled) {
      await this.refresh();
    }
    if (this.turn) {
      if ('turn' in event && event.turn.id === this.turn.id) {
        this.turn = structuredClone(event.turn);
      } else if (
        (event.type === 'agent.session.turn.created' &&
          event.turn.subagent_id === null &&
          event.turn_id !== this.turn.id) ||
        (event.type === 'agent.session.turn.item.added' &&
          event.item.type === 'function_call' &&
          event.item.turn_id !== this.turn.id)
      ) {
        // Hosted local function deliveries belong to the active root; never dispatch a successor through this attachment.
        await this.refresh();
        if (!this.settled) {
          throw new OpenAIError('Another root turn became active before selected work settled');
        }
        return false;
      }
      return true;
    }
    // A replayed pending function can be the first frame, without turn.created.
    let id = 'turn_id' in event ? event.turn_id : undefined;
    if ('item' in event) {
      id = event.item.turn_id;
    }
    if (!id) {
      return true;
    }
    const turn =
      'turn' in event
        ? event.turn
        : await this.#sessions.turns.retrieve(id, { session_id: this.#sessionID }, this.#options);
    // Historical approval items can name any older root, not just the initial baseline.
    this.turn = turn.subagent_id === null && active(turn) ? structuredClone(turn) : await this.#newRoot();
    return true;
  }

  /** One durable check after a genuine SSE read failure; active work remains an observation error. */
  async recover(collector?: AgentTurnResultCollector): Promise<boolean> {
    if (!this.turn) {
      return false;
    }
    try {
      await (collector ? this.reconcile(collector) : this.refresh());
      return collector ? this.settled : this.turn?.status === 'completed';
    } catch {
      // Retain the original stream failure if the recovery read also fails.
      return false;
    }
  }

  async reconcile(collector: AgentTurnResultCollector): Promise<void> {
    if (!this.turn || this.#reconciled) {
      return;
    }
    const session = await this.refresh();
    this.snapshot(collector, session);
    if (!this.settled) {
      return;
    }
    let index = 0;
    for await (const item of this.#sessions.items.list(this.#sessionID, {}, this.#ordered('asc'))) {
      if (
        item.type === 'message' &&
        item.turn_id === this.turn.id &&
        item.role === 'assistant' &&
        item.status === 'completed' &&
        item.phase !== 'commentary'
      ) {
        collector.history(item, index);
      }
      index += 1;
    }
    this.#reconciled = true;
  }
}
