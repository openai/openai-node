import type { WorkloadIdentityAuth } from '../../auth/workload-identity-auth';

interface TokenState {
  cached: { authorization: string; expiresAt: number } | undefined;
  observers: Set<Set<string>>;
}

// Authentication owns the cached credential; each preparing request owns its observed tokens.
const states = new WeakMap<WorkloadIdentityAuth, TokenState>();

function stateFor(authentication: WorkloadIdentityAuth): TokenState {
  let state = states.get(authentication);
  if (!state) {
    state = { cached: undefined, observers: new Set() };
    states.set(authentication, state);
  }
  return state;
}

/** Records one validated exchange, including a result returned after its cache generation retired. */
export function recordWorkloadToken(
  authentication: WorkloadIdentityAuth,
  token: string,
  expiresAt: number,
  cached: boolean,
): void {
  const state = stateFor(authentication);
  const authorization = `Bearer ${token}`;
  if (cached) {
    state.cached = { authorization, expiresAt };
  }
  for (const tokens of state.observers) {
    tokens.add(authorization);
  }
}

/** Retires the cached marker without discarding tokens already held by preparing requests. */
export function invalidateWorkloadToken(authentication: WorkloadIdentityAuth): void {
  const state = states.get(authentication);
  if (!state) {
    return;
  }
  state.cached = undefined;
  if (state.observers.size === 0) {
    states.delete(authentication);
  }
}

/** Observes issued credentials until this request finishes building its final headers. */
export function observeWorkloadTokens(authentication: WorkloadIdentityAuth) {
  const state = stateFor(authentication);
  if (state.cached && Date.now() >= state.cached.expiresAt) {
    state.cached = undefined;
  }
  const tokens = new Set(state.cached === undefined ? [] : [state.cached.authorization]);
  state.observers.add(tokens);
  return {
    /** Matches final headers independently of hook options and header object identities. */
    matches(authorization: string | null): boolean {
      return authorization !== null && tokens.has(authorization);
    },
    /** Releases credentials on completion or any preparation failure; safe to repeat. */
    dispose(): void {
      if (!state.observers.delete(tokens)) {
        return;
      }
      tokens.clear();
      if (state.cached === undefined && state.observers.size === 0) {
        states.delete(authentication);
      }
    },
  };
}
