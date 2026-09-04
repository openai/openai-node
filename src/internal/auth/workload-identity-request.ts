import { APIConnectionTimeoutError, APIUserAbortError } from '../../core/error';
import { sleep } from '../utils/sleep';

/** A single exchange's observed failure, shared only with requests using that exchange. */
export interface WorkloadIdentityRetryFailure {
  /** Original failure, including the existing issuer diagnostics. */
  error: unknown;
  /** Initially observed minimum, used for the existing 60-second retry limit. */
  delayMillis: number;
  /** Monotonic time before which another exchange must not start. */
  notBefore: number;
}

/** Lightweight exchange result; background work never retains a caller's request options. */
export interface WorkloadIdentityRefresh {
  /** Shared foreground or background exchange. */
  promise: Promise<string>;
  /** Whether the exchange settled, allowing request-local observations to be pruned. */
  complete?: boolean;
  /** Minimum already received while error decoding is still pending. */
  minimum?: { delayMillis: number; notBefore: number };
  /** Server minimum captured before reading an unsuccessful response body. */
  failure?: WorkloadIdentityRetryFailure;
}

/** Waits for an observed issuer response without canceling the cache-owned exchange. */
export async function waitForWorkloadIdentityRefresh(
  refresh: WorkloadIdentityRefresh,
  deadline?: number,
  signal?: AbortSignal | null,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    // oxlint-disable-next-line promise/avoid-new -- A shared promise must race callback-only cancellation and a deadline.
    const canceled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        const error = new APIUserAbortError();
        Object.defineProperty(error, 'cause', { value: signal?.reason, configurable: true, writable: true });
        reject(error);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
      if (deadline !== undefined) {
        timer = setTimeout(
          () => reject(new APIConnectionTimeoutError()),
          Math.max(0, deadline - performance.now()),
        );
      }
    });
    return await Promise.race([refresh.promise, canceled]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (abort) {
      signal?.removeEventListener('abort', abort);
    }
  }
}

/** Private logical-request coordination, independent of caller options object identity. */
export interface WorkloadIdentityRequestContext {
  /** Exchange used or started by this request, even if a cached bearer was returned. */
  refresh?: WorkloadIdentityRefresh;
  /** Pending exchanges and the strongest known minimum observed by this logical request. */
  refreshes?: Set<WorkloadIdentityRefresh>;
  /** Current attempt's monotonic start, retained while hooks mutate effective request options. */
  startedAt?: number;
  /** Current attempt's effective monotonic deadline for foreground issuer acquisition. */
  deadline?: number;
  /** Caller cancellation for foreground retry waits. */
  signal?: AbortSignal | null | undefined;
}

/** Retains lazy observations while discarding completed exchanges and weaker known minima. */
export function strongestWorkloadIdentityRefresh(
  request: WorkloadIdentityRequestContext | undefined,
): WorkloadIdentityRefresh | undefined {
  const refreshes = request?.refreshes;
  if (!refreshes) {
    return;
  }
  let strongest: WorkloadIdentityRefresh | undefined;
  for (const refresh of refreshes) {
    const { minimum } = refresh;
    if (!minimum) {
      if (refresh.complete) {
        refreshes.delete(refresh);
      }
      continue;
    }
    const previous = strongest?.minimum;
    const terminal = minimum.delayMillis > 60_000;
    const previousTerminal = (previous?.delayMillis ?? 0) > 60_000;
    if (
      !previous ||
      (terminal && !previousTerminal) ||
      (terminal === previousTerminal && minimum.notBefore > previous.notBefore)
    ) {
      strongest = refresh;
    }
  }
  for (const refresh of refreshes) {
    if (refresh.minimum && refresh !== strongest) {
      refreshes.delete(refresh);
    }
  }
  return strongest;
}

const tokenRequests = new WeakMap<object, WorkloadIdentityRequestContext>();

/** Reads the synchronous invocation context without adding parameters to public getToken(). */
export function currentWorkloadIdentityRequest(owner: object): WorkloadIdentityRequestContext | undefined {
  return tokenRequests.get(owner);
}

/** Calls the existing public token hook while passing only private invocation state. */
export function getWorkloadIdentityToken(
  owner: { getToken: () => Promise<string> },
  request: WorkloadIdentityRequestContext | undefined,
): Promise<string> {
  if (!request) {
    return owner.getToken();
  }
  const previous = tokenRequests.get(owner);
  tokenRequests.set(owner, request);
  try {
    return owner.getToken();
  } finally {
    if (previous) {
      tokenRequests.set(owner, previous);
    } else {
      tokenRequests.delete(owner);
    }
  }
}

/** Enforces the cache-owned exchange's minimum independently of individual callers. */
export async function waitForWorkloadIdentityRetry(failure: WorkloadIdentityRetryFailure): Promise<void> {
  if (failure.delayMillis > 60_000) {
    throw failure.error;
  }
  const delay = Math.ceil(Math.max(0, failure.notBefore - performance.now()));
  if (delay) {
    await sleep(delay);
  }
}
