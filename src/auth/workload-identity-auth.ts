import type { Fetch } from '../internal/builtin-types';
import { OpenAIError } from '../core/error';
import { SubjectTokenWorkloadIdentityAuth } from '../internal/auth/subject-token-workload-identity-auth';
import * as Shims from '../internal/shims';
import type { SubjectTokenWorkloadIdentity } from './types';

/**
 * Exchanges external workload identities for cached OpenAI access tokens.
 *
 * The OpenAI client supplies request-scoped X.509 lifecycle controls through an
 * internal state owner; this compatibility facade retains its original API.
 */
export class WorkloadIdentityAuth {
  #auth: SubjectTokenWorkloadIdentityAuth;

  constructor(config: SubjectTokenWorkloadIdentity, fetch?: Fetch) {
    if (!config.provider) {
      throw new OpenAIError(
        'WorkloadIdentityAuth supports subject-token identities only; configure X.509 workload identity on the OpenAI client.',
      );
    }
    this.#auth = new SubjectTokenWorkloadIdentityAuth(config, fetch ?? Shims.getDefaultFetch());
  }

  async getToken(): Promise<string> {
    return await this.#auth.getToken();
  }

  invalidateToken(): void {
    this.#auth.invalidateToken();
  }
}
