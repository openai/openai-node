import type { RequestInit, RequestInfo, Response } from './internal/builtin-types';
import type { NullableHeaders } from './internal/headers';
import {
  buildAzureAuthenticationHeaders,
  buildHeaders,
  protectAzureRequestHeaders,
} from './internal/headers';
import * as Errors from './error';
import type { FinalRequestOptions } from './internal/request-options';
import { isObj, readEnv } from './internal/utils';
import { path } from './internal/utils/path';
import { OpenAI } from './client';
import type { ClientOptions } from './client';
import { assertNoDataResidency } from './internal/data-residency';

/** API Client for interfacing with the Azure OpenAI API. */
export interface AzureClientOptions extends Omit<ClientOptions, 'provider' | 'dataResidency'> {
  /** AzureOpenAI does not support third-party provider configuration. */
  provider?: never;

  /** OpenAI data residency cannot be combined with Azure routing. */
  dataResidency?: never;

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
    if (_deployments_endpoints.has(options.path) && options.method === 'post' && options.body !== undefined) {
      if (!isObj(options.body)) {
        throw new Error('Expected request body to be an object');
      }
      const model = this.deploymentName || options.body['model'] || options.__metadata?.['model'];
      if (model !== undefined && !this.baseURL.includes('/deployments')) {
        options.path = path`/deployments/${model}` + options.path;
      }
    }
    const { body } = options;
    const { headers, restore } = snapshotAzureRequestOptionsHeaders(options);
    const preprocessesHeaders = body === undefined ? 'body' in options : Boolean(body);
    let protection: ReturnType<typeof protectAzureRequestHeaders>;

    try {
      protection = preprocessesHeaders ? protectAzureRequestHeaders(headers, options) : undefined;
      const restoreAuthentication = protection
        ? snapshotAzureRequestAuthentication(this, this.authHeaders, protection)
        : undefined;
      let pending: ReturnType<OpenAI['buildRequest']>;
      try {
        pending = super.buildRequest(options, props);
      } finally {
        restoreAuthentication?.();
        protection?.deactivate();
      }

      const built = await pending;
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
    if (this.apiKey === null) {
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

type AzureAuthenticationHook = (
  options: FinalRequestOptions,
  schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
) => Promise<NullableHeaders | undefined>;

const azureRequestAuthenticationOriginals = new WeakMap<AzureAuthenticationHook, AzureAuthenticationHook>();

function snapshotAzureRequestAuthentication(
  client: AzureOpenAI,
  authenticate: AzureAuthenticationHook,
  protection: NonNullable<ReturnType<typeof protectAzureRequestHeaders>>,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(client, 'authHeaders');
  const replaceable =
    descriptor === undefined
      ? Object.isExtensible(client)
      : descriptor.configurable || ('value' in descriptor && descriptor.writable);
  if (!replaceable) {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }

  const original = azureRequestAuthenticationOriginals.get(authenticate) ?? authenticate;
  const snapshot = async (
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> => {
    restore();
    const carrier = await original.call(client, options, schemes);
    return carrier === undefined ? undefined : protection.bind(carrier);
  };
  azureRequestAuthenticationOriginals.set(snapshot, original);
  const restore = (): void => {
    if (Object.getOwnPropertyDescriptor(client, 'authHeaders')?.value !== snapshot) {
      return;
    }
    if (descriptor !== undefined) {
      Object.defineProperty(client, 'authHeaders', descriptor);
      return;
    }
    if (!Reflect.deleteProperty(client, 'authHeaders')) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  };
  try {
    const temporary =
      descriptor !== undefined && 'value' in descriptor
        ? { ...descriptor, value: snapshot }
        : {
            configurable: descriptor?.configurable ?? true,
            enumerable: descriptor?.enumerable ?? false,
            value: snapshot,
            writable: true,
          };
    Object.defineProperty(client, 'authHeaders', temporary);
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }

  return restore;
}

const azureRequestHeadersAccessorSnapshots = new WeakMap<
  FinalRequestOptions,
  {
    descriptor: PropertyDescriptor;
    getter: () => FinalRequestOptions['headers'];
    snapshots: { headers: FinalRequestOptions['headers'] }[];
  }
>();

function snapshotAzureRequestOptionsHeaders(options: FinalRequestOptions): {
  headers: FinalRequestOptions['headers'];
  restore?: () => void;
} {
  const active = azureRequestHeadersAccessorSnapshots.get(options);
  const descriptor = active?.descriptor ?? Object.getOwnPropertyDescriptor(options, 'headers');
  if (descriptor === undefined || 'value' in descriptor) {
    return { headers: options.headers };
  }
  if (!descriptor.configurable) {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }

  const headers = active === undefined ? options.headers : descriptor.get?.call(options);
  return { headers, restore: snapshotAzureRequestHeadersAccessor(options, headers) };
}

function snapshotAzureRequestHeadersAccessor(
  options: FinalRequestOptions,
  headers: FinalRequestOptions['headers'],
): () => void {
  let snapshot = azureRequestHeadersAccessorSnapshots.get(options);
  if (snapshot === undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
    if (descriptor === undefined || 'value' in descriptor || !descriptor.configurable) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }

    const snapshots: { headers: FinalRequestOptions['headers'] }[] = [];
    const getter = () => snapshots.at(-1)?.headers;
    const originalSetter = descriptor.set;
    const setter =
      originalSetter === undefined
        ? undefined
        : function setHeaders(this: FinalRequestOptions, value: FinalRequestOptions['headers']): void {
            originalSetter.call(this, value);
            const current = snapshots.at(-1);
            if (current !== undefined) {
              current.headers = value;
            }
          };
    Object.defineProperty(options, 'headers', {
      ...descriptor,
      get: getter,
      ...(setter === undefined ? {} : { set: setter }),
    });
    snapshot = { descriptor, getter, snapshots };
    azureRequestHeadersAccessorSnapshots.set(options, snapshot);
  }

  const active = snapshot;
  const entry = { headers };
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

    azureRequestHeadersAccessorSnapshots.delete(options);
    if (Object.getOwnPropertyDescriptor(options, 'headers')?.get === active.getter) {
      Object.defineProperty(options, 'headers', active.descriptor);
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
  const entries = intrinsicHeadersDescriptors.get('entries');
  if (typeof entries !== 'function') {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  try {
    return [...entries.call(headers)] as [string, string][];
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
}

function snapshotCrossRealmHeaders(headers: RequestInit['headers']): RequestInit['headers'] {
  if (headers === undefined || headers === null || typeof headers !== 'object') {
    return headers;
  }
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
    return headers;
  }

  const headerPrototype = trustedPrototype;
  const valid =
    !hasOverriddenOperation &&
    operations.every(
      (operation) => typeof Object.getOwnPropertyDescriptor(headerPrototype, operation)?.value === 'function',
    );
  if (!valid) {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }

  const iterator = Object.getOwnPropertyDescriptor(headerPrototype, Symbol.iterator) as PropertyDescriptor;
  const snapshots: [string, string][] = [];
  for (const row of iterator.value.call(headers) as Iterable<unknown>) {
    if (snapshots.length >= 1024 || !Array.isArray(row)) {
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
