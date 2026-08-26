import { types } from 'node:util';
import { Agent, ProxyAgent, Request, fetch } from 'undici';
import { OpenAIError } from '../../core/error';
import { x509TransportBrand } from './x509-transport-registry';
import type { RegisteredX509Transport, X509Transport } from './x509-transport-registry';
import { findRegisteredX509Transport, rememberRegisteredX509Transport } from '#x509-transport-state';

export type { X509Transport } from './x509-transport-registry';

/** Explicitly supported, application-owned Undici proxy configurations. */
export type X509ProxyMode = 'direct' | 'http-connect' | 'https-connect';

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
const transportBrand: typeof x509TransportBrand = x509TransportBrand;
let originalAgentFactory: unknown;

class NodeX509Transport implements X509Transport {
  declare readonly [transportBrand]: true;

  readonly #dispatcher: Agent | ProxyAgent;
  readonly #proxy: X509ProxyMode;

  constructor(dispatcher: Agent | ProxyAgent, proxy: X509ProxyMode) {
    this.#dispatcher = dispatcher;
    this.#proxy = proxy;
    Object.freeze(this);
  }

  static dispatcher(value: object): Agent | ProxyAgent | undefined {
    return #dispatcher in value ? value.#dispatcher : undefined;
  }

  static proxy(value: object): X509ProxyMode | undefined {
    return #proxy in value ? value.#proxy : undefined;
  }
}

/** Registers only a genuine frozen capability whose JavaScript private dispatcher cannot be forged. */
export function registerX509Transport(transport: X509Transport, registered: RegisteredX509Transport): void {
  if (
    !transport ||
    typeof transport !== 'object' ||
    types.isProxy(transport) ||
    !Object.isFrozen(transport) ||
    !NodeX509Transport.dispatcher(transport)
  ) {
    throw new OpenAIError('Only a genuine frozen X.509 transport capability can be registered.');
  }
  if (findRegisteredX509Transport(transport)) {
    throw new OpenAIError('An approved X.509 transport capability cannot be registered more than once.');
  }
  rememberRegisteredX509Transport(transport, Object.freeze(registered));
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

function undiciState(dispatcher: Agent | ProxyAgent, name: string): unknown {
  const symbol = Object.getOwnPropertySymbols(dispatcher).find((candidate) => candidate.description === name);
  return symbol ? Object.getOwnPropertyDescriptor(dispatcher, symbol)?.value : undefined;
}

function assertVerifiedTLS(value: unknown): void {
  if (value === undefined || value === null) {
    if (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') {
      throw new Error('X.509 transport requires explicit TLS server certificate verification.');
    }
    return;
  }
  if (typeof value !== 'object' || types.isProxy(value)) {
    throw new Error('X.509 transport requires inspectable TLS server-verification settings.');
  }
  const verification = Object.getOwnPropertyDescriptor(value, 'rejectUnauthorized');
  if (
    (verification && (!('value' in verification) || verification.value === false)) ||
    (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0' && verification?.value !== true)
  ) {
    throw new Error('X.509 transport requires TLS server certificate verification.');
  }
}

function assertDispatcherTrust(dispatcher: Agent | ProxyAgent, proxy: X509ProxyMode): void {
  if (dispatcher instanceof ProxyAgent) {
    const configuration = undiciState(dispatcher, 'proxy agent options');
    if (!configuration || typeof configuration !== 'object') {
      throw new Error('X.509 transport requires inspectable CONNECT proxy configuration.');
    }
    const uri: unknown =
      configuration instanceof URL
        ? URL.prototype.toString.call(configuration)
        : Object.getOwnPropertyDescriptor(configuration, 'uri')?.value;
    let protocol: string;
    try {
      if (typeof uri !== 'string' && !(uri instanceof URL)) {
        throw new Error('Invalid proxy URI');
      }
      ({ protocol } = new URL(typeof uri === 'string' ? uri : URL.prototype.toString.call(uri)));
    } catch {
      throw new Error('X.509 transport requires an approved CONNECT proxy endpoint.');
    }
    if (protocol !== (proxy === 'https-connect' ? 'https:' : 'http:')) {
      throw new Error('X.509 CONNECT proxy protocol must match its configured proxy mode.');
    }
    assertVerifiedTLS(undiciState(dispatcher, 'request tls settings'));
    if (proxy === 'https-connect') {
      assertVerifiedTLS(undiciState(dispatcher, 'proxy tls settings'));
    }
    return;
  }

  const configuration = undiciState(dispatcher, 'options');
  if (!configuration || typeof configuration !== 'object') {
    throw new Error('X.509 transport requires inspectable certificate transport configuration.');
  }
  if (originalAgentFactory === undefined) {
    const baseline = new Agent();
    originalAgentFactory = undiciState(baseline, 'factory');
    void baseline.close();
  }
  if (originalAgentFactory === undefined || undiciState(dispatcher, 'factory') !== originalAgentFactory) {
    throw new Error('X.509 transport does not support a custom dispatcher factory.');
  }
  assertVerifiedTLS(Object.getOwnPropertyDescriptor(configuration, 'connect')?.value);
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

  assertDispatcherTrust(dispatcher, proxy);

  return dispatcher;
}

function assertRequestDispatcherSupport(dispatcher: Agent | ProxyAgent): void {
  let observesRequestDispatcher = false;

  // about:blank never reaches the network; the getter checks the actual fetch contract.
  void Promise.allSettled([
    fetch('about:blank', {
      get dispatcher() {
        observesRequestDispatcher = true;
        return dispatcher;
      },
    }),
  ]);

  if (!observesRequestDispatcher) {
    throw new Error('X.509 transport requires Undici 5.2.0 or later with per-request dispatcher support.');
  }
}

function assertConnectProxySupport(): void {
  const targetOrigin = 'https://127.0.0.1:65535';
  let routedOrigin: string | undefined;
  const probe = new ProxyAgent({
    uri: 'http://127.0.0.1:1',
    factory(origin) {
      routedOrigin = String(origin);
      throw new Error('X.509 CONNECT capability probe');
    },
  });

  // The throwing factory reveals the actual routing decision before any socket opens.
  const request = fetch(targetOrigin, { dispatcher: probe });
  void Promise.allSettled([request, probe.close()]);

  if (routedOrigin !== targetOrigin) {
    throw new Error('X.509 CONNECT proxy requires Undici 5.5.1 or later with target TLS tunneling.');
  }
}

/**
 * Creates a frozen, opaque capability for one caller-owned Undici transport.
 *
 * Existing caller-owned dispatchers remain supported only when their effective
 * TLS settings preserve server verification and their actual CONNECT protocol
 * matches the declared mode. Prefer the SDK-owned `fromX509` credential, which
 * constructs verified target and proxy TLS settings from explicit configuration.
 * Rotation requires creating a fresh dispatcher and capability; the caller
 * remains responsible for draining caller-owned dispatchers.
 *
 * This Node-only preview entrypoint requires the optional `undici` peer at
 * version 5.2.0 or later. CONNECT proxy modes require version 5.5.1 or
 * later; ordinary SDK clients retain broader compatibility.
 */
export function createX509Transport(options: X509TransportOptions): X509Transport {
  assertNodeRuntime();

  if (!options || typeof options !== 'object' || types.isProxy(options)) {
    throw new Error('X.509 transport configuration must be a non-proxy object.');
  }

  for (const name of Reflect.ownKeys(options)) {
    if (typeof name !== 'string' || !allowedOptionNames.has(name)) {
      throw new Error(`Unsupported X.509 transport option: \`${String(name)}\`.`);
    }
  }

  if (dataOption(options, 'runtime') !== 'node') {
    throw new Error('X.509 transport requires an explicitly attested Node.js runtime.');
  }

  if (dataOption(options, 'certificateIdentity') !== 'static') {
    throw new Error('X.509 transport requires an explicitly attested static client certificate.');
  }

  const dispatcher = attestedDispatcher(options);
  assertRequestDispatcherSupport(dispatcher);
  if (dispatcher instanceof ProxyAgent) {
    assertConnectProxySupport();
  }
  return new NodeX509Transport(dispatcher, dataOption(options, 'proxy') as X509ProxyMode);
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
  const proxy = NodeX509Transport.proxy(transport);
  if (!proxy) {
    throw new Error('Invalid X.509 transport capability.');
  }
  assertDispatcherTrust(dispatcher, proxy);

  const normalizedTarget = new URL(target.href);
  if (normalizedTarget.protocol !== 'https:') {
    throw new Error('X.509 transport requires an HTTPS destination.');
  }

  if (Object.getOwnPropertyDescriptor(options, 'dispatcher')) {
    throw new Error('X.509 transport does not allow a per-request dispatcher override.');
  }

  const requestOptions: Omit<RequestInit, 'dispatcher'> = options;
  const request = new Request(normalizedTarget, requestOptions);
  const response = await fetch(request, { dispatcher, redirect: 'manual' });
  return response;
}
