// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as Errors from './error';
import * as Uploads from './uploads';
import { fetch as defaultFetch } from './_shims/index';
import { type HTTPMethod, type PromiseOrValue, type RequestClient } from './internal/types';
import {
  debug,
  sleep,
  safeJSON,
  castToError,
  isAbsoluteURL,
  uuid4,
  validatePositiveInteger,
  isObj,
} from './internal/utils';
import { APIResponseProps } from './internal/parse';
import { getPlatformHeaders } from './internal/platform';
import * as Opts from './internal/request-options';
import { VERSION } from './version';
import {
  kind as shimsKind,
  getDefaultAgent,
  type Agent,
  type RequestInfo,
  type RequestInit,
  type HeadersInit,
  type RequestDuplex,
  isReadable,
} from './_shims/index';
import { createResponseHeaders } from './internal/headers';
import { isBlobLike, isMultipartBody } from './uploads';
import { applyHeadersMut } from './internal/headers';
import * as Pagination from './pagination';
import { AbstractPage } from './pagination';
import * as API from './resources/index';
import { type Response } from './_shims/index';
import { APIPromise } from './internal/api-promise';
import { isRunningInBrowser } from './internal/platform';
import { FinalRequestOptions, RequestOptions } from './internal/request-options';
import { type DefaultQuery, type Fetch, type Headers } from './internal/types';
import { isEmptyObj, readEnv } from './internal/utils';

export interface ClientOptions {
  /**
   * Defaults to process.env['OPENAI_API_KEY'].
   */
  apiKey?: string | undefined;

  /**
   * Defaults to process.env['OPENAI_ORG_ID'].
   */
  organization?: string | null | undefined;

  /**
   * Defaults to process.env['OPENAI_PROJECT_ID'].
   */
  project?: string | null | undefined;

  /**
   * Override the default base URL for the API, e.g., "https://api.example.com/v2/"
   *
   * Defaults to process.env['OPENAI_BASE_URL'].
   */
  baseURL?: string | null | undefined;

  /**
   * The maximum amount of time (in milliseconds) that the client should wait for a response
   * from the server before timing out a single request.
   *
   * Note that request timeouts are retried by default, so in a worst-case scenario you may wait
   * much longer than this timeout before the promise succeeds or fails.
   */
  timeout?: number;

  /**
   * An HTTP agent used to manage HTTP(S) connections.
   *
   * If not provided, an agent will be constructed by default in the Node.js environment,
   * otherwise no agent is used.
   */
  httpAgent?: Agent;

  /**
   * Specify a custom `fetch` function implementation.
   *
   * If not provided, we use `undici` on Node.js and otherwise expect that `fetch` is
   * defined globally.
   */
  fetch?: Fetch | undefined;

  /**
   * The maximum number of times that the client will retry a request in case of a
   * temporary failure, like a network error or a 5XX error from the server.
   *
   * @default 2
   */
  maxRetries?: number;

  /**
   * Default headers to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * header to `undefined` or `null` in request options.
   */
  defaultHeaders?: Headers;

  /**
   * Default query parameters to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * param to `undefined` in request options.
   */
  defaultQuery?: DefaultQuery;

  /**
   * By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   * Only set this option to `true` if you understand the risks and have appropriate mitigations in place.
   */
  dangerouslyAllowBrowser?: boolean;
}

export class BaseOpenAI {
  apiKey: string;
  organization: string | null;
  project: string | null;

  baseURL: string;
  maxRetries: number;
  timeout: number;
  httpAgent: Agent | undefined;

  private fetch: Fetch;
  protected idempotencyHeader?: string;
  private _options: ClientOptions;

  /**
   * API Client for interfacing with the OpenAI API.
   *
   * @param {string | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? undefined]
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {number} [opts.httpAgent] - An HTTP agent used to manage HTTP(s) connections.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {Headers} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({
    baseURL = readEnv('OPENAI_BASE_URL'),
    apiKey = readEnv('OPENAI_API_KEY'),
    organization = readEnv('OPENAI_ORG_ID') ?? null,
    project = readEnv('OPENAI_PROJECT_ID') ?? null,
    ...opts
  }: ClientOptions = {}) {
    if (apiKey === undefined) {
      throw new Errors.OpenAIError(
        "The OPENAI_API_KEY environment variable is missing or empty; either provide it, or instantiate the OpenAI client with an apiKey option, like new OpenAI({ apiKey: 'My API Key' }).",
      );
    }

    const options: ClientOptions = {
      apiKey,
      organization,
      project,
      ...opts,
      baseURL: baseURL || `https://api.openai.com/v1`,
    };

    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new Errors.OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n",
      );
    }

    this.baseURL = options.baseURL!;
    this.timeout = options.timeout ?? 600000 /* 10 minutes */;
    this.httpAgent = options.httpAgent;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? defaultFetch;

    this._options = options;

    this.apiKey = apiKey;
    this.organization = organization;
    this.project = project;
  }

  protected defaultQuery(): DefaultQuery | undefined {
    return this._options.defaultQuery;
  }

  protected defaultHeaders(opts: FinalRequestOptions): Headers {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': this.getUserAgent(),
      ...getPlatformHeaders(),
      ...this.authHeaders(opts),
      'OpenAI-Organization': this.organization,
      'OpenAI-Project': this.project,
      ...this._options.defaultHeaders,
    };
  }

  protected validateHeaders(headers: Headers, customHeaders: Headers) {
    return;
  }

  protected authHeaders(opts: FinalRequestOptions): Headers {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  protected stringifyQuery(query: Record<string, unknown>): string {
    return Object.entries(query)
      .filter(([_, value]) => typeof value !== 'undefined')
      .map(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        }
        if (value === null) {
          return `${encodeURIComponent(key)}=`;
        }
        throw new OpenAIError(
          `Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`,
        );
      })
      .join('&');
  }

  private getUserAgent(): string {
    return `${this.constructor.name}/JS ${VERSION}`;
  }

  protected defaultIdempotencyKey(): string {
    return `stainless-node-retry-${uuid4()}`;
  }

  protected makeStatusError(
    status: number | undefined,
    error: Object | undefined,
    message: string | undefined,
    headers: Headers | undefined,
  ) {
    return APIError.generate(status, error, message, headers);
  }

  buildURL<Req>(path: string, query: Req | null | undefined): string {
    const url =
      isAbsoluteURL(path) ?
        new URL(path)
      : new URL(this.baseURL + (this.baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));

    const defaultQuery = this.defaultQuery();
    if (!isEmptyObj(defaultQuery)) {
      query = { ...defaultQuery, ...query } as Req;
    }

    if (typeof query === 'object' && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query as Record<string, unknown>);
    }

    return url.toString();
  }

  private calculateContentLength(body: unknown): string | null {
    if (typeof body === 'string') {
      if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(body, 'utf8').toString();
      }

      if (typeof TextEncoder !== 'undefined') {
        const encoder = new TextEncoder();
        const encoded = encoder.encode(body);
        return encoded.length.toString();
      }
    } else if (ArrayBuffer.isView(body)) {
      return body.byteLength.toString();
    }

    return null;
  }

  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  protected async prepareOptions(options: FinalRequestOptions): Promise<void> {}

  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  protected async prepareRequest(
    request: RequestInit,
    { url, options }: { url: string; options: FinalRequestOptions },
  ): Promise<void> {}

  protected parseHeaders(headers: HeadersInit | null | undefined): Record<string, string> {
    return (
      !headers ? {}
      : Symbol.iterator in headers ?
        Object.fromEntries(Array.from(headers as Iterable<string[]>).map((header) => [...header]))
      : { ...headers }
    );
  }

  get<Req, Rsp>(path: string, opts?: PromiseOrValue<RequestOptions<Req>>): APIPromise<Rsp> {
    return this.methodRequest('get', path, opts);
  }

  post<Req, Rsp>(path: string, opts?: PromiseOrValue<RequestOptions<Req>>): APIPromise<Rsp> {
    return this.methodRequest('post', path, opts);
  }

  patch<Req, Rsp>(path: string, opts?: PromiseOrValue<RequestOptions<Req>>): APIPromise<Rsp> {
    return this.methodRequest('patch', path, opts);
  }

  put<Req, Rsp>(path: string, opts?: PromiseOrValue<RequestOptions<Req>>): APIPromise<Rsp> {
    return this.methodRequest('put', path, opts);
  }

  delete<Req, Rsp>(path: string, opts?: PromiseOrValue<RequestOptions<Req>>): APIPromise<Rsp> {
    return this.methodRequest('delete', path, opts);
  }

  private methodRequest<Req, Rsp>(
    method: HTTPMethod,
    path: string,
    opts?: PromiseOrValue<RequestOptions<Req>>,
  ): APIPromise<Rsp> {
    return this.request(
      Promise.resolve(opts).then(async (opts) => {
        const body =
          opts && isBlobLike(opts?.body) ? new DataView(await opts.body.arrayBuffer())
          : opts?.body instanceof DataView ? opts.body
          : opts?.body instanceof ArrayBuffer ? new DataView(opts.body)
          : opts && ArrayBuffer.isView(opts?.body) ? new DataView(opts.body.buffer)
          : opts?.body;
        return { method, path, ...opts, body };
      }),
    );
  }

  request<Req, Rsp>(
    options: PromiseOrValue<FinalRequestOptions<Req>>,
    remainingRetries: number | null = null,
  ): APIPromise<Rsp> {
    return new APIPromise(this.makeRequest(options, remainingRetries));
  }

  private async makeRequest<Req>(
    optionsInput: PromiseOrValue<FinalRequestOptions<Req>>,
    retriesRemaining: number | null,
  ): Promise<APIResponseProps> {
    const options = await optionsInput;
    if (retriesRemaining == null) {
      retriesRemaining = options.maxRetries ?? this.maxRetries;
    }

    await this.prepareOptions(options);

    const { req, url, timeout } = this.buildRequest(options);

    await this.prepareRequest(req, { url, options });

    debug('request', url, options, req.headers);

    if (options.signal?.aborted) {
      throw new APIUserAbortError();
    }

    const controller = new AbortController();
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);

    if (response instanceof Error) {
      if (options.signal?.aborted) {
        throw new APIUserAbortError();
      }
      if (retriesRemaining) {
        return this.retryRequest(options, retriesRemaining);
      }
      if (response.name === 'AbortError') {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }

    const responseHeaders = createResponseHeaders(response.headers);

    if (!response.ok) {
      if (retriesRemaining && this.shouldRetry(response)) {
        const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
        debug(`response (error; ${retryMessage})`, response.status, url, responseHeaders);
        return this.retryRequest(options, retriesRemaining, responseHeaders);
      }

      const errText = await response.text().catch((err: any) => castToError(err).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? undefined : errText;
      const retryMessage = retriesRemaining ? `(error; no more retries left)` : `(error; not retryable)`;

      debug(`response (error; ${retryMessage})`, response.status, url, responseHeaders, errMessage);

      const err = this.makeStatusError(response.status, errJSON, errMessage, responseHeaders);
      throw err;
    }

    return { response, options, controller };
  }

  getAPIList<Item, PageClass extends Pagination.AbstractPage<Item> = Pagination.AbstractPage<Item>>(
    path: string,
    Page: new (...args: any[]) => PageClass,
    opts?: RequestOptions<any>,
  ): Pagination.PagePromise<PageClass, Item> {
    return this.requestAPIList(Page, { method: 'get', path, ...opts });
  }

  requestAPIList<
    Item = unknown,
    PageClass extends Pagination.AbstractPage<Item> = Pagination.AbstractPage<Item>,
  >(
    Page: new (...args: ConstructorParameters<typeof Pagination.AbstractPage>) => PageClass,
    options: FinalRequestOptions,
  ): Pagination.PagePromise<PageClass, Item> {
    const request = this.makeRequest(options, null);
    return new Pagination.PagePromise<PageClass, Item>(this as any as OpenAI, request, Page);
  }

  async fetchWithTimeout(
    url: RequestInfo,
    init: RequestInit | undefined,
    ms: number,
    controller: AbortController,
  ): Promise<Response> {
    const { signal, method, ...options } = init || {};
    if (signal) signal.addEventListener('abort', () => controller.abort());

    const timeout = setTimeout(() => controller.abort(), ms);

    const isReadableBody = isReadable(options.body);

    const fetchOptions = {
      signal: controller.signal as any,
      ...(isReadableBody ? { duplex: 'half' as RequestDuplex } : {}),
      method: 'GET',
      ...options,
    };
    if (method) {
      // Custom methods like 'patch' need to be uppercased
      // See https://github.com/nodejs/undici/issues/2294
      fetchOptions.method = method.toUpperCase();
    }

    return (
      this.getRequestClient()
        // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
        .fetch.call(undefined, url, fetchOptions)
        .finally(() => {
          clearTimeout(timeout);
        })
    );
  }

  protected getRequestClient(): RequestClient {
    return { fetch: this.fetch };
  }

  private shouldRetry(response: Response): boolean {
    // Note this is not a standard header.
    const shouldRetryHeader = response.headers.get('x-should-retry');

    // If the server explicitly says whether or not to retry, obey.
    if (shouldRetryHeader === 'true') return true;
    if (shouldRetryHeader === 'false') return false;

    // Retry on request timeouts.
    if (response.status === 408) return true;

    // Retry on lock timeouts.
    if (response.status === 409) return true;

    // Retry on rate limits.
    if (response.status === 429) return true;

    // Retry internal errors.
    if (response.status >= 500) return true;

    return false;
  }

  private async retryRequest(
    options: FinalRequestOptions,
    retriesRemaining: number,
    responseHeaders?: Headers | undefined,
  ): Promise<APIResponseProps> {
    let timeoutMillis: number | undefined;

    // Note the `retry-after-ms` header may not be standard, but is a good idea and we'd like proactive support for it.
    const retryAfterMillisHeader = responseHeaders?.['retry-after-ms'];
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }

    // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
    const retryAfterHeader = responseHeaders?.['retry-after'];
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1000;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }

    // If the API asks us to wait a certain amount of time (and it's a reasonable amount),
    // just do what it says, but otherwise calculate a default
    if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1000)) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);

    return this.makeRequest(options, retriesRemaining - 1);
  }

  private calculateDefaultRetryTimeoutMillis(retriesRemaining: number, maxRetries: number): number {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8.0;

    const numRetries = maxRetries - retriesRemaining;

    // Apply exponential backoff, but not more than the max.
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);

    // Apply some jitter, take up to at most 25 percent of the retry time.
    const jitter = 1 - Math.random() * 0.25;

    return sleepSeconds * jitter * 1000;
  }

  buildRequest<Req>(options: FinalRequestOptions<Req>): { req: RequestInit; url: string; timeout: number } {
    const { method, path, query, headers: headers = {} } = options;

    const body =
      ArrayBuffer.isView(options.body) || (options.__binaryRequest && typeof options.body === 'string') ?
        options.body
      : isMultipartBody(options.body) ? options.body.body
      : options.body ? JSON.stringify(options.body, null, 2)
      : null;
    const contentLength = this.calculateContentLength(body);

    const url = this.buildURL(path!, query);
    if ('timeout' in options) validatePositiveInteger('timeout', options.timeout);
    const timeout = options.timeout ?? this.timeout;
    const httpAgent = options.httpAgent ?? this.httpAgent ?? getDefaultAgent(url);
    const minAgentTimeout = timeout + 1000;
    if (
      typeof (httpAgent as any)?.options?.timeout === 'number' &&
      minAgentTimeout > ((httpAgent as any).options.timeout ?? 0)
    ) {
      // Allow any given request to bump our agent active socket timeout.
      // This may seem strange, but leaking active sockets should be rare and not particularly problematic,
      // and without mutating agent we would need to create more of them.
      // This tradeoff optimizes for performance.
      (httpAgent as any).options.timeout = minAgentTimeout;
    }

    if (this.idempotencyHeader && method !== 'get') {
      if (!options.idempotencyKey) options.idempotencyKey = this.defaultIdempotencyKey();
      headers[this.idempotencyHeader] = options.idempotencyKey;
    }

    const reqHeaders = this.buildHeaders({ options, headers, contentLength });

    const req: RequestInit = {
      method,
      ...(body && { body: body as any }),
      headers: reqHeaders,
      ...(httpAgent && { agent: httpAgent }),
      signal: options.signal ?? null,
    };

    return { req, url, timeout };
  }

  private buildHeaders({
    options,
    headers,
    contentLength,
  }: {
    options: FinalRequestOptions;
    headers: Record<string, string | null | undefined>;
    contentLength: string | null | undefined;
  }): Record<string, string> {
    const reqHeaders: Record<string, string> = {};
    if (contentLength) {
      reqHeaders['content-length'] = contentLength;
    }

    const defaultHeaders = this.defaultHeaders(options);
    applyHeadersMut(reqHeaders, defaultHeaders);
    applyHeadersMut(reqHeaders, headers);

    // let builtin fetch set the Content-Type for multipart bodies
    if (isMultipartBody(options.body) && shimsKind !== 'node') {
      delete reqHeaders['content-type'];
    }

    this.validateHeaders(reqHeaders, headers);

    return reqHeaders;
  }

  static OpenAI = this;

  static OpenAIError = Errors.OpenAIError;
  static APIError = Errors.APIError;
  static APIConnectionError = Errors.APIConnectionError;
  static APIConnectionTimeoutError = Errors.APIConnectionTimeoutError;
  static APIUserAbortError = Errors.APIUserAbortError;
  static NotFoundError = Errors.NotFoundError;
  static ConflictError = Errors.ConflictError;
  static RateLimitError = Errors.RateLimitError;
  static BadRequestError = Errors.BadRequestError;
  static AuthenticationError = Errors.AuthenticationError;
  static InternalServerError = Errors.InternalServerError;
  static PermissionDeniedError = Errors.PermissionDeniedError;
  static UnprocessableEntityError = Errors.UnprocessableEntityError;

  static toFile = Uploads.toFile;
}

/**
 * API Client for interfacing with the OpenAI API.
 */
export class OpenAI extends BaseOpenAI {
  completions: API.Completions = new API.Completions(this);
  chat: API.Chat = new API.Chat(this);
  embeddings: API.Embeddings = new API.Embeddings(this);
  files: API.Files = new API.Files(this);
  images: API.Images = new API.Images(this);
  audio: API.Audio = new API.Audio(this);
  moderations: API.Moderations = new API.Moderations(this);
  models: API.Models = new API.Models(this);
  fineTuning: API.FineTuning = new API.FineTuning(this);
  beta: API.Beta = new API.Beta(this);
  batches: API.Batches = new API.Batches(this);
}

export {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  createForm,
  type Uploadable,
} from './uploads';
export { APIPromise } from './internal/api-promise';
export { type Response } from './internal/types';
export { PagePromise } from './pagination';
export const {
  OpenAIError,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  BadRequestError,
  AuthenticationError,
  InternalServerError,
  PermissionDeniedError,
  UnprocessableEntityError,
} = Errors;

export import toFile = Uploads.toFile;

export namespace OpenAI {
  export import RequestOptions = Opts.RequestOptions;

  export import Page = Pagination.Page;
  export import PageResponse = Pagination.PageResponse;

  export import CursorPage = Pagination.CursorPage;
  export import CursorPageParams = Pagination.CursorPageParams;
  export import CursorPageResponse = Pagination.CursorPageResponse;

  export import Completions = API.Completions;
  export import Completion = API.Completion;
  export import CompletionChoice = API.CompletionChoice;
  export import CompletionUsage = API.CompletionUsage;
  export import CompletionCreateParams = API.CompletionCreateParams;
  export import CompletionCreateParamsNonStreaming = API.CompletionCreateParamsNonStreaming;
  export import CompletionCreateParamsStreaming = API.CompletionCreateParamsStreaming;

  export import Chat = API.Chat;
  export import ChatModel = API.ChatModel;
  export import ChatCompletion = API.ChatCompletion;
  export import ChatCompletionAssistantMessageParam = API.ChatCompletionAssistantMessageParam;
  export import ChatCompletionChunk = API.ChatCompletionChunk;
  export import ChatCompletionContentPart = API.ChatCompletionContentPart;
  export import ChatCompletionContentPartImage = API.ChatCompletionContentPartImage;
  export import ChatCompletionContentPartText = API.ChatCompletionContentPartText;
  export import ChatCompletionFunctionCallOption = API.ChatCompletionFunctionCallOption;
  export import ChatCompletionFunctionMessageParam = API.ChatCompletionFunctionMessageParam;
  export import ChatCompletionMessage = API.ChatCompletionMessage;
  export import ChatCompletionMessageParam = API.ChatCompletionMessageParam;
  export import ChatCompletionMessageToolCall = API.ChatCompletionMessageToolCall;
  export import ChatCompletionNamedToolChoice = API.ChatCompletionNamedToolChoice;
  export import ChatCompletionRole = API.ChatCompletionRole;
  export import ChatCompletionStreamOptions = API.ChatCompletionStreamOptions;
  export import ChatCompletionSystemMessageParam = API.ChatCompletionSystemMessageParam;
  export import ChatCompletionTokenLogprob = API.ChatCompletionTokenLogprob;
  export import ChatCompletionTool = API.ChatCompletionTool;
  export import ChatCompletionToolChoiceOption = API.ChatCompletionToolChoiceOption;
  export import ChatCompletionToolMessageParam = API.ChatCompletionToolMessageParam;
  export import ChatCompletionUserMessageParam = API.ChatCompletionUserMessageParam;
  export import ChatCompletionCreateParams = API.ChatCompletionCreateParams;
  export import ChatCompletionCreateParamsNonStreaming = API.ChatCompletionCreateParamsNonStreaming;
  export import ChatCompletionCreateParamsStreaming = API.ChatCompletionCreateParamsStreaming;

  export import Embeddings = API.Embeddings;
  export import CreateEmbeddingResponse = API.CreateEmbeddingResponse;
  export import Embedding = API.Embedding;
  export import EmbeddingCreateParams = API.EmbeddingCreateParams;

  export import Files = API.Files;
  export import FileContent = API.FileContent;
  export import FileDeleted = API.FileDeleted;
  export import FileObject = API.FileObject;
  export type FileObjectsPage = API.FileObjectsPage;
  export import FileCreateParams = API.FileCreateParams;
  export import FileListParams = API.FileListParams;

  export import Images = API.Images;
  export import Image = API.Image;
  export import ImagesResponse = API.ImagesResponse;
  export import ImageCreateVariationParams = API.ImageCreateVariationParams;
  export import ImageEditParams = API.ImageEditParams;
  export import ImageGenerateParams = API.ImageGenerateParams;

  export import Audio = API.Audio;

  export import Moderations = API.Moderations;
  export import Moderation = API.Moderation;
  export import ModerationCreateResponse = API.ModerationCreateResponse;
  export import ModerationCreateParams = API.ModerationCreateParams;

  export import Models = API.Models;
  export import Model = API.Model;
  export import ModelDeleted = API.ModelDeleted;
  export type ModelsPage = API.ModelsPage;

  export import FineTuning = API.FineTuning;

  export import Beta = API.Beta;

  export import Batches = API.Batches;
  export import Batch = API.Batch;
  export import BatchError = API.BatchError;
  export import BatchRequestCounts = API.BatchRequestCounts;
  export type BatchesPage = API.BatchesPage;
  export import BatchCreateParams = API.BatchCreateParams;
  export import BatchListParams = API.BatchListParams;

  export import ErrorObject = API.ErrorObject;
  export import FunctionDefinition = API.FunctionDefinition;
  export import FunctionParameters = API.FunctionParameters;
}

// ---------------------- Azure ----------------------

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
   * A function that returns an access token for Microsoft Entra (formerly known as Azure Active Directory),
   * which will be invoked on every request.
   */
  azureADTokenProvider?: (() => Promise<string>) | undefined;
}

/** API Client for interfacing with the Azure OpenAI API. */
export class AzureOpenAI extends OpenAI {
  private _azureADTokenProvider: (() => Promise<string>) | undefined;
  private _deployment: string | undefined;
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
      dangerouslyAllowBrowser = true;
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

      baseURL = `${endpoint}/openai`;
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

    this._azureADTokenProvider = azureADTokenProvider;
    this.apiVersion = apiVersion;
    this._deployment = deployment;
  }

  override buildRequest(options: FinalRequestOptions<unknown>): {
    req: RequestInit;
    url: string;
    timeout: number;
  } {
    if (_deployments_endpoints.has(options.path) && options.method === 'post' && options.body !== undefined) {
      if (!isObj(options.body)) {
        throw new Error('Expected request body to be an object');
      }
      const model = this._deployment || options.body['model'];
      delete options.body['model'];
      if (model !== undefined && !this.baseURL.includes('/deployments')) {
        options.path = `/deployments/${model}${options.path}`;
      }
    }
    return super.buildRequest(options);
  }

  private async _getAzureADToken(): Promise<string | undefined> {
    if (typeof this._azureADTokenProvider === 'function') {
      const token = await this._azureADTokenProvider();
      if (!token || typeof token !== 'string') {
        throw new Errors.OpenAIError(
          `Expected 'azureADTokenProvider' argument to return a string but it returned ${token}`,
        );
      }
      return token;
    }
    return undefined;
  }

  protected override authHeaders(opts: FinalRequestOptions): Headers {
    return {};
  }

  protected override async prepareOptions(opts: FinalRequestOptions<unknown>): Promise<void> {
    if (opts.headers?.['Authorization'] || opts.headers?.['api-key']) {
      return super.prepareOptions(opts);
    }
    const token = await this._getAzureADToken();
    opts.headers ??= {};
    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    } else if (this.apiKey !== API_KEY_SENTINEL) {
      opts.headers['api-key'] = this.apiKey;
    } else {
      throw new Errors.OpenAIError('Unable to handle auth');
    }
    return super.prepareOptions(opts);
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
]);

const API_KEY_SENTINEL = '<Missing Key>';

// ---------------------- End Azure ----------------------

export default OpenAI;
