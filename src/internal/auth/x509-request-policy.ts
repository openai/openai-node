import { OpenAIError } from '../../core/error';
import type { RequestInfo, RequestInit } from '../builtin-types';
import { parseBedrockEndpointHostname } from '../bedrock';
import { castToError } from '../errors';
import type { MergedRequestInit, WorkloadIdentityRequestContext } from '../types';
import { hasOwn } from '../utils/values';
import { x509TransportIdentitySources, x509TransportIdentityValues } from './x509-transport-capability';
import type { X509TransportIdentitySource } from './x509-transport-capability';

const TRANSPORT_OPTION_KEYS = ['dispatcher', 'agent', 'client', 'tls', 'proxy'] as const;
const X509_HOOK_PROTECTED_OPTION_KEYS = [...TRANSPORT_OPTION_KEYS, 'redirect'] as const;
const FORBIDDEN_PROVIDER_HOST_SUFFIXES = [
  'openai.azure.com',
  'openai.azure.us',
  'services.ai.azure.com',
  'services.ai.azure.us',
  'azure-api.net',
  'cognitiveservices.azure.com',
  'cognitiveservices.azure.us',
] as const;

interface TransportIdentityNode {
  objects: WeakMap<object, TransportIdentityNode>;
  key: object | undefined;
}

interface PrimitiveTransportIdentitySlot {
  value: unknown;
  key: object;
}

function createTransportIdentityNode(): TransportIdentityNode {
  return { objects: new WeakMap(), key: undefined };
}

const transportIdentityRoot = createTransportIdentityNode();
const TRANSPORT_OPTIONS_SOURCE = Object.freeze({});
const undefinedTransportIdentity = Object.freeze({});
const nullTransportIdentity = Object.freeze({});
// Primitive values cannot be WeakMap keys. Their opaque tokens and source values live only as long as the
// fetchOptions/TLS object that already owns them, and replacing a slot releases the prior primitive value.
const primitiveTransportIdentities = new WeakMap<
  object,
  WeakMap<object, (PrimitiveTransportIdentitySlot | undefined)[]>
>();

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function stableTransportIdentity(value: unknown): object | undefined {
  if (isObjectIdentity(value)) {
    return value;
  }
  if (value === undefined) {
    return undefinedTransportIdentity;
  }
  if (value === null) {
    return nullTransportIdentity;
  }
  return undefined;
}

function transportIdentityChild(node: TransportIdentityNode, value: object): TransportIdentityNode {
  let child = node.objects.get(value);
  if (!child) {
    child = createTransportIdentityNode();
    node.objects.set(value, child);
  }
  return child;
}

function transportIdentityValue(owner: object, source: object, index: number, value: unknown): object {
  const existingSources = primitiveTransportIdentities.get(owner);
  const existingSlots = existingSources?.get(source);
  const stableIdentity = stableTransportIdentity(value);
  if (stableIdentity) {
    if (existingSlots) {
      existingSlots[index] = undefined;
    }
    return stableIdentity;
  }

  let sources = existingSources;
  if (!sources) {
    sources = new WeakMap();
    primitiveTransportIdentities.set(owner, sources);
  }
  let slots = sources.get(source);
  if (!slots) {
    slots = [];
    sources.set(source, slots);
  }
  const existing = slots[index];
  if (existing && Object.is(existing.value, value)) {
    return existing.key;
  }
  const slot = { value, key: Object.freeze({}) };
  slots[index] = slot;
  return slot.key;
}

function transportOption(options: MergedRequestInit, key: (typeof TRANSPORT_OPTION_KEYS)[number]): unknown {
  return hasOwn(options, key) ? (options as Record<string, unknown>)[key] : undefined;
}

function transportIdentityValues(
  options: MergedRequestInit | undefined,
  identitySources: readonly X509TransportIdentitySource[],
): readonly object[] | undefined {
  const values = options ? TRANSPORT_OPTION_KEYS.map((key) => transportOption(options, key)) : [];
  if (options && values.every((value) => value === undefined) && identitySources.length === 0) {
    primitiveTransportIdentities.delete(options);
    return undefined;
  }
  if (values.length === 0 && identitySources.length === 0) {
    return undefined;
  }
  const optionIdentities = options
    ? values.map((value, index) => transportIdentityValue(options, TRANSPORT_OPTIONS_SOURCE, index, value))
    : [];

  return [
    ...optionIdentities,
    ...identitySources.flatMap((source) => [
      source.key,
      source.owner,
      ...x509TransportIdentityValues(source).map((value, index) =>
        transportIdentityValue(source.owner, source.key, index, value),
      ),
    ]),
  ];
}

/** Returns the opaque runtime transport identity used to scope X.509 refresh state. */
export function x509TransportKey(fetchOptions: MergedRequestInit | undefined): object | undefined {
  const identitySources = x509TransportIdentitySources(fetchOptions);
  const values = transportIdentityValues(fetchOptions, identitySources);
  if (!values) {
    return undefined;
  }

  let node = transportIdentityRoot;
  for (const value of values) {
    node = transportIdentityChild(node, value);
  }
  node.key ??= Object.freeze({});
  return node.key;
}

/** Captures the request options that must remain stable across token acquisition and API dispatch. */
export function snapshotX509FetchOptions(
  fetchOptions: MergedRequestInit | undefined,
): MergedRequestInit | undefined {
  return fetchOptions ? ({ ...fetchOptions } as MergedRequestInit) : undefined;
}

/** Selects only transport options that are safe and necessary for the pinned token exchange. */
export function x509TokenExchangeFetchOptions(fetchOptions: MergedRequestInit | undefined): RequestInit {
  const selected: Record<string, unknown> = {};
  if (fetchOptions) {
    for (const key of TRANSPORT_OPTION_KEYS) {
      if (hasOwn(fetchOptions, key)) {
        selected[key] = (fetchOptions as Record<string, unknown>)[key];
      }
    }
  }
  return selected as RequestInit;
}

/** Checks that request hooks preserved every runtime transport option used by X.509 mode. */
export function hasSameX509Transport(expected: MergedRequestInit | undefined, actual: RequestInit): boolean {
  return TRANSPORT_OPTION_KEYS.every(
    (key) =>
      hasOwn(expected ?? {}, key) === hasOwn(actual, key) &&
      (expected as Record<string, unknown> | undefined)?.[key] === (actual as Record<string, unknown>)[key],
  );
}

/** Hides X.509 transport and redirect policy from request hooks, then restores them unchanged. */
export function protectX509RequestOptions(request: RequestInit): () => boolean {
  const requestOptions = request as Record<string, unknown>;
  const protectedOptions: { key: (typeof X509_HOOK_PROTECTED_OPTION_KEYS)[number]; value: unknown }[] = [];

  for (const key of X509_HOOK_PROTECTED_OPTION_KEYS) {
    if (hasOwn(requestOptions, key)) {
      protectedOptions.push({ key, value: requestOptions[key] });
      Reflect.deleteProperty(requestOptions, key);
    }
  }

  return () => {
    const changed = X509_HOOK_PROTECTED_OPTION_KEYS.some((key) => hasOwn(requestOptions, key));
    for (const key of X509_HOOK_PROTECTED_OPTION_KEYS) {
      Reflect.deleteProperty(requestOptions, key);
    }
    for (const option of protectedOptions) {
      requestOptions[option.key] = option.value;
    }
    return changed;
  };
}

/** Resolves and validates the origin allowed to receive X.509-authenticated API requests. */
export function x509APIOrigin(value: RequestInfo): string {
  let url: URL;
  try {
    let urlValue: string;
    if (typeof value === 'string') {
      urlValue = value;
    } else if (value instanceof URL) {
      urlValue = value.href;
    } else {
      urlValue = value.url;
    }
    url = new URL(urlValue);
  } catch {
    throw new OpenAIError('X.509 workload identity requires an absolute HTTPS API URL.');
  }
  if (url.protocol !== 'https:') {
    throw new OpenAIError('X.509 workload identity requires an absolute HTTPS API URL.');
  }
  if (url.username || url.password) {
    throw new OpenAIError('X.509 workload identity API URLs must not contain user credentials.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/u, '');
  const isAzureOrigin = FORBIDDEN_PROVIDER_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  const isBedrockOrigin = parseBedrockEndpointHostname(hostname) !== undefined;
  if (isAzureOrigin || isBedrockOrigin) {
    throw new OpenAIError(
      'X.509 workload identity cannot send OpenAI credentials to a recognized third-party provider origin.',
    );
  }
  return url.origin;
}

/** Enforces the API origin selected before X.509 token acquisition. */
export function assertX509APIOrigin(value: RequestInfo, expectedOrigin: string | undefined): void {
  if (x509APIOrigin(value) !== expectedOrigin) {
    throw new OpenAIError('X.509 workload identity requests must remain on the configured API origin.');
  }
}

/** Rejects credential families that must not accompany an X.509 workload request. */
export function assertNoX509ConflictingCredentials(headers: Headers): void {
  for (const name of headers.keys()) {
    const canonicalName = name.toLowerCase().split('_').join('-');
    if (
      canonicalName === 'api-key' ||
      canonicalName === 'x-api-key' ||
      canonicalName === 'proxy-authorization'
    ) {
      throw new OpenAIError(
        'X.509 workload identity must not be combined with API-key or proxy authorization credentials.',
      );
    }
  }
}

/** Clears workload-token provenance when a hook replaces or removes the selected bearer. */
export function revalidateWorkloadIdentityAuthorization(
  headers: RequestInit['headers'],
  context: WorkloadIdentityRequestContext | undefined,
): void {
  if (!context?.usesWorkloadIdentityToken) {
    return;
  }

  const authorization = new Headers(headers).get('Authorization');
  if (authorization !== context.workloadIdentityAuthorization) {
    context.usesWorkloadIdentityToken = false;
    if (!authorization) {
      context.workloadIdentityTokenSuppressed = true;
    }
  }
}

/** Enforces the complete X.509 trust boundary immediately before a network dispatch. */
export function assertX509Dispatch(
  url: RequestInfo,
  init: RequestInit,
  context: WorkloadIdentityRequestContext | undefined,
  currentFetchOptions: MergedRequestInit | undefined,
): void {
  try {
    assertX509APIOrigin(url, context?.apiOrigin);
    const headers = new Headers(init.headers);
    assertNoX509ConflictingCredentials(headers);
    if (
      context?.selectedAuthorization !== undefined &&
      headers.get('Authorization') !== context.selectedAuthorization
    ) {
      throw new OpenAIError(
        'X.509 workload identity requests must preserve their selected authorization credentials.',
      );
    }
    if (
      !context ||
      init.redirect !== 'manual' ||
      !hasSameX509Transport(context.fetchOptions, init) ||
      x509TransportKey(currentFetchOptions) !== context.transportKey
    ) {
      throw new OpenAIError(
        'X.509 workload identity requests must preserve their transport and manual redirect policy.',
      );
    }
  } catch (error) {
    if (context) {
      context.terminalAuthenticationError = castToError(error);
    }
    throw error;
  }
}
