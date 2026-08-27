import { AsyncLocalStorage } from 'node:async_hooks';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { types } from 'node:util';
import { Agent, ProxyAgent } from 'undici';
import {
  createX509Transport as createCapability,
  registerX509Transport,
  sendX509Request,
} from '../internal/auth/x509-transport-capability';
import type {
  X509ProxyMode,
  X509Transport,
  X509TransportOptions,
} from '../internal/auth/x509-transport-capability';
import { exchangeX509Token } from '../internal/auth/x509-token-exchange';
import { isRetryableX509TransportFailure } from '../internal/auth/x509-transport-registry';
import type { X509RequestScope } from '../internal/auth/x509-transport-registry';
import { markTransientX509ConnectionError, rememberX509Credential } from '#x509-transport-state';
import type { X509Credential, X509WorkloadIdentity } from './types';

/** Explicit, separately trusted CONNECT configuration for an SDK-owned X.509 credential. */
export interface X509CredentialProxyOptions {
  /** CONNECT proxy endpoint; its protocol must match the selected mode. */
  url: string | URL;

  /** Whether the connection to the CONNECT proxy itself is encrypted. */
  mode: Exclude<X509ProxyMode, 'direct'>;

  /** Optional private trust roots for the HTTPS proxy; never used for workload TLS. */
  ca?: string | string[] | undefined;
}

/** Private certificate material and enrolled selectors for one SDK-owned workload credential. */
export interface X509CredentialOptions {
  /** Leaf client certificate followed by its required PEM intermediate chain. */
  certificateChain: string;

  /** PEM private key matching the leaf client certificate. */
  privateKey: string;

  /** Existing OpenAI identity-provider resource enrolled for the certificate. */
  identityProviderId: string;

  /** OpenAI service account authorized for the verified certificate identity. */
  serviceAccountId: string;

  /** Optional private certificate authorities trusted for OpenAI's issuer and API. */
  ca?: string | string[] | undefined;

  /** Optional passphrase used to decrypt an encrypted PEM private key. */
  passphrase?: string | undefined;

  /** Optional CONNECT proxy with separately scoped target and proxy TLS settings. */
  proxy?: X509CredentialProxyOptions | undefined;

  /** Seconds before expiration when access-token refresh begins; defaults to 1,200. */
  refreshBufferSeconds?: number | undefined;
}

const credentialOptionNames = new Set([
  'certificateChain',
  'privateKey',
  'identityProviderId',
  'serviceAccountId',
  'ca',
  'passphrase',
  'proxy',
  'refreshBufferSeconds',
]);
const proxyOptionNames = new Set(['url', 'mode', 'ca']);

function safeOptionRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value)) {
    throw new Error(`X.509 ${label} options must be a non-proxy object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`X.509 ${label} options must have only own plain data properties.`);
  }
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== 'string' || !allowed.has(name)) {
      throw new Error(`Unsupported X.509 ${label} option: \`${String(name)}\`.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`X.509 ${label} option \`${name}\` must be a plain data property.`);
    }
    snapshot[name] = descriptor.value;
  }
  return snapshot;
}

function requiredCredentialValue(options: Record<string, unknown>, name: string): string {
  const value = options[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`X.509 credential requires a nonempty own \`${name}\` value.`);
  }
  return value;
}

function snapshotCertificateAuthorities(value: unknown): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error('X.509 certificate authorities must contain nonempty PEM values.');
    }
    return value;
  }
  if (!Array.isArray(value) || types.isProxy(value) || value.length === 0) {
    throw new Error('X.509 certificate authorities must be a PEM string or plain PEM string array.');
  }
  const authorities: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !('value' in entry) || typeof entry.value !== 'string' || entry.value.trim().length === 0) {
      throw new Error('X.509 certificate authorities require own plain nonempty PEM strings.');
    }
    authorities.push(entry.value);
  }
  return authorities;
}

class OwnedX509Credential implements X509Credential {
  readonly #dispatcher: Agent | ProxyAgent;
  #closing: Promise<void> | undefined;

  constructor(dispatcher: Agent | ProxyAgent) {
    this.#dispatcher = dispatcher;
    Object.freeze(this);
  }

  /** Closes this credential's owned transport once all in-flight requests have drained. */
  close(): Promise<void> {
    this.#closing ??= this.#dispatcher.close();
    return this.#closing;
  }
}

interface ValidatedX509CredentialOptions {
  certificateChain: string;
  privateKey: string;
  identityProviderId: string;
  serviceAccountId: string;
  refreshBufferSeconds: number | undefined;
  passphrase: string | undefined;
  ca: string | string[] | undefined;
  proxy: unknown;
}

function validatedCredentialOptions(options: X509CredentialOptions): ValidatedX509CredentialOptions {
  const configured = safeOptionRecord(options, credentialOptionNames, 'credential');
  const certificateChain = requiredCredentialValue(configured, 'certificateChain');
  const privateKeyPEM = requiredCredentialValue(configured, 'privateKey');
  const identityProviderId = requiredCredentialValue(configured, 'identityProviderId');
  const serviceAccountId = requiredCredentialValue(configured, 'serviceAccountId');
  const { refreshBufferSeconds, passphrase } = configured;
  if (passphrase !== undefined && typeof passphrase !== 'string') {
    throw new Error('X.509 credential requires a string private-key passphrase.');
  }
  if (
    refreshBufferSeconds !== undefined &&
    (typeof refreshBufferSeconds !== 'number' ||
      !Number.isSafeInteger(refreshBufferSeconds) ||
      refreshBufferSeconds < 0 ||
      !Number.isSafeInteger(refreshBufferSeconds * 1000))
  ) {
    throw new Error('X.509 credential requires a nonnegative integer refreshBufferSeconds.');
  }
  const ca = snapshotCertificateAuthorities(configured['ca']);

  const leaf = new X509Certificate(certificateChain);
  const privateKey = createPrivateKey({
    key: privateKeyPEM,
    ...(passphrase === undefined ? {} : { passphrase }),
  });
  if (!leaf.checkPrivateKey(privateKey)) {
    throw new Error('X.509 credential private key must match its leaf client certificate.');
  }

  return {
    certificateChain,
    privateKey: privateKeyPEM,
    identityProviderId,
    serviceAccountId,
    refreshBufferSeconds,
    passphrase,
    ca,
    proxy: configured['proxy'],
  };
}

interface VerifiedX509TLSOptions {
  cert: string;
  key: string;
  rejectUnauthorized: true;
  passphrase?: string;
  ca?: string | string[];
}

function proxyAuthentication(url: URL): string | undefined {
  if (url.username === '' && url.password === '') {
    return undefined;
  }
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('X.509 CONNECT proxy credentials contain invalid URL encoding.');
  }
  if (username.includes(':')) {
    throw new Error('X.509 CONNECT proxy username cannot contain a colon.');
  }
  return Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
}

function normalizeProxyURL(value: unknown): URL {
  if (typeof value !== 'string' && (typeof value !== 'object' || value === null || types.isProxy(value))) {
    throw new Error('X.509 CONNECT proxy requires an own URL string or URL value.');
  }
  try {
    return new URL(typeof value === 'string' ? value : URL.prototype.toString.call(value));
  } catch {
    throw new Error('X.509 CONNECT proxy requires a valid proxy URL.');
  }
}

function credentialDispatcher(
  proxyOptionsInput: unknown,
  requestTls: VerifiedX509TLSOptions,
): { dispatcher: Agent | ProxyAgent; proxy: X509ProxyMode } {
  if (proxyOptionsInput === undefined) {
    return { dispatcher: new Agent({ connect: requestTls }), proxy: 'direct' };
  }

  const proxyOptions = safeOptionRecord(proxyOptionsInput, proxyOptionNames, 'proxy');
  const url = normalizeProxyURL(proxyOptions['url']);
  const selected = proxyOptions['mode'];
  const proxy: X509ProxyMode =
    selected === 'http-connect' || selected === 'https-connect' ? selected : 'direct';
  if (
    (proxy !== 'http-connect' && proxy !== 'https-connect') ||
    url.protocol !== (proxy === 'https-connect' ? 'https:' : 'http:') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('X.509 CONNECT proxy URL protocol must match its selected secure proxy mode.');
  }
  const proxyCA = snapshotCertificateAuthorities(proxyOptions['ca']);
  if (proxy === 'http-connect' && proxyCA !== undefined) {
    throw new Error('A plaintext X.509 CONNECT proxy cannot configure proxy TLS authorities.');
  }
  const auth = proxyAuthentication(url);

  return {
    proxy,
    dispatcher: new ProxyAgent({
      uri: url.href,
      ...(auth === undefined ? {} : { auth }),
      requestTls,
      ...(proxy === 'https-connect'
        ? {
            proxyTls: {
              rejectUnauthorized: true,
              ...(proxyCA === undefined ? {} : { ca: proxyCA }),
            },
          }
        : {}),
    }),
  };
}

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

/** Creates a first-class certificate credential with SDK-owned, verified TLS and CONNECT policy. */
export function fromX509(options: X509CredentialOptions): X509Credential {
  const configured = validatedCredentialOptions(options);

  const requestTls = {
    cert: configured.certificateChain,
    key: configured.privateKey,
    rejectUnauthorized: true as const,
    ...(configured.passphrase === undefined ? {} : { passphrase: configured.passphrase }),
    ...(configured.ca === undefined ? {} : { ca: configured.ca }),
  };
  const { dispatcher, proxy } = credentialDispatcher(configured.proxy, requestTls);

  try {
    const transport = createX509Transport({
      runtime: 'node',
      dispatcher,
      certificateIdentity: 'static',
      proxy,
    });
    const identity: X509WorkloadIdentity = Object.freeze({
      type: 'x509',
      identityProviderId: configured.identityProviderId,
      serviceAccountId: configured.serviceAccountId,
      ...(configured.refreshBufferSeconds === undefined
        ? {}
        : { refreshBufferSeconds: configured.refreshBufferSeconds }),
    });
    const credential = new OwnedX509Credential(dispatcher);
    rememberX509Credential(credential, Object.freeze({ identity, transport }));
    return credential;
  } catch (error) {
    void dispatcher.close();
    throw error;
  }
}

/** Namespaced first-class credential factory, isolated from ordinary browser-safe auth imports. */
export const workloadIdentity = Object.freeze({ fromX509 });

export type {
  X509ProxyMode,
  X509Transport,
  X509TransportOptions,
} from '../internal/auth/x509-transport-capability';
