/** One lexical capability registry remains authoritative across mixed module formats. */
const registeredX509Transports = new WeakMap();

/** Looks up an opaque capability without exposing the registry itself. */
export const findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports);

/** Records a capability only after the Node-only factory verifies its genuine private dispatcher. */
export const rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports);
