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

  #ordered(order: 'asc' | 'desc'): RequestOptions {
    return { ...this.#options, query: { ...this.#options.query, order } };
  }

  snapshot(collector: AgentTurnResultCollector, session?: AgentSession): void {
    // Function delivery is authoritative in SSE, including its stale-call exclusion.
    const selected = session && {
      ...session,
      required_actions: session.required_actions.filter(
        (action) =>
          action.type === 'environment_connection' ||
          (action.type !== 'function_call' && action.turn_id === this.turn?.id),
      ),
    };
    collector.snapshot(this.turn, selected, this.settled);
  }

  async blockedEnvironment(session: AgentSession): Promise<boolean> {
    if (
      this.turn?.status !== 'waiting' ||
      session.status !== 'requires_action' ||
      !session.required_actions.some((action) => action.type === 'environment_connection')
    ) {
      return false;
    }
    const root = await this.#activeRoot();
    return root?.id === this.turn.id;
  }

  async #activeRoot(): Promise<Turn | undefined> {
    for await (const turn of this.#sessions.turns.list(this.#sessionID, {}, this.#ordered('desc'))) {
      if (turn.subagent_id === null) {
        // Once the newest root has settled, an older completed answer is not this attachment's result.
        return active(turn) ? turn : undefined;
      }
    }
    return undefined;
  }

  async prepare(): Promise<void> {
    this.turn = await this.#activeRoot();
  }

  async refresh(): Promise<AgentSession> {
    this.turn = this.turn
      ? await this.#sessions.turns.retrieve(this.turn.id, { session_id: this.#sessionID }, this.#options)
      : await this.#activeRoot();
    return this.#sessions.retrieve(this.#sessionID, this.#options);
  }

  async observe(event: AgentSessionEvent): Promise<boolean> {
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
    this.turn = turn.subagent_id === null ? structuredClone(turn) : await this.#activeRoot();
    return true;
  }

  async reconcile(collector: AgentTurnResultCollector): Promise<void> {
    if (!this.turn) {
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
  }
}
