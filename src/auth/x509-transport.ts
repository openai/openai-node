import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createX509Transport as createCapability,
  registerX509Transport,
  sendX509Request,
} from '../internal/auth/x509-transport-capability';
import type { X509Transport, X509TransportOptions } from '../internal/auth/x509-transport-capability';
import { exchangeX509Token } from '../internal/auth/x509-token-exchange';
import type { X509RequestScope } from '../internal/auth/x509-transport-registry';

/** Creates one frozen, caller-attested Node.js transport for X.509 workload authentication. */
export function createX509Transport(options: X509TransportOptions): X509Transport {
  const capability = createCapability(options);
  const scopes = new AsyncLocalStorage<X509RequestScope>();
  registerX509Transport(capability, {
    dispatch: async (target, requestOptions) => await sendX509Request(capability, target, requestOptions),
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
  });
  return capability;
}

export type {
  X509ProxyMode,
  X509Transport,
  X509TransportOptions,
} from '../internal/auth/x509-transport-capability';
