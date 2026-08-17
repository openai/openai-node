import { OpenAIError } from '../../core/error';
import type { MergedRequestInit } from '../types';
import { readEnv } from '../utils/env';
import { hasOwn } from '../utils/values';

const MUTABLE_TLS_OPTION_KEYS = ['ca', 'cert', 'crl', 'key', 'pfx', 'secureContext'] as const;
const CLIENT_CERTIFICATE_OPTION_KEYS = ['cert', 'key', 'pfx'] as const;

const TOP_LEVEL_TLS_SOURCE = Object.freeze({});
const UNDICI_AGENT_TLS_SOURCE = Object.freeze({});
const UNDICI_PROXY_REQUEST_TLS_SOURCE = Object.freeze({});
const UNDICI_PROXY_TLS_SOURCE = Object.freeze({});
const UNDICI_PROXY_OPTIONS_SOURCE = Object.freeze({});
const NO_DEFAULT_FACTORY = Object.freeze({});
const defaultUndiciAgentFactories = new WeakMap<object, unknown>();

export interface X509TransportIdentitySource {
  key: object;
  options: Record<string, unknown>;
  owner: object;
}

function ownSymbol(target: object, description: string): symbol | undefined {
  // Undici does not expose the effective Agent/ProxyAgent TLS configuration through
  // a public API. These descriptions are verified against the installed runtime in
  // tests; executable dispatchers with an unknown future shape fail closed below.
  return Object.getOwnPropertySymbols(target).find((symbol) => symbol.description === description);
}

function symbolValue(target: object, symbol: symbol): unknown {
  return (target as Record<PropertyKey, unknown>)[symbol];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function hasClientCertificate(options: Record<string, unknown> | undefined): boolean {
  return (
    options !== undefined &&
    CLIENT_CERTIFICATE_OPTION_KEYS.some(
      (key) => hasOwn(options, key) && options[key] !== undefined && options[key] !== null,
    )
  );
}

function assertImmutableTLSOptions(options: Record<string, unknown>, label: string): void {
  for (const key of MUTABLE_TLS_OPTION_KEYS) {
    const value = options[key];
    if (value !== undefined && value !== null && (typeof value === 'object' || typeof value === 'function')) {
      throw new OpenAIError(
        `X.509 workload identity requires immutable string TLS ${key} values; mutable ${label} containers are not supported.`,
      );
    }
  }
}

function optionalTLSOptions(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new OpenAIError(`X.509 workload identity cannot verify ${label}.`);
  }
  return value;
}

function identitySource(key: object, options: Record<string, unknown>): X509TransportIdentitySource {
  return { key, options, owner: options };
}

async function closeProbe(probe: object): Promise<void> {
  const { close } = probe as { close?: unknown };
  if (typeof close !== 'function') {
    return;
  }
  try {
    await close.call(probe);
  } catch {
    // A no-connection probe is best-effort cleanup. Failure makes the live shape
    // unsupported only when its default factory cannot be established below.
  }
}

function defaultUndiciAgentFactory(dispatcher: object): unknown {
  const { constructor } = dispatcher as { constructor?: unknown };
  if (typeof constructor !== 'function') {
    return NO_DEFAULT_FACTORY;
  }
  if (defaultUndiciAgentFactories.has(constructor)) {
    return defaultUndiciAgentFactories.get(constructor);
  }

  let defaultFactory: unknown = NO_DEFAULT_FACTORY;
  try {
    const probe = Reflect.construct(constructor, []) as object;
    const factorySymbol = ownSymbol(probe, 'factory');
    if (factorySymbol) {
      defaultFactory = symbolValue(probe, factorySymbol);
    }
    void closeProbe(probe);
  } catch {
    // Recognized Agent shapes whose default factory cannot be established are
    // rejected rather than guessed safe.
  }
  defaultUndiciAgentFactories.set(constructor, defaultFactory);
  return defaultFactory;
}

function undiciAgentIdentitySource(dispatcher: object): X509TransportIdentitySource | undefined {
  const optionsSymbol = ownSymbol(dispatcher, 'options');
  const factorySymbol = ownSymbol(dispatcher, 'factory');
  const clientsSymbol = ownSymbol(dispatcher, 'clients');
  if (!optionsSymbol || !factorySymbol || !clientsSymbol) {
    return undefined;
  }

  const options = symbolValue(dispatcher, optionsSymbol);
  const factory = symbolValue(dispatcher, factorySymbol);
  if (!isObject(options)) {
    throw new OpenAIError('X.509 workload identity cannot verify this Undici Agent configuration.');
  }
  if (typeof options['connect'] === 'function') {
    throw new OpenAIError(
      'X.509 workload identity does not support dynamic Undici connectors; use static TLS connect options.',
    );
  }
  if (factory !== defaultUndiciAgentFactory(dispatcher)) {
    throw new OpenAIError(
      'X.509 workload identity does not support custom Undici origin factories; use the default static Agent factory.',
    );
  }
  if (options['connect'] === undefined) {
    return undefined;
  }
  if (!isObject(options['connect'])) {
    throw new OpenAIError('X.509 workload identity requires static Undici TLS connect options.');
  }
  assertImmutableTLSOptions(options['connect'], 'Undici Agent TLS');
  return identitySource(UNDICI_AGENT_TLS_SOURCE, options['connect']);
}

function undiciProxyIdentitySources(dispatcher: object): X509TransportIdentitySource[] | undefined {
  const proxyOptionsSymbol = ownSymbol(dispatcher, 'proxy agent options');
  const requestTLSSymbol = ownSymbol(dispatcher, 'request tls settings');
  const proxyTLSSymbol = ownSymbol(dispatcher, 'proxy tls settings');
  if (!proxyOptionsSymbol || !requestTLSSymbol || !proxyTLSSymbol) {
    return undefined;
  }

  const requestTLS = optionalTLSOptions(
    symbolValue(dispatcher, requestTLSSymbol),
    'Undici ProxyAgent request TLS',
  );
  const proxyTLS = optionalTLSOptions(symbolValue(dispatcher, proxyTLSSymbol), 'Undici ProxyAgent proxy TLS');
  const proxyOptions = symbolValue(dispatcher, proxyOptionsSymbol);
  if (!isObject(proxyOptions)) {
    throw new OpenAIError('X.509 workload identity cannot verify this Undici ProxyAgent configuration.');
  }
  if (requestTLS) {
    assertImmutableTLSOptions(requestTLS, 'Undici ProxyAgent request TLS');
  }
  if (proxyTLS) {
    assertImmutableTLSOptions(proxyTLS, 'Undici ProxyAgent proxy TLS');
    if (hasClientCertificate(proxyTLS)) {
      throw new OpenAIError(
        'X.509 workload identity client certificates must remain in ProxyAgent requestTls and must not be configured in proxyTls.',
      );
    }
  }

  return [
    ...(requestTLS ? [identitySource(UNDICI_PROXY_REQUEST_TLS_SOURCE, requestTLS)] : []),
    ...(proxyTLS ? [identitySource(UNDICI_PROXY_TLS_SOURCE, proxyTLS)] : []),
    identitySource(UNDICI_PROXY_OPTIONS_SOURCE, proxyOptions),
  ];
}

function assertNoOpaqueExecutableTransport(
  fetchOptions: MergedRequestInit,
  recognizedDispatcher: boolean,
): void {
  const runtimeFetchOptions = fetchOptions as Record<string, unknown>;
  for (const key of ['agent', 'client'] as const) {
    const transport = runtimeFetchOptions[key];
    if (
      isObject(transport) &&
      ['dispatch', 'addRequest', 'createConnection', 'request'].some(
        (method) => typeof transport[method] === 'function',
      )
    ) {
      throw new OpenAIError(
        `X.509 workload identity does not support opaque ${key} transports; use a static Undici Agent or ProxyAgent configuration.`,
      );
    }
  }

  const { dispatcher } = runtimeFetchOptions;
  if (!recognizedDispatcher && isObject(dispatcher) && typeof dispatcher['dispatch'] === 'function') {
    throw new OpenAIError(
      'X.509 workload identity cannot verify this executable dispatcher; use a static Undici Agent or ProxyAgent configuration.',
    );
  }
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: { version?: unknown } }).Bun?.version === 'string';
}

function bunProxyValue(fetchOptions: MergedRequestInit | undefined): unknown {
  if (
    fetchOptions &&
    hasOwn(fetchOptions, 'proxy') &&
    fetchOptions.proxy !== undefined &&
    fetchOptions.proxy !== null
  ) {
    return fetchOptions.proxy;
  }
  return readEnv('HTTPS_PROXY') ?? readEnv('https_proxy') ?? readEnv('ALL_PROXY') ?? readEnv('all_proxy');
}

function bunProxyURL(value: unknown): URL | undefined {
  if (value === undefined || value === null || value === false || value === '') {
    return undefined;
  }
  let urlValue: unknown = value;
  if (isObject(value) && !(value instanceof URL)) {
    urlValue = value['url'];
  }
  if (typeof urlValue !== 'string' && !(urlValue instanceof URL)) {
    throw new OpenAIError('X.509 workload identity cannot verify the configured Bun proxy.');
  }
  try {
    return new URL(urlValue);
  } catch {
    throw new OpenAIError('X.509 workload identity requires an absolute Bun proxy URL.');
  }
}

function assertBunProxyIsolation(fetchOptions: MergedRequestInit | undefined): void {
  if (!isBunRuntime()) {
    return;
  }
  const proxy = bunProxyURL(bunProxyValue(fetchOptions));
  if (proxy?.protocol === 'https:') {
    throw new OpenAIError(
      'X.509 workload identity does not support Bun HTTPS proxies because destination client certificates may be presented to the proxy; use an HTTP CONNECT proxy or a transport with separate proxy TLS.',
    );
  }
  if (proxy && proxy.protocol !== 'http:') {
    throw new OpenAIError('X.509 workload identity only supports HTTP CONNECT proxies in Bun.');
  }
}

/** Resolves the static TLS state that authorizes X.509 exchange, cache, and dispatch. */
export function x509TransportIdentitySources(
  fetchOptions: MergedRequestInit | undefined,
): readonly X509TransportIdentitySource[] {
  assertBunProxyIsolation(fetchOptions);
  if (!fetchOptions) {
    return [];
  }

  const runtimeFetchOptions = fetchOptions as Record<string, unknown>;
  const sources: X509TransportIdentitySource[] = [];
  if (hasOwn(fetchOptions, 'tls') && runtimeFetchOptions['tls'] !== undefined) {
    if (!isObject(runtimeFetchOptions['tls'])) {
      throw new OpenAIError('X.509 workload identity requires static TLS options.');
    }
    assertImmutableTLSOptions(runtimeFetchOptions['tls'], 'TLS');
    sources.push(identitySource(TOP_LEVEL_TLS_SOURCE, runtimeFetchOptions['tls']));
  }

  let recognizedDispatcher = false;
  if (isObject(fetchOptions.dispatcher)) {
    const proxySources = undiciProxyIdentitySources(fetchOptions.dispatcher);
    if (proxySources) {
      recognizedDispatcher = true;
      sources.push(...proxySources);
    } else {
      recognizedDispatcher =
        ownSymbol(fetchOptions.dispatcher, 'options') !== undefined &&
        ownSymbol(fetchOptions.dispatcher, 'factory') !== undefined &&
        ownSymbol(fetchOptions.dispatcher, 'clients') !== undefined;
      const agentSource = undiciAgentIdentitySource(fetchOptions.dispatcher);
      if (agentSource) {
        sources.push(agentSource);
      }
    }
  }
  assertNoOpaqueExecutableTransport(fetchOptions, recognizedDispatcher);

  const certificateSources = sources.filter((source) => hasClientCertificate(source.options));
  if (certificateSources.length > 1) {
    throw new OpenAIError(
      'X.509 workload identity requires one unambiguous client-certificate source across token and API requests.',
    );
  }
  return sources;
}

export function x509TransportIdentityValues(source: X509TransportIdentitySource): readonly unknown[] {
  const keys = Object.keys(source.options);
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys creates a private array; ES2023 toSorted would break TS 4.9 consumers.
  keys.sort();
  // The shape participates in generation identity so removing and later restoring
  // a primitive option cannot revive the bearer cached before the removal.
  return [JSON.stringify(keys), ...keys.flatMap((key) => [key, source.options[key]])];
}
