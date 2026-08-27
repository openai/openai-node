import type { RequestInit, RequestInfo, Response } from './internal/builtin-types';
import type { NullableHeaders } from './internal/headers';
import {
  buildAzureAuthenticationHeaders,
  buildHeaders,
  protectAzureRequestHeaders,
  withAzureRequestHeaderSnapshot,
} from './internal/headers';
import * as Errors from './error';
import type { FinalRequestOptions } from './internal/request-options';
import { isObj, readEnv } from './internal/utils';
import { path } from './internal/utils/path';
import { OpenAI } from './client';
import type { ClientOptions } from './client';
import type { WorkloadIdentity } from './auth/types';
import { assertNoDataResidency } from './internal/data-residency';

/** API Client for interfacing with the Azure OpenAI API. */
export interface AzureClientOptions extends Omit<
  ClientOptions,
  'provider' | 'dataResidency' | 'credential' | 'workloadIdentity' | 'x509Transport'
> {
  /** AzureOpenAI does not support third-party provider configuration. */
  provider?: never;

  /** OpenAI data residency cannot be combined with Azure routing. */
  dataResidency?: never;

  /** Azure cannot receive an SDK-owned OpenAI X.509 certificate credential. */
  credential?: never;

  /** Azure cannot receive OpenAI X.509 workload-identity certificate transports. */
  x509Transport?: never;

  /** Existing subject-token workload-identity configuration remains unchanged. */
  workloadIdentity?: WorkloadIdentity | undefined;

  /**
   * Defaults to process.env['OPENAI_API_VERSION'].
   */
  apiVersion?: string | undefined;

  /**
   * Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`
   */
  endpoint?: string | undefined;

  /**
   * Azure model deployment inserted into supported deployment-scoped request
   * paths. The client's base URL remains unchanged, so non-deployment endpoints
   * remain available.
   */
  deployment?: string | undefined;

  /**
   * Defaults to process.env['AZURE_OPENAI_API_KEY'].
   */
  apiKey?: string | undefined;

  /**
   * A function that returns an access token for Microsoft Entra (formerly known as Azure Active Directory),
   * which will be invoked on every request.
   */
  azureADTokenProvider?: (() => Promise<string>) | undefined;
}

/** API Client for interfacing with the Azure OpenAI API. */
export class AzureOpenAI extends OpenAI {
  /** Azure deployment configured for deployment-scoped model requests. */
  deploymentName: string | undefined;
  /** Azure OpenAI API version included in requests made by this client. */
  apiVersion = '';

  /**
   * API Client for interfacing with the Azure OpenAI API.
   *
   * @param {string | undefined} [opts.apiVersion] - Defaults to `process.env['OPENAI_API_VERSION'] ?? undefined`.
   * @param {string | undefined} [opts.endpoint] - Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`. Defaults to `process.env['AZURE_OPENAI_ENDPOINT'] ?? undefined`.
   * @param {string | undefined} [opts.apiKey] - Defaults to `process.env['AZURE_OPENAI_API_KEY'] ?? undefined`.
   * @param {string | undefined} opts.deployment - Azure model deployment inserted into supported deployment-scoped request paths.
   * @param {string | null | undefined} [opts.organization] - Defaults to `process.env['OPENAI_ORG_ID'] ?? null`.
   * @param {string} [opts.baseURL] - Sets the base URL for the API, e.g. `https://example-resource.azure.openai.com/openai/`. Defaults to `process.env['OPENAI_BASE_URL']`.
   * @param {number} [opts.timeout] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out. Defaults to 10 minutes.
   * @param {() => Promise<string>} [opts.azureADTokenProvider] - Returns a fresh Microsoft Entra access token for each request; cannot be combined with `apiKey`.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries] - The maximum number of times the client will retry a request. Defaults to `2`.
   * @param {Headers} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers. Defaults to `false`.
   */
  constructor({
    baseURL = readEnv('OPENAI_BASE_URL'),
    apiKey = readEnv('AZURE_OPENAI_API_KEY'),
    apiVersion = readEnv('OPENAI_API_VERSION'),
    endpoint,
    deployment,
    azureADTokenProvider,
    dangerouslyAllowBrowser,
    dataResidency,
    ...opts
  }: AzureClientOptions = {}) {
    assertNoDataResidency(dataResidency, 'AzureOpenAI');
    if (!apiVersion) {
      throw new Errors.OpenAIError(
        "The OPENAI_API_VERSION environment variable is missing or empty; either provide it, or instantiate the AzureOpenAI client with an apiVersion option, like new AzureOpenAI({ apiVersion: 'My API Version' }).",
      );
    }

    if (typeof azureADTokenProvider === 'function') {
      dangerouslyAllowBrowser ??= true;
    }

    if (!azureADTokenProvider && !apiKey) {
      throw new Errors.OpenAIError(
        'Missing credentials. Please pass one of `apiKey` and `azureADTokenProvider`, or set the `AZURE_OPENAI_API_KEY` environment variable.',
      );
    }

    if (azureADTokenProvider && apiKey) {
      throw new Errors.OpenAIError(
        'The `apiKey` and `azureADTokenProvider` arguments are mutually exclusive; only one can be passed at a time.',
      );
    }

    opts.defaultQuery = { ...opts.defaultQuery, 'api-version': apiVersion };

    if (!baseURL) {
      if (!endpoint) {
        endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
      }

      if (!endpoint) {
        throw new Errors.OpenAIError(
          'Must provide one of the `baseURL` or `endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable',
        );
      }

      let endpointEnd = endpoint.length;
      while (endpointEnd > 0 && endpoint[endpointEnd - 1] === '/') {
        endpointEnd--;
      }
      baseURL = `${endpoint.slice(0, endpointEnd)}/openai`;
    } else if (endpoint) {
      throw new Errors.OpenAIError('baseURL and endpoint are mutually exclusive');
    }

    protectAzureAmbientHeaders(opts);
    super({
      apiKey: azureADTokenProvider ?? apiKey,
      baseURL,
      ...opts,
      ...(dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser }),
    });

    this.apiVersion = apiVersion;
    this.deploymentName = deployment;
  }

  /** Clones this client with Azure options; OpenAI data residency remains unsupported. */
  override withOptions(options: Partial<AzureClientOptions>): this {
    return super.withOptions(options);
  }

  /** Builds an Azure request and inserts its deployment into model-scoped endpoint paths. */
  override async buildRequest(
    options: FinalRequestOptions,
    props: {
      /** Number of retries already attempted for the current request. */
      retryCount?: number;
    } = {},
  ): Promise<{
    /** Fetch request options after authentication, headers, and the body are prepared. */
    req: RequestInit & {
      /** Fully resolved request headers sent to Azure OpenAI. */
      headers: Headers;
    };
    /** Absolute deployment-aware request URL. */
    url: string;
    /** Request timeout in milliseconds. */
    timeout: number;
  }> {
    prepareAzureDeploymentRequest(options, this.deploymentName, this.baseURL);
    const preprocessesHeaders = shouldProtectAzureRequestHeaders(options);
    const {
      copied,
      headers,
      options: requestOptions = options,
      restore,
    } = snapshotAzureRequestOptionsHeaders(options);
    const accessorSnapshot = azureRequestHeadersAccessorSnapshots.get(options);
    const accessorIndex = (accessorSnapshot?.snapshots.length ?? 0) - 1;
    const accessorEntry = accessorSnapshot?.snapshots[accessorIndex];
    let protection: ReturnType<typeof protectAzureRequestHeaders>;

    try {
      protection = preprocessesHeaders ? protectAzureRequestHeaders(headers, options) : undefined;
      let pending: ReturnType<OpenAI['buildRequest']>;
      let restoreBody: (() => void) | undefined;
      try {
        restoreBody = snapshotAzureRequestBodyAccessor(options);
        const requestHeaders = (): FinalRequestOptions['headers'] => {
          if (accessorEntry !== undefined) {
            return accessorEntry.headers;
          }
          if (requestOptions === options) {
            return options.headers;
          }
          return headers;
        };
        pending = withAzureRequestHeaderSnapshot(
          this,
          requestOptions,
          options,
          requestHeaders,
          protection,
          () => super.buildRequest(requestOptions, props),
        );
      } finally {
        try {
          restoreBody?.();
        } finally {
          protection?.deactivate();
        }
      }

      const built = await pending.catch((error: unknown) => {
        if (
          (accessorSnapshot?.descriptor.enumerable && accessorEntry?.copied === false) ||
          copied?.value === false
        ) {
          throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
        }
        throw error;
      });
      if (built.req.headers.has('api-key')) {
        built.req.redirect = 'manual';
      }
      return built;
    } finally {
      protection?.release();
      restore?.();
    }
  }

  protected override async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    const suppliedHeaders = init.headers;
    const safeHeaders = snapshotCrossRealmHeaders(suppliedHeaders);
    const headers = buildHeaders([buildAzureAuthenticationHeaders(), safeHeaders]).values;
    if (!hasIntrinsicHeadersIdentity(suppliedHeaders)) {
      init.headers = headers;
    }
    if (headers.has('api-key')) {
      init.redirect = 'manual';
    }

    return super.fetchWithAuth(url, init, timeout, controller, schemes);
  }

  protected override async authHeaders(
    opts: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    const security = schemes ?? { bearerAuth: true, adminAPIKeyAuth: true };
    if (security.bearerAuth && typeof this._options.apiKey === 'string') {
      return buildAzureAuthenticationHeaders([['api-key', this.apiKey]]);
    }

    return buildAzureAuthenticationHeaders(
      security.bearerAuth ? await this.bearerAuth(opts) : undefined,
      security.adminAPIKeyAuth ? await this.adminAPIKeyAuth(opts) : undefined,
    );
  }

  protected override async bearerAuth(_opts: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    if (this.apiKey === null || this.apiKey === undefined) {
      return undefined;
    }
    return buildAzureAuthenticationHeaders([['Authorization', `Bearer ${this.apiKey}`]]);
  }

  protected override async adminAPIKeyAuth(_opts: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    if (this.adminAPIKey === null || this.adminAPIKey === undefined) {
      return undefined;
    }
    return buildAzureAuthenticationHeaders([['Authorization', `Bearer ${this.adminAPIKey}`]]);
  }
}

function prepareAzureDeploymentRequest(
  options: FinalRequestOptions,
  deployment: string | undefined,
  baseURL: string,
): void {
  if (!_deployments_endpoints.has(options.path) || options.method !== 'post') {
    return;
  }
  let body: unknown;
  try {
    ({ body } = options);
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  if (body === undefined) {
    return;
  }
  if (!isObj(body)) {
    throw new Error('Expected request body to be an object');
  }
  const model = deployment || body['model'] || options.__metadata?.['model'];
  if (model !== undefined && !baseURL.includes('/deployments')) {
    options.path = path`/deployments/${model}` + options.path;
  }
}

function shouldProtectAzureRequestHeaders(options: FinalRequestOptions): boolean {
  try {
    let owner: object | null = options;
    let descriptor = Object.getOwnPropertyDescriptor(options, 'body');
    if (descriptor === undefined) {
      for (let depth = 0; depth < 32 && owner !== null; depth += 1) {
        owner = Object.getPrototypeOf(owner) as object | null;
        if (owner === null) {
          break;
        }
        descriptor = Object.getOwnPropertyDescriptor(owner, 'body');
        if (descriptor !== undefined) {
          break;
        }
      }
    }
    if (typeof descriptor?.get === 'function') {
      return true;
    }
    const { body } = options;
    return (
      (descriptor === undefined && owner !== null) || (body === undefined ? 'body' in options : Boolean(body))
    );
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
}

function snapshotAzureRequestBodyAccessor(options: FinalRequestOptions): (() => void) | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, 'body');
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  if (!descriptor?.enumerable || !descriptor.configurable || typeof descriptor.get !== 'function') {
    return undefined;
  }

  const originalDescriptor: PropertyDescriptor = descriptor;
  const original = descriptor.get;
  const getter = function getter(this: FinalRequestOptions): unknown {
    try {
      return Reflect.apply(original, this, []);
    } catch {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  };

  const restore = (): void => {
    if (Object.getOwnPropertyDescriptor(options, 'body')?.get !== getter) {
      return;
    }
    Object.defineProperty(options, 'body', originalDescriptor);
  };
  try {
    Object.defineProperty(options, 'body', { ...originalDescriptor, get: getter });
  } catch {
    try {
      restore();
    } catch {
      // A hostile proxy can prevent restoration after forwarding its first trap.
    }
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }

  return () => {
    try {
      restore();
    } catch {
      try {
        restore();
      } catch {
        // Preserve the original descriptor when repeated hostile hooks prevent restoration.
      }
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  };
}

interface AzureRequestHeadersAccessorSnapshot {
  descriptor: PropertyDescriptor;
  getter: () => FinalRequestOptions['headers'];
  inherited: boolean;
  snapshots: { copied: boolean; headers: FinalRequestOptions['headers'] }[];
}

const azureRequestHeadersAccessorSnapshots = new WeakMap<
  FinalRequestOptions,
  AzureRequestHeadersAccessorSnapshot
>();

function restoreAzureRequestHeadersAccessor(
  options: FinalRequestOptions,
  snapshot: AzureRequestHeadersAccessorSnapshot,
): void {
  if (Object.getOwnPropertyDescriptor(options, 'headers')?.get !== snapshot.getter) {
    azureRequestHeadersAccessorSnapshots.delete(options);
    return;
  }
  if (snapshot.inherited) {
    if (!Reflect.deleteProperty(options, 'headers')) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  } else {
    Object.defineProperty(options, 'headers', snapshot.descriptor);
  }
  azureRequestHeadersAccessorSnapshots.delete(options);
}

function findAzureRequestHeadersDescriptor(options: FinalRequestOptions):
  | {
      descriptor: PropertyDescriptor;
      inherited: boolean;
    }
  | undefined {
  let prototype: object | null = options;
  for (let depth = 0; depth < 256 && prototype !== null; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'headers');
    if (descriptor !== undefined) {
      return { descriptor, inherited: prototype !== options };
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  if (prototype !== null) {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  return undefined;
}

function snapshotAzureRequestOptionsHeaders(options: FinalRequestOptions): {
  copied?: { value: boolean };
  headers: FinalRequestOptions['headers'];
  options?: FinalRequestOptions;
  restore?: () => void;
} {
  try {
    let active = azureRequestHeadersAccessorSnapshots.get(options);
    if (
      active !== undefined &&
      active.snapshots.length === 0 &&
      Object.getOwnPropertyDescriptor(options, 'headers')?.get !== active.getter
    ) {
      azureRequestHeadersAccessorSnapshots.delete(options);
      active = undefined;
    }
    const found = active ?? findAzureRequestHeadersDescriptor(options);
    const descriptor = found?.descriptor;
    if (descriptor === undefined || 'value' in descriptor) {
      return { headers: options.headers };
    }
    if (found?.inherited ? !Object.isExtensible(options) : !descriptor.configurable) {
      const { headers } = options;
      const copied = { value: false };
      const requestOptions = new Proxy(options, {
        get(target, property) {
          if (property === 'headers') {
            copied.value = true;
            return headers;
          }
          return Reflect.get(target, property, target);
        },
        set(target, property, value) {
          return Reflect.set(target, property, value, target);
        },
      });
      return {
        ...(descriptor.enumerable ? { copied } : {}),
        headers,
        options: requestOptions,
      };
    }

    const headers = active === undefined ? options.headers : descriptor.get?.call(options);
    return { headers, restore: snapshotAzureRequestHeadersAccessor(options, headers, descriptor) };
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
}

function snapshotAzureRequestHeadersAccessor(
  options: FinalRequestOptions,
  headers: FinalRequestOptions['headers'],
  descriptor: PropertyDescriptor,
): () => void {
  let snapshot = azureRequestHeadersAccessorSnapshots.get(options);
  if (snapshot === undefined) {
    const inherited = Object.getOwnPropertyDescriptor(options, 'headers') === undefined;
    const snapshots: { copied: boolean; headers: FinalRequestOptions['headers'] }[] = [];
    const latestSnapshot = () => {
      const index = snapshots.length - 1;
      return snapshots[index];
    };
    const getter = () => {
      const current = latestSnapshot();
      if (current !== undefined) {
        current.copied = true;
      }
      return current?.headers;
    };
    const originalSetter = descriptor.set;
    const setter =
      originalSetter === undefined
        ? undefined
        : function setHeaders(this: FinalRequestOptions, value: FinalRequestOptions['headers']): void {
            originalSetter.call(this, value);
            const current = latestSnapshot();
            if (current !== undefined) {
              try {
                current.headers = descriptor.get?.call(this);
              } catch {
                throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
              }
            }
          };
    snapshot = { descriptor, getter, inherited, snapshots };
    azureRequestHeadersAccessorSnapshots.set(options, snapshot);
    try {
      Object.defineProperty(options, 'headers', {
        ...descriptor,
        configurable: true,
        get: getter,
        ...(setter === undefined ? {} : { set: setter }),
      });
    } catch {
      try {
        restoreAzureRequestHeadersAccessor(options, snapshot);
      } catch {
        // Retain the original snapshot when hostile hooks also prevent restoration.
      }
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  }

  const active = snapshot;
  const entry = { copied: false, headers };
  active.snapshots.push(entry);
  let restored = false;
  return () => {
    if (restored) {
      return;
    }
    restored = true;
    const index = active.snapshots.indexOf(entry);
    if (index !== -1) {
      active.snapshots.splice(index, 1);
    }
    if (active.snapshots.length !== 0) {
      return;
    }

    try {
      restoreAzureRequestHeadersAccessor(options, active);
    } catch {
      try {
        restoreAzureRequestHeadersAccessor(options, active);
      } catch {
        // Retain the original snapshot when hostile hooks also prevent restoration.
      }
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  };
}

const intrinsicHeadersPrototype = Headers.prototype;
const intrinsicHeadersHas = intrinsicHeadersPrototype.has;
const intrinsicHeadersOperations = [
  'append',
  'delete',
  'entries',
  'forEach',
  'get',
  'getSetCookie',
  'has',
  'keys',
  'set',
  'values',
  Symbol.iterator,
] as const;
const intrinsicHeadersDescriptors = new Map(
  intrinsicHeadersOperations.map((operation) => [
    operation,
    Object.getOwnPropertyDescriptor(intrinsicHeadersPrototype, operation)?.value,
  ]),
);

function hasIntrinsicHeadersIdentity(headers: RequestInit['headers']): headers is Headers {
  if (!(headers instanceof Headers)) {
    return false;
  }

  try {
    intrinsicHeadersHas.call(headers, 'api-key');

    let prototype: object | null = headers;
    for (let depth = 0; depth < 32 && prototype !== null; depth++) {
      if (prototype === intrinsicHeadersPrototype) {
        return intrinsicHeadersOperations.every(
          (operation) =>
            Object.getOwnPropertyDescriptor(intrinsicHeadersPrototype, operation)?.value ===
            intrinsicHeadersDescriptors.get(operation),
        );
      }

      const currentPrototype = prototype;
      if (
        intrinsicHeadersOperations.some(
          (operation) => Object.getOwnPropertyDescriptor(currentPrototype, operation) !== undefined,
        )
      ) {
        return false;
      }

      prototype = Object.getPrototypeOf(currentPrototype) as object | null;
    }
  } catch {
    return false;
  }

  return false;
}

function snapshotSameRealmHeaders(headers: Headers): RequestInit['headers'] {
  if (hasIntrinsicHeadersIdentity(headers)) {
    return headers;
  }
  const intrinsicEntries = intrinsicHeadersDescriptors.get('entries');
  if (typeof intrinsicEntries !== 'function') {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  try {
    const [entriesDescriptor, iteratorDescriptor] = (['entries', Symbol.iterator] as const).map(
      (operation) => {
        let prototype: object | null = headers;
        for (let depth = 0; depth < 32 && prototype !== null; depth += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, operation);
          if (descriptor !== undefined) {
            return descriptor;
          }
          prototype = Object.getPrototypeOf(prototype) as object | null;
        }
        return null;
      },
    );
    const entries =
      typeof entriesDescriptor?.value === 'function' && entriesDescriptor.value === iteratorDescriptor?.value
        ? entriesDescriptor.value
        : intrinsicEntries;
    const snapshot = Reflect.apply(entries, headers, []) as ReturnType<Headers['entries']>;
    if (entries === intrinsicEntries) {
      return [...snapshot] as [string, string][];
    }
    let intrinsicHeaderCount = 0;
    for (const _header of Reflect.apply(intrinsicEntries, headers, []) as Iterable<unknown>) {
      intrinsicHeaderCount += 1;
    }
    const maximumHeaders = Math.max(1024, intrinsicHeaderCount);
    const snapshots: [string, string][] = [];
    for (const row of snapshot as Iterable<unknown>) {
      if (snapshots.length >= maximumHeaders || !Array.isArray(row)) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      const name: unknown = Reflect.get(row, 0);
      const value: unknown = Reflect.get(row, 1);
      if (typeof name !== 'string' || typeof value !== 'string') {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      snapshots.push([name, value]);
    }
    return snapshots;
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
}

function hasCanonicalCrossRealmHeaders(headers: object, prototype: object): boolean {
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (typeof constructor !== 'function') {
    return false;
  }
  if (Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value !== prototype) {
    return false;
  }
  const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator)?.value;
  const entries = Object.getOwnPropertyDescriptor(prototype, 'entries')?.value;
  const has = Object.getOwnPropertyDescriptor(prototype, 'has')?.value;
  if (iterator !== entries || typeof has !== 'function') {
    return false;
  }
  try {
    return typeof has.call(headers, 'api-key') === 'boolean';
  } catch {
    return false;
  }
}

function snapshotAzureHeaderRecord(headers: object): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    Object.defineProperty(snapshot, name, {
      configurable: true,
      enumerable: true,
      get: () => Reflect.get(headers, name) as string,
    });
  }
  return snapshot;
}

function snapshotCrossRealmHeaders(headers: RequestInit['headers']): RequestInit['headers'] {
  if (typeof headers !== 'object' || headers === null) {
    return headers;
  }
  try {
    if (headers instanceof Headers) {
      return snapshotSameRealmHeaders(headers);
    }
    if (Array.isArray(headers)) {
      return headers;
    }

    const operations = [Symbol.iterator, 'entries', 'get', 'has'] as const;
    let prototype = Object.getPrototypeOf(headers) as object | null;
    let trustedPrototype: object | undefined;
    let hasOverriddenOperation = operations.some(
      (operation) => Object.getOwnPropertyDescriptor(headers, operation) !== undefined,
    );

    for (let depth = 0; depth < 32 && prototype !== null; depth++) {
      if (Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Headers') {
        trustedPrototype = prototype;
        break;
      }

      const currentPrototype = prototype;
      const overriddenOperation = operations.some(
        (operation) => Object.getOwnPropertyDescriptor(currentPrototype, operation) !== undefined,
      );
      if (overriddenOperation) {
        hasOverriddenOperation = true;
      }
      prototype = Object.getPrototypeOf(currentPrototype) as object | null;
    }

    if (trustedPrototype === undefined) {
      return snapshotAzureHeaderRecord(headers);
    }

    const headerPrototype = trustedPrototype;
    const valid =
      !hasOverriddenOperation &&
      operations.every(
        (operation) =>
          typeof Object.getOwnPropertyDescriptor(headerPrototype, operation)?.value === 'function',
      );
    if (!valid) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }

    const iterator = Object.getOwnPropertyDescriptor(headerPrototype, Symbol.iterator) as PropertyDescriptor;
    // Foreign realm brands can be forged, so retain a generous denial-of-service bound.
    const maximumHeaders = hasCanonicalCrossRealmHeaders(headers, headerPrototype) ? 65_536 : 1024;
    const snapshots: [string, string][] = [];
    for (const row of iterator.value.call(headers) as Iterable<unknown>) {
      if (snapshots.length >= maximumHeaders || !Array.isArray(row)) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      const name: unknown = Reflect.get(row, 0);
      const value: unknown = Reflect.get(row, 1);
      if (typeof name !== 'string' || typeof value !== 'string') {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      snapshots.push([name, value]);
    }
    return snapshots;
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
}

function protectAzureAmbientHeaders(options: Pick<ClientOptions, 'defaultHeaders'>): void {
  if (readEnv('OPENAI_CUSTOM_HEADERS')) {
    options.defaultHeaders = buildAzureAuthenticationHeaders(options.defaultHeaders);
  }
}

const _deployments_endpoints = new Set([
  '/completions',
  '/chat/completions',
  '/embeddings',
  '/audio/transcriptions',
  '/audio/translations',
  '/audio/speech',
  '/images/generations',
  '/batches',
  '/images/edits',
]);
