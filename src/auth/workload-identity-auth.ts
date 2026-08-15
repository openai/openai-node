import type { Fetch } from '../internal/builtin-types';
import { WorkloadIdentityAuthState } from '../internal/auth/workload-identity-auth-state';
import type { WorkloadIdentityConfig } from './types';

/**
 * Exchanges external workload identities for cached OpenAI access tokens.
 *
 * The OpenAI client supplies request-scoped X.509 lifecycle controls through an
 * internal state owner; this compatibility facade retains its original API.
 */
export class WorkloadIdentityAuth {
  #state: WorkloadIdentityAuthState;

  constructor(config: WorkloadIdentityConfig, fetch?: Fetch) {
    this.#state = new WorkloadIdentityAuthState(config, fetch);
  }

  async getToken(): Promise<string> {
    return await this.#state.getToken();
  }

  invalidateToken(): void {
    this.#state.invalidateToken();
  }
}
