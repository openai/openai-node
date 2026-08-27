/** One lexical capability registry remains authoritative across mixed module formats. */
const registeredX509Transports = new WeakMap();
const transientX509ConnectionErrors = new WeakSet();
const retryableX509IssuerErrors = new WeakSet();
const approvedX509Clients = new WeakSet();
const approvedX509OAuthErrors = new WeakMap();
const approvedX509Credentials = new WeakMap();

/** Looks up an opaque capability without exposing the registry itself. */
export const findRegisteredX509Transport = WeakMap.prototype.get.bind(registeredX509Transports);

/** Records a capability only after the Node-only factory verifies its genuine private dispatcher. */
export const rememberRegisteredX509Transport = WeakMap.prototype.set.bind(registeredX509Transports);

/** Privately brands sanitized connection errors shared across CommonJS and ESM clients. */
export const markTransientX509ConnectionError = WeakSet.prototype.add.bind(transientX509ConnectionErrors);

/** Recognizes a transient connection without trusting public error properties. */
export const isTransientX509ConnectionError = WeakSet.prototype.has.bind(transientX509ConnectionErrors);

/** Privately brands issuer-generated retryable HTTP failures across module formats. */
export const markRetryableX509IssuerError = WeakSet.prototype.add.bind(retryableX509IssuerErrors);

/** Recognizes only retryable HTTP errors produced by the trusted certificate exchange. */
export const isRetryableX509IssuerError = WeakSet.prototype.has.bind(retryableX509IssuerErrors);

/** Brands only clients whose transport capability was successfully validated. */
export const markApprovedX509Client = WeakSet.prototype.add.bind(approvedX509Clients);

/** Recognizes immutable client ownership across mixed CommonJS and ESM helpers. */
export const isApprovedX509Client = WeakSet.prototype.has.bind(approvedX509Clients);

/** Records the sanitized OAuth response without trusting mutable public error properties. */
export const rememberX509OAuthError = WeakMap.prototype.set.bind(approvedX509OAuthErrors);

/** Retrieves trusted OAuth metadata for public cross-module error normalization. */
export const findX509OAuthError = WeakMap.prototype.get.bind(approvedX509OAuthErrors);

/** Privately binds SDK-owned credentials to their immutable identity and approved transport. */
export const rememberX509Credential = WeakMap.prototype.set.bind(approvedX509Credentials);

/** Resolves only first-class credentials created by the optional Node transport helper. */
export const findX509Credential = WeakMap.prototype.get.bind(approvedX509Credentials);
