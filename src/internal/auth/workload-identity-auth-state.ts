import type { WorkloadIdentityConfig, X509WorkloadIdentity } from '../../auth/types';
import type { Fetch } from '../builtin-types';
import * as Shims from '../shims';
import { SubjectTokenWorkloadIdentityAuth } from './subject-token-workload-identity-auth';
import { X509WorkloadIdentityAuth } from './x509-workload-identity-auth';
import type { X509WorkloadIdentityAuthOptions } from './x509-workload-identity-auth';

export function isX509WorkloadIdentity(
  config: WorkloadIdentityConfig | null | undefined,
): config is X509WorkloadIdentity {
  // WorkloadIdentity is structurally extensible, so applications may already use `type` as metadata.
  // A provider selects subject-token WIF; the X.509 variant never accepts one.
  return (
    config !== null &&
    config !== undefined &&
    'type' in config &&
    config.type === 'x509' &&
    config.provider === undefined
  );
}

/** Internal mode owner used by clients that need request-scoped X.509 lifecycle controls. */
export class WorkloadIdentityAuthState {
  private readonly implementation:
    | { type: 'subject-token'; auth: SubjectTokenWorkloadIdentityAuth }
    | { type: 'x509'; auth: X509WorkloadIdentityAuth };

  constructor(config: WorkloadIdentityConfig, fetch?: Fetch, options: X509WorkloadIdentityAuthOptions = {}) {
    const effectiveFetch = fetch ?? Shims.getDefaultFetch();
    this.implementation = isX509WorkloadIdentity(config)
      ? { type: 'x509', auth: new X509WorkloadIdentityAuth(config, effectiveFetch, options) }
      : { type: 'subject-token', auth: new SubjectTokenWorkloadIdentityAuth(config, effectiveFetch) };
  }

  async getToken(
    signal?: AbortSignal | null,
    timeoutMs?: number,
    options: X509WorkloadIdentityAuthOptions = {},
  ): Promise<string> {
    if (this.implementation.type === 'x509') {
      return await this.implementation.auth.getToken(signal, timeoutMs, options);
    }
    return await this.implementation.auth.getToken();
  }

  ownsToken(token: string, options: X509WorkloadIdentityAuthOptions = {}): boolean {
    if (this.implementation.type === 'x509') {
      return this.implementation.auth.ownsToken(token, options);
    }
    return this.implementation.auth.ownsToken(token);
  }

  invalidateToken(rejectedToken?: string, options: X509WorkloadIdentityAuthOptions = {}): void {
    if (this.implementation.type === 'x509') {
      this.implementation.auth.invalidateToken(rejectedToken, options);
    } else {
      this.implementation.auth.invalidateToken(rejectedToken);
    }
  }
}
