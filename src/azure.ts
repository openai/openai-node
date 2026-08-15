import type { RequestInit, RequestInfo, Response } from './internal/builtin-types';
import type { NullableHeaders } from './internal/headers';
import { buildHeaders } from './internal/headers';
import * as Errors from './error';
import type { FinalRequestOptions } from './internal/request-options';
import { isObj, readEnv } from './internal/utils';
import { path } from './internal/utils/path';
import { OpenAI } from './client';
import type { ClientOptions } from './client';

/** API Client for interfacing with the Azure OpenAI API. */
export interface AzureClientOptions extends Omit<ClientOptions, 'provider'> {
  /** AzureOpenAI does not support third-party provider configuration. */
  provider?: never;

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
    ...opts
  }: AzureClientOptions = {}) {
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

    super({
      apiKey: azureADTokenProvider ?? apiKey,
      baseURL,
      ...opts,
      ...(dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser }),
    });

    this.apiVersion = apiVersion;
    this.deploymentName = deployment;
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
    const built = await super.buildRequest(options, props);
    if (built.req.headers.has('api-key')) {
      built.req.redirect = 'manual';
    }
    return built;
  }

  protected override async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    if (new Headers(init.headers).has('api-key')) {
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
      return buildHeaders([{ 'api-key': this.apiKey }]);
    }
    return super.authHeaders(opts, security);
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
