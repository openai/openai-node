type AbortCallback = () => void;
interface WeakReference<T> {
  deref: () => T | undefined;
}
type WeakAbortCallback = WeakReference<AbortCallback>;
interface AbortFinalizer {
  register: (target: AbortCallback, cleanup: AbortCallback, token: WeakAbortCallback) => void;
  unregister: (token: WeakAbortCallback) => boolean;
}

// Keep these optional runtime features out of the SDK's ES2020 type requirements.
// SAFETY: These host features are optional and checked before use; the structural view avoids requiring newer ambient library declarations.
const weakGlobals = globalThis as typeof globalThis & {
  WeakRef?: new <T extends object>(target: T) => WeakReference<T>;
  FinalizationRegistry?: new (cleanup: (value: AbortCallback) => void) => AbortFinalizer;
};
const finalizer =
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Weak references and finalizers are optional host capabilities, so probe them before constructing either.
  typeof weakGlobals.FinalizationRegistry === 'function'
    ? new weakGlobals.FinalizationRegistry((cleanup) => {
        try {
          cleanup();
        } catch {
          // Caller-provided signal methods must not throw out of a GC callback.
        }
      })
    : undefined;
const callbackOwners = new WeakMap<object, Set<AbortCallback>>();
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
    signal.addEventListener('abort', abort, { once: true });
    subscriptions.set(signal, subscription);
  }
  const owner = subscription;
  owner.callbacks.add(reference);
  return () => {
    owner.callbacks.delete(reference);
    registry.unregister(reference);
    if (owner.callbacks.size === 0) {
      if (subscriptions.get(signal) === owner) {
        subscriptions.delete(signal);
      }
      signal.removeEventListener('abort', owner.abort);
    }
  };
}

// The listener must not retain the shared owner or its other request callbacks.
function releaseOnAbort(
  signal: AbortSignal,
  callbacks: WeakReference<Set<AbortCallback>>,
  abort: AbortCallback,
) {
  signal.addEventListener('abort', () => callbacks.deref()?.delete(abort), { once: true });
}

/** Keep cancellation alive until abort or collection of the response body or bodyless custom response. */
export function retainRequestAbortCallback(
  // oxlint-disable-next-line anti-slop/no-object-parameters -- Abort callbacks are retained by any response-body or custom-response owner identity.
  owner: object,
  abort: AbortCallback,
  requestSignal: AbortSignal,
): void {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Weak references and finalizers are optional host capabilities, so probe them before constructing either.
  if (typeof weakGlobals.WeakRef === 'function' && finalizer && !requestSignal.aborted) {
    let callbacks = callbackOwners.get(owner);
    if (!callbacks) {
      callbacks = new Set();
      callbackOwners.set(owner, callbacks);
    }
    callbacks.add(abort);
    releaseOnAbort(requestSignal, new weakGlobals.WeakRef(callbacks), abort);
  }
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
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Weak references and finalizers are optional host capabilities, so probe them before constructing either.
  if (typeof weakGlobals.WeakRef !== 'function' || !finalizer) {
    signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
  }
  const reference = new weakGlobals.WeakRef(abort);
  const cleanup = subscribeWeakly(signal, reference, finalizer);
  finalizer.register(abort, cleanup, reference);
  retainRequestAbortCallback(requestSignal, abort, requestSignal);
  return cleanup;
}
