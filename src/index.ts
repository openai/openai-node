// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as Errors from './error';
import * as Uploads from './uploads';
import { type Agent } from './_shims/index';
import * as qs from './internal/qs';
import * as Core from './core';
import * as Pagination from './pagination';
import * as API from './resources/index';

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
   * If not provided, we use `node-fetch` on Node.js and otherwise expect that `fetch` is
   * defined globally.
   */
  fetch?: Core.Fetch | undefined;

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
  defaultHeaders?: Core.Headers;

  /**
   * Default query parameters to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * param to `undefined` in request options.
   */
  defaultQuery?: Core.DefaultQuery;

  /**
   * By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   * Only set this option to `true` if you understand the risks and have appropriate mitigations in place.
   */
  dangerouslyAllowBrowser?: boolean;
}

/**
 * API Client for interfacing with the OpenAI API.
 */
export class OpenAI extends Core.APIClient {
  apiKey: string;
  organization: string | null;
  project: string | null;

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
   * @param {Core.Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {Core.Headers} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Core.DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({
    baseURL = Core.readEnv('OPENAI_BASE_URL'),
    apiKey = Core.readEnv('OPENAI_API_KEY'),
    organization = Core.readEnv('OPENAI_ORG_ID') ?? null,
    project = Core.readEnv('OPENAI_PROJECT_ID') ?? null,
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

    if (!options.dangerouslyAllowBrowser && Core.isRunningInBrowser()) {
      throw new Errors.OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n",
      );
    }

    super({
      baseURL: options.baseURL!,
      timeout: options.timeout ?? 600000 /* 10 minutes */,
      httpAgent: options.httpAgent,
      maxRetries: options.maxRetries,
      fetch: options.fetch,
    });

    this._options = options;

    this.apiKey = apiKey;
    this.organization = organization;
    this.project = project;
  }

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
  uploads: API.Uploads = new API.Uploads(this);

  protected override defaultQuery(): Core.DefaultQuery | undefined {
    return this._options.defaultQuery;
  }

  protected override defaultHeaders(opts: Core.FinalRequestOptions): Core.Headers {
    return {
      ...super.defaultHeaders(opts),
      'OpenAI-Organization': this.organization,
      'OpenAI-Project': this.project,
      ...this._options.defaultHeaders,
    };
  }

  protected override authHeaders(opts: Core.FinalRequestOptions): Core.Headers {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  protected override stringifyQuery(query: Record<string, unknown>): string {
    return qs.stringify(query, { arrayFormat: 'brackets' });
  }

  static OpenAI = this;
  static DEFAULT_TIMEOUT = 600000; // 10 minutes

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
  static fileFromPath = Uploads.fileFromPath;
}

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
export import fileFromPath = Uploads.fileFromPath;

export namespace OpenAI {
  export type RequestOptions = Core.RequestOptions;

  export import Page = Pagination.Page;
  export type PageResponse<T> = Pagination.PageResponse<T>;

  export import CursorPage = Pagination.CursorPage;
  export type CursorPageParams = Pagination.CursorPageParams;
  export type CursorPageResponse<T> = Pagination.CursorPageResponse<T>;

  export import Completions = API.Completions;
  export type Completion = API.Completion;
  export type CompletionChoice = API.CompletionChoice;
  export type CompletionUsage = API.CompletionUsage;
  export type CompletionCreateParams = API.CompletionCreateParams;
  export type CompletionCreateParamsNonStreaming = API.CompletionCreateParamsNonStreaming;
  export type CompletionCreateParamsStreaming = API.CompletionCreateParamsStreaming;

  export import Chat = API.Chat;
  export type ChatModel = API.ChatModel;
  export type ChatCompletion = API.ChatCompletion;
  export type ChatCompletionAssistantMessageParam = API.ChatCompletionAssistantMessageParam;
  export type ChatCompletionAudio = API.ChatCompletionAudio;
  export type ChatCompletionAudioParam = API.ChatCompletionAudioParam;
  export type ChatCompletionChunk = API.ChatCompletionChunk;
  export type ChatCompletionContentPart = API.ChatCompletionContentPart;
  export type ChatCompletionContentPartImage = API.ChatCompletionContentPartImage;
  export type ChatCompletionContentPartInputAudio = API.ChatCompletionContentPartInputAudio;
  export type ChatCompletionContentPartRefusal = API.ChatCompletionContentPartRefusal;
  export type ChatCompletionContentPartText = API.ChatCompletionContentPartText;
  export type ChatCompletionFunctionCallOption = API.ChatCompletionFunctionCallOption;
  export type ChatCompletionFunctionMessageParam = API.ChatCompletionFunctionMessageParam;
  export type ChatCompletionMessage = API.ChatCompletionMessage;
  export type ChatCompletionMessageParam = API.ChatCompletionMessageParam;
  export type ChatCompletionMessageToolCall = API.ChatCompletionMessageToolCall;
  export type ChatCompletionModality = API.ChatCompletionModality;
  export type ChatCompletionNamedToolChoice = API.ChatCompletionNamedToolChoice;
  export type ChatCompletionRole = API.ChatCompletionRole;
  export type ChatCompletionStreamOptions = API.ChatCompletionStreamOptions;
  export type ChatCompletionSystemMessageParam = API.ChatCompletionSystemMessageParam;
  export type ChatCompletionTokenLogprob = API.ChatCompletionTokenLogprob;
  export type ChatCompletionTool = API.ChatCompletionTool;
  export type ChatCompletionToolChoiceOption = API.ChatCompletionToolChoiceOption;
  export type ChatCompletionToolMessageParam = API.ChatCompletionToolMessageParam;
  export type ChatCompletionUserMessageParam = API.ChatCompletionUserMessageParam;
  export type ChatCompletionCreateParams = API.ChatCompletionCreateParams;
  export type ChatCompletionCreateParamsNonStreaming = API.ChatCompletionCreateParamsNonStreaming;
  export type ChatCompletionCreateParamsStreaming = API.ChatCompletionCreateParamsStreaming;

  export import Embeddings = API.Embeddings;
  export type CreateEmbeddingResponse = API.CreateEmbeddingResponse;
  export type Embedding = API.Embedding;
  export type EmbeddingModel = API.EmbeddingModel;
  export type EmbeddingCreateParams = API.EmbeddingCreateParams;

  export import Files = API.Files;
  export type FileContent = API.FileContent;
  export type FileDeleted = API.FileDeleted;
  export type FileObject = API.FileObject;
  export type FilePurpose = API.FilePurpose;
  export import FileObjectsPage = API.FileObjectsPage;
  export type FileCreateParams = API.FileCreateParams;
  export type FileListParams = API.FileListParams;

  export import Images = API.Images;
  export type Image = API.Image;
  export type ImageModel = API.ImageModel;
  export type ImagesResponse = API.ImagesResponse;
  export type ImageCreateVariationParams = API.ImageCreateVariationParams;
  export type ImageEditParams = API.ImageEditParams;
  export type ImageGenerateParams = API.ImageGenerateParams;

  export import Audio = API.Audio;
  export type AudioModel = API.AudioModel;
  export type AudioResponseFormat = API.AudioResponseFormat;

  export import Moderations = API.Moderations;
  export type Moderation = API.Moderation;
  export type ModerationImageURLInput = API.ModerationImageURLInput;
  export type ModerationModel = API.ModerationModel;
  export type ModerationMultiModalInput = API.ModerationMultiModalInput;
  export type ModerationTextInput = API.ModerationTextInput;
  export type ModerationCreateResponse = API.ModerationCreateResponse;
  export type ModerationCreateParams = API.ModerationCreateParams;

  export import Models = API.Models;
  export type Model = API.Model;
  export type ModelDeleted = API.ModelDeleted;
  export import ModelsPage = API.ModelsPage;

  export import FineTuning = API.FineTuning;

  export import Beta = API.Beta;

  export import Batches = API.Batches;
  export type Batch = API.Batch;
  export type BatchError = API.BatchError;
  export type BatchRequestCounts = API.BatchRequestCounts;
  export import BatchesPage = API.BatchesPage;
  export type BatchCreateParams = API.BatchCreateParams;
  export type BatchListParams = API.BatchListParams;

  export import Uploads = API.Uploads;
  export type Upload = API.Upload;
  export type UploadCreateParams = API.UploadCreateParams;
  export type UploadCompleteParams = API.UploadCompleteParams;

  export type ErrorObject = API.ErrorObject;
  export type FunctionDefinition = API.FunctionDefinition;
  export type FunctionParameters = API.FunctionParameters;
  export type ResponseFormatJSONObject = API.ResponseFormatJSONObject;
  export type ResponseFormatJSONSchema = API.ResponseFormatJSONSchema;
  export type ResponseFormatText = API.ResponseFormatText;
}

export default OpenAI;
