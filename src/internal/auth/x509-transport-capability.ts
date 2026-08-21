import { types } from 'node:util';
import undici, { Agent, ProxyAgent, fetch } from 'undici';

declare const x509TransportBrand: unique symbol;

/** Explicitly supported, application-owned Undici proxy configurations. */
export type X509ProxyMode = 'direct' | 'http-connect' | 'https-connect';

/** An opaque, immutable X.509 transport identity created by {@link createX509Transport}. */
export interface X509Transport {
  /** Prevents ordinary objects from being accepted as X.509 transport capabilities. */
  readonly [x509TransportBrand]: true;
}

/** Application attestation for one caller-owned static-certificate Undici transport. */
export interface X509TransportOptions {
  /** X.509 transport currently supports genuine Node.js runtimes only. */
  runtime: 'node';

  /** Caller-owned Undici Agent or ProxyAgent; the SDK never closes or inspects it. */
  dispatcher: Agent | ProxyAgent;

  /** Attests that the dispatcher uses one static workload-certificate identity. */
  certificateIdentity: 'static';

  /** Attests that proxy TLS and CONNECT credentials are independently configured. */
  proxy: X509ProxyMode;
}

const allowedOptionNames = new Set(['runtime', 'dispatcher', 'certificateIdentity', 'proxy']);

class NodeX509Transport implements X509Transport {
  declare readonly [x509TransportBrand]: true;

  readonly #dispatcher: Agent | ProxyAgent;

  constructor(dispatcher: Agent | ProxyAgent) {
    this.#dispatcher = dispatcher;
    Object.freeze(this);
  }

  static dispatcher(value: object): Agent | ProxyAgent | undefined {
    return #dispatcher in value ? value.#dispatcher : undefined;
  }
}

function dataOption(options: X509TransportOptions, name: keyof X509TransportOptions): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, name);
  if (!descriptor || !('value' in descriptor)) {
    throw new Error(`X.509 transport option \`${name}\` must be an own plain data property.`);
  }
  return descriptor.value;
}

function assertNodeRuntime(): void {
  if (
    typeof process === 'undefined' ||
    process.release.name !== 'node' ||
    'bun' in process.versions ||
    'Bun' in globalThis ||
    'Deno' in globalThis
  ) {
    throw new Error('X.509 transport requires a genuine Node.js runtime.');
  }
}

function attestedDispatcher(options: X509TransportOptions): Agent | ProxyAgent {
  const dispatcher = dataOption(options, 'dispatcher');
  if (!dispatcher || typeof dispatcher !== 'object') {
    throw new Error('X.509 transport requires a caller-owned Undici Agent or ProxyAgent.');
  }
  if (types.isProxy(dispatcher)) {
    throw new Error('X.509 transport does not accept a dispatcher proxy.');
  }

  const isDirect = dispatcher instanceof Agent;
  const isConnect = dispatcher instanceof ProxyAgent;
  if (!isDirect && !isConnect) {
    throw new Error('X.509 transport requires a caller-owned Undici Agent or ProxyAgent.');
  }

  const proxy = dataOption(options, 'proxy');
  if (proxy !== 'direct' && proxy !== 'http-connect' && proxy !== 'https-connect') {
    throw new Error('X.509 transport requires an explicitly supported proxy mode.');
  }
  if ((proxy === 'direct') !== isDirect) {
    throw new Error('An X.509 CONNECT proxy requires an Undici ProxyAgent.');
  }

  return dispatcher;
}

/**
 * Creates a frozen, opaque capability for one caller-owned Undici transport.
 *
 * `certificateIdentity: 'static'` is an application attestation: the SDK does
 * not inspect certificates, private dispatcher internals, callbacks, or TLS
 * options and cannot cryptographically prove certificate selection. Configure
 * one static identity without custom dispatcher factories. For HTTPS CONNECT,
 * independently configure `proxyTls` and `requestTls` so workload credentials
 * never reach the proxy. Rotation requires creating a fresh dispatcher and
 * capability; the application remains responsible for draining the old one.
 *
 * This Node-only preview entrypoint requires the optional `undici` peer.
 */
export function createX509Transport(options: X509TransportOptions): X509Transport {
  assertNodeRuntime();

  // Undici introduced this public export in v7; v5 and v6 do not provide it.
  if (!Object.getOwnPropertyDescriptor(undici, 'cacheStores')) {
    throw new Error('X.509 transport requires Undici 7 or 8.');
  }

  if (!options || typeof options !== 'object' || types.isProxy(options)) {
    throw new Error('X.509 transport configuration must be a non-proxy object.');
  }

  for (const name of Object.keys(options)) {
    if (!allowedOptionNames.has(name)) {
      throw new Error(`Unsupported X.509 transport option: \`${name}\`.`);
    }
  }

  if (dataOption(options, 'runtime') !== 'node') {
    throw new Error('X.509 transport requires an explicitly attested Node.js runtime.');
  }

  if (dataOption(options, 'certificateIdentity') !== 'static') {
    throw new Error('X.509 transport requires an explicitly attested static client certificate.');
  }

  return new NodeX509Transport(attestedDispatcher(options));
}

/** Dispatches through the opaque attested transport without accepting replacement dispatchers. */
export async function sendX509Request(
  transport: X509Transport,
  target: URL,
  options: RequestInit,
): Promise<Response> {
  if (!transport || typeof transport !== 'object' || types.isProxy(transport)) {
    throw new Error('Invalid X.509 transport capability.');
  }

  const dispatcher = NodeX509Transport.dispatcher(transport);
  if (!dispatcher) {
    throw new Error('Invalid X.509 transport capability.');
  }

  const normalizedTarget = new URL(target.href);
  if (normalizedTarget.protocol !== 'https:') {
    throw new Error('X.509 transport requires an HTTPS destination.');
  }

  if (Object.getOwnPropertyDescriptor(options, 'dispatcher')) {
    throw new Error('X.509 transport does not allow a per-request dispatcher override.');
  }

  const requestOptions: NonNullable<Parameters<typeof fetch>[1]> = Object.create(options);
  Object.defineProperties(requestOptions, {
    dispatcher: { value: dispatcher, enumerable: true },
    redirect: { value: 'manual', enumerable: true },
  });
  const response = await fetch(normalizedTarget, requestOptions);
  return response;
}
