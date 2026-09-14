type AbortCallback = () => void;
interface WeakAbortCallback {
  deref: () => AbortCallback | undefined;
}
interface AbortFinalizer {
  register: (target: AbortCallback, cleanup: AbortCallback, token: object) => void;
  unregister: (token: object) => boolean;
}

// Keep these optional runtime features out of the SDK's ES2020 type requirements.
const weakGlobals = globalThis as typeof globalThis & {
  WeakRef?: new (callback: AbortCallback) => WeakAbortCallback;
  FinalizationRegistry?: new (cleanup: (value: AbortCallback) => void) => AbortFinalizer;
};
const finalizer =
  typeof weakGlobals.FinalizationRegistry === 'function'
    ? new weakGlobals.FinalizationRegistry((cleanup) => cleanup())
    : undefined;
const callbackOwners = new WeakMap<object, AbortCallback>();
const subscriptions = new WeakMap<AbortSignal, { callbacks: Set<WeakAbortCallback>; abort: AbortCallback }>();

// This scope receives only a weak reference, so its closures cannot retain the callback.
function subscribeWeakly(signal: AbortSignal, reference: WeakAbortCallback, registry: AbortFinalizer) {
  let subscription = subscriptions.get(signal);
  if (!subscription) {
    const callbacks = new Set<WeakAbortCallback>();
    const abort = () => {
      subscriptions.delete(signal);
      for (const callback of callbacks) {
        registry.unregister(callback);
        callback.deref()?.();
      }
      callbacks.clear();
    };
    subscription = { callbacks, abort };
    subscriptions.set(signal, subscription);
    signal.addEventListener('abort', abort, { once: true });
  }
  const owner = subscription;
  owner.callbacks.add(reference);
  return () => {
    owner.callbacks.delete(reference);
    registry.unregister(reference);
    if (owner.callbacks.size === 0) {
      signal.removeEventListener('abort', owner.abort);
      if (subscriptions.get(signal) === owner) {
        subscriptions.delete(signal);
      }
    }
  };
}

/**
 * Share one caller listener without it retaining completed requests. Collection removes
 * weak subscriptions eventually; a live response body or custom response retains its callback.
 * Runtimes without weak references keep the existing listener-based behavior.
 */
export function addRequestAbortListener(
  signal: AbortSignal,
  abort: AbortCallback,
  requestSignal: AbortSignal,
): AbortCallback {
  if (signal.aborted) {
    abort();
    return () => {
      // No listener was installed for an already aborted signal.
    };
  }
  if (typeof weakGlobals.WeakRef !== 'function' || !finalizer) {
    signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
  }
  const reference = new weakGlobals.WeakRef(abort);
  const cleanup = subscribeWeakly(signal, reference, finalizer);
  finalizer.register(abort, cleanup, reference);
  callbackOwners.set(requestSignal, abort);
  return cleanup;
}

/** Keep cancellation alive while a response body or bodyless custom response remains reachable. */
export function retainRequestAbortCallback(owner: object, abort: AbortCallback): void {
  if (typeof weakGlobals.WeakRef === 'function' && finalizer) {
    callbackOwners.set(owner, abort);
  }
}
