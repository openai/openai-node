import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createX509Transport as createCapability,
  registerX509Transport,
  sendX509Request,
} from '../internal/auth/x509-transport-capability';
import type { X509Transport, X509TransportOptions } from '../internal/auth/x509-transport-capability';
import { exchangeX509Token } from '../internal/auth/x509-token-exchange';
import { isRetryableX509TransportFailure } from '../internal/auth/x509-transport-registry';
import type { X509RequestScope } from '../internal/auth/x509-transport-registry';
import { markTransientX509ConnectionError } from '#x509-transport-state';

/** Creates one frozen, caller-attested Node.js transport for X.509 workload authentication. */
export function createX509Transport(options: X509TransportOptions): X509Transport {
  const capability = createCapability(options);
  const scopes = new AsyncLocalStorage<X509RequestScope>();
  registerX509Transport(capability, {
    dispatch: async (target, requestOptions) => {
      try {
        return await sendX509Request(capability, target, requestOptions);
      } catch (error) {
        if (error instanceof Error && isRetryableX509TransportFailure(error)) {
          markTransientX509ConnectionError(error);
        }
        throw error;
      }
    },
    exchange: async (identityProviderId, serviceAccountId, signal) =>
      await exchangeX509Token({
        transport: capability,
        identityProviderId,
        serviceAccountId,
        ...(signal ? { signal } : {}),
      }),
    run: (operation) =>
      scopes.run({ wallStartedAt: Date.now(), monotonicStartedAt: performance.now() }, operation),
    current: () => scopes.getStore(),
    resume: (scope, operation) => scopes.run(scope, operation),
    sleep: async (duration, signal) => await delay(duration, undefined, { signal: signal ?? undefined }),
  });
  return capability;
}

export type {
  X509ProxyMode,
  X509Transport,
  X509TransportOptions,
} from '../internal/auth/x509-transport-capability';
