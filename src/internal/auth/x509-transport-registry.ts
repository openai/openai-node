import { OpenAIError } from '../../core/error';
import type { NullableHeaders } from '../headers';
import type { X509WorkloadIdentity } from '../../auth/types';
import type { ReadableStream } from '../shim-types';
import type { MergedRequestInit } from '../types';
import { findRegisteredX509Transport } from '#x509-transport-state';

const transientX509TransportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Retries only known temporary failures when neither error layer reports a permanent code. */
export function isRetryableX509TransportFailure(failure: unknown): boolean {
  const cause =
    typeof failure === 'object' && failure !== null
      ? Object.getOwnPropertyDescriptor(failure, 'cause')?.value
      : undefined;
  let retryable = false;
  for (const candidate of [failure, cause]) {
    const code =
      typeof candidate === 'object' && candidate !== null
        ? Object.getOwnPropertyDescriptor(candidate, 'code')?.value
        : undefined;
    if (typeof code === 'string') {
      if (!transientX509TransportCodes.has(code)) {
        return false;
      }
      retryable = true;
    }
  }
  return retryable;
}

export const x509TransportBrand: unique symbol = Symbol('X.509 transport capability');

/** Opaque identity of one frozen, caller-owned, explicitly attested X.509 transport. */
export interface X509Transport {
  /** Prevents ordinary objects from satisfying the transport capability contract. */
  readonly [x509TransportBrand]: true;
}

/** Immutable selectors and transport privately registered for an SDK-owned credential. */
export interface RegisteredX509Credential {
  readonly identity: X509WorkloadIdentity;
  readonly transport: X509Transport;
}

/** Validated short-lived token exchanged using a registered certificate identity. */
export interface X509ExchangedToken {
  /** Header-safe, in-memory OpenAI bearer credential. */
  accessToken: string;

  /** Issuer-approved positive token lifetime in seconds. */
  expiresIn: number;
}

/** One logical certificate-authenticated operation and its immutable starting deadline. */
export interface X509RequestScope {
  wallStartedAt: number;
  monotonicStartedAt: number;
  deadlineArmed?: boolean;
  preparationStartedAt?: number;
  preparationWallStartedAt?: number;
  request?: { signal: AbortSignal | null | undefined; timeout: number; fetchOptions: MergedRequestInit };
  phase?: 'planning' | 'authorizing';
  effectiveSignal?: AbortSignal;
  materializedBody?: ReadableStream;
  owner?: object;
  requestOwner?: object;
  apiURL?: string;
  tenant?: { organization: string | null; project: string | null };
  defaultHeaders?: NullableHeaders;
  requestHeaders?: NullableHeaders;
  token?: string;
  tokenGeneration?: number;
  headers?: Headers;
  authorization?: string | null;
}

/** Private, peer-independent operations attached to one approved transport generation. */
export interface RegisteredX509Transport {
  /** Dispatches one request through the exact frozen certificate capability. */
  dispatch: (target: URL, options: RequestInit) => Promise<Response>;

  /** Exchanges the same certificate identity for an OpenAI service-account bearer. */
  exchange: (
    identityProviderId: string,
    serviceAccountId: string,
    signal?: AbortSignal,
  ) => Promise<X509ExchangedToken>;

  /** Establishes one isolated Node async context without exposing Node dependencies to the root SDK. */
  run: <T>(operation: () => T) => T;

  /** Resolves only the current logical request's private certificate-authentication scope. */
  current: () => X509RequestScope | undefined;

  /** Re-enters the original request scope when response parsing resumes outside its promise chain. */
  resume: <T>(scope: X509RequestScope, operation: () => T) => T;

  /** Waits for retry backoff using an abortable timer that keeps an active request alive. */
  sleep: (duration: number, signal?: AbortSignal | null) => Promise<void>;
}

/** Resolves a previously registered opaque capability without importing an optional transport peer. */
export function resolveX509Transport(value: unknown): RegisteredX509Transport {
  if (!value || typeof value !== 'object') {
    throw new OpenAIError('X.509 workload identity requires an approved X.509 transport capability.');
  }

  const registered: RegisteredX509Transport | undefined = findRegisteredX509Transport(value);
  if (!registered) {
    throw new OpenAIError('X.509 workload identity requires an approved X.509 transport capability.');
  }
  return registered;
}
