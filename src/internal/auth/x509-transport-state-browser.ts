/** Browser-safe capability state keeps CommonJS outside the ordinary SDK ESM graph. */
const registeredX509Transports = new WeakMap();
const transientX509ConnectionErrors = new WeakSet();

/** Looks up an opaque capability without exposing the registry itself. */
export const findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports);

/** Records a capability only after its Node-only factory validates the private dispatcher. */
export const rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports);

/** Privately classifies sanitized issuer errors without exposing transport details. */
export const markTransientX509ConnectionError = WeakSet.prototype.add.bind(transientX509ConnectionErrors);

/** Checks the private transient classification without retaining caller-owned errors. */
export const isTransientX509ConnectionError = WeakSet.prototype.has.bind(transientX509ConnectionErrors);
