/** Browser-safe capability state keeps CommonJS outside the ordinary SDK ESM graph. */
const registeredX509Transports = new WeakMap();
const transientX509ConnectionErrors = new WeakSet();
const retryableX509IssuerErrors = new WeakSet();
const approvedX509Clients = new WeakSet();
const approvedX509OAuthErrors = new WeakMap();
const approvedX509Credentials = new WeakMap();

/** Looks up an opaque capability without exposing the registry itself. */
export const findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports);

/** Records a capability only after its Node-only factory validates the private dispatcher. */
export const rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports);

/** Privately classifies sanitized issuer errors without exposing transport details. */
export const markTransientX509ConnectionError = WeakSet.prototype.add.bind(transientX509ConnectionErrors);

/** Checks the private transient classification without retaining caller-owned errors. */
export const isTransientX509ConnectionError = WeakSet.prototype.has.bind(transientX509ConnectionErrors);

/** Privately brands retryable issuer failures without exposing classification state. */
export const markRetryableX509IssuerError = WeakSet.prototype.add.bind(retryableX509IssuerErrors);

/** Recognizes trusted issuer failures without evaluating caller-controlled properties. */
export const isRetryableX509IssuerError = WeakSet.prototype.has.bind(retryableX509IssuerErrors);

/** Brands validated clients without exposing their mutable options or authentication fields. */
export const markApprovedX509Client = WeakSet.prototype.add.bind(approvedX509Clients);

/** Recognizes private client ownership without caller-visible markers. */
export const isApprovedX509Client = WeakSet.prototype.has.bind(approvedX509Clients);

/** Stores trusted OAuth metadata without exposing it to unrelated callers. */
export const rememberX509OAuthError = WeakMap.prototype.set.bind(approvedX509OAuthErrors);

/** Retrieves trusted metadata when public OAuth errors cross module formats. */
export const findX509OAuthError = WeakMap.prototype.get.bind(approvedX509OAuthErrors);

/** Privately binds SDK-owned credentials without importing Node or optional transport peers. */
export const rememberX509Credential = WeakMap.prototype.set.bind(approvedX509Credentials);

/** Resolves only credentials registered by the optional Node authentication helper. */
export const findX509Credential = WeakMap.prototype.get.bind(approvedX509Credentials);
