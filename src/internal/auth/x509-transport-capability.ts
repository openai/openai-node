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

  /**
   * Caller-owned Undici Agent or ProxyAgent; the SDK never closes or inspects it.
   *
   * The application attests that its dispatcher, factories, TLS verification,
   * certificate selection, and CONNECT proxy configuration are trustworthy.
   * Use `fromX509` when the SDK should own and enforce transport configuration.
   */
  dispatcher: Agent | ProxyAgent;

  /** Attests that the dispatcher uses one static workload-certificate identity. */
  certificateIdentity: 'static';

  /** Attests that proxy TLS and CONNECT credentials are independently configured. */
  proxy: X509ProxyMode;
}

const allowedOptionNames = new Set(['runtime', 'dispatcher', 'certificateIdentity', 'proxy']);
const transportBrand: typeof x509TransportBrand = x509TransportBrand;

class NodeX509Transport implements X509Transport {
  declare readonly [transportBrand]: true;

  readonly #dispatcher: Agent | ProxyAgent;

  constructor(dispatcher: Agent | ProxyAgent) {
    this.#dispatcher = dispatcher;
    Object.freeze(this);
  }

  static dispatcher(value: object): Agent | ProxyAgent | undefined {
    return #dispatcher in value ? value.#dispatcher : undefined;
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
 * `certificateIdentity: 'static'` is an application attestation: the SDK does
 * not inspect certificates, private dispatcher internals, callbacks, or TLS
 * options and cannot cryptographically prove certificate selection. Configure
 * trusted dispatcher factories, verified target and proxy TLS, one static
 * certificate identity, and independently scoped CONNECT credentials.
 * Prefer the SDK-owned `fromX509` credential when these guarantees should be
 * enforced at construction. Rotation requires a fresh caller-owned dispatcher
 * and capability; the application remains responsible for draining it.
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
  return new NodeX509Transport(dispatcher);
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

  const requestOptions: Omit<RequestInit, 'dispatcher'> = options;
  const request = new Request(normalizedTarget, requestOptions);
  const response = await fetch(request, { dispatcher, redirect: 'manual' });
  return response;
}
