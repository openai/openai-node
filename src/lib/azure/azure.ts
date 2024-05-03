import * as Core from '../../core';
import * as Errors from '../../error';
import { ClientOptions, OpenAI } from '../../client';
import type { RequestInit } from '../../_shims/index';

/** API Client for interfacing with the Azure OpenAI API. */
export interface AzureClientOptions extends ClientOptions {
  /**
   * Defaults to process.env['OPENAI_API_VERSION'].
   */
  apiVersion?: string | undefined;
  /**
   * Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`
   */
  endpoint?: string | undefined;
  /**
   * A model deployment, if given, sets the base client URL to include `/deployments/{deployment}`.
   * Note: this means you won't be able to use non-deployment endpoints. Not supported with Assistants APIs.
   */
  deployment?: string | undefined;
  /**
   * Defaults to process.env['AZURE_OPENAI_API_KEY'].
   */
  apiKey?: string | undefined;
  /**
   * A function that returns a Microsoft Entra (formerly known as Azure Active Directory) access token, will be invoked on every request.
   */
  microsoftEntraTokenProvider?: (() => string) | undefined;
}

/** API Client for interfacing with the Azure OpenAI API. */
export class AzureOpenAI extends OpenAI {
  private _microsoftEntraTokenProvider: (() => string) | undefined;
  apiVersion: string = '';
  /**
   * API Client for interfacing with the Azure OpenAI API.
   *
   * @param {string | undefined} [opts.apiVersion=process.env['OPENAI_API_VERSION'] ?? undefined]
   * @param {string | undefined} [opts.endpoint=process.env['AZURE_OPENAI_ENDPOINT'] ?? undefined] - Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`
   * @param {string | undefined} [opts.apiKey=process.env['AZURE_OPENAI_API_KEY'] ?? undefined]
   * @param {string | undefined} opts.deployment - A model deployment, if given, sets the base client URL to include `/deployments/{deployment}`.
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL']] - Sets the base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {number} [opts.httpAgent] - An HTTP agent used to manage HTTP(s) connections.
   * @param {Core.Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {Core.Headers} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Core.DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({
    baseURL = Core.readEnv('OPENAI_BASE_URL'),
    apiKey = Core.readEnv('AZURE_OPENAI_API_KEY'),
    apiVersion = Core.readEnv('OPENAI_API_VERSION'),
    endpoint,
    deployment,
    microsoftEntraTokenProvider,
    dangerouslyAllowBrowser,
    ...opts
  }: AzureClientOptions = {}) {
    if (!apiVersion) {
      throw new Errors.OpenAIError(
        "The OPENAI_API_VERSION environment variable is missing or empty; either provide it, or instantiate the AzureOpenAI client with an apiVersion option, like new AzureOpenAI({ apiVersion: 'My API Version' }).",
      );
    }

    if (typeof microsoftEntraTokenProvider === 'function') {
      dangerouslyAllowBrowser = true;
    }

    if (!microsoftEntraTokenProvider && !apiKey) {
      throw new Errors.OpenAIError(
        'Missing credentials. Please pass one of `apiKey` and `microsoftEntraTokenProvider`, or set the `AZURE_OPENAI_API_KEY` environment variable.',
      );
    }

    if (microsoftEntraTokenProvider && apiKey) {
      throw new Errors.OpenAIError(
        'The `apiKey` and `microsoftEntraTokenProvider` arguments are mutually exclusive; only one can be passed at a time.',
      );
    }

    // define a sentinel value to avoid any typing issues
    apiKey ??= API_KEY_SENTINEL;

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

      if (deployment) {
        baseURL = `${endpoint}/openai/deployments/${deployment}`;
      } else {
        baseURL = `${endpoint}/openai`;
      }
    } else {
      if (endpoint) {
        throw new Errors.OpenAIError('baseURL and endpoint are mutually exclusive');
      }
    }

    super({
      apiKey,
      baseURL,
      ...opts,
      ...(dangerouslyAllowBrowser !== undefined ? { dangerouslyAllowBrowser } : {}),
    });

    this._microsoftEntraTokenProvider = microsoftEntraTokenProvider;
    this.apiVersion = apiVersion;
  }

  override buildRequest(options: Core.FinalRequestOptions<unknown>): {
    req: RequestInit;
    url: string;
    timeout: number;
  } {
    if (_deployments_endpoints.has(options.path) && options.method === 'post' && options.body !== undefined) {
      if (!Core.isObj(options.body)) {
        throw new Error('Expected request body to be an object');
      }
      const model = options.body['model'];
      delete options.body['model'];
      if (model !== undefined && !this.baseURL.includes('/deployments')) {
        options.path = `/deployments/${model}${options.path}`;
      }
    }
    return super.buildRequest(options);
  }

  private _getMicrosoftEntraToken(): string | undefined {
    if (typeof this._microsoftEntraTokenProvider === 'function') {
      const token = this._microsoftEntraTokenProvider();
      if (!token || typeof token !== 'string') {
        throw new Errors.OpenAIError(
          `Expected 'microsoftEntraTokenProvider' argument to return a string but it returned ${token}`,
        );
      }
      return token;
    }
    return undefined;
  }

  protected override authHeaders(opts: Core.FinalRequestOptions): Core.Headers {
    if (opts.headers?.['Authorization'] || opts.headers?.['api-key']) {
      return {};
    }
    const token = this._getMicrosoftEntraToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    if (this.apiKey !== API_KEY_SENTINEL) {
      return { 'api-key': this.apiKey };
    }
    throw new Errors.OpenAIError('Unable to handle auth');
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
]);

const API_KEY_SENTINEL = '<Missing Key>';
