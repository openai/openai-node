// File generated from our OpenAPI spec by Stainless.

import * as Core from "./core.ts";
import * as Pagination from "./pagination.ts";
import * as API from "./resources/mod.ts";
import * as Errors from "./error.ts";
import type { Agent } from "./_shims/agent.ts";
import * as Uploads from "./uploads.ts";

export interface ClientOptions {
  /**
   * Defaults to process.env["OPENAI_API_KEY"].
   */
  apiKey?: string;

  /**
   * Override the default base URL for the API, e.g., "https://api.example.com/v2/"
   */
  baseURL?: string;

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

  organization?: string | null;
}

/** Instantiate the API Client. */
export class OpenAI extends Core.APIClient {
  apiKey: string;
  organization?: string | null;

  private _options: ClientOptions;

  constructor({
    apiKey = Core.readEnv("OPENAI_API_KEY"),
    organization = Core.readEnv("OPENAI_ORG_ID") ?? null,
    ...opts
  }: ClientOptions = {}) {
    if (apiKey === undefined) {
      throw new Error(
        "The OPENAI_API_KEY environment variable is missing or empty; either provide it, or instantiate the OpenAI client with an apiKey option, like new OpenAI({ apiKey: undefined }).",
      );
    }

    const options: ClientOptions = {
      apiKey,
      organization,
      baseURL: `https://api.openai.com/v1`,
      ...opts,
    };

    if (!options.dangerouslyAllowBrowser && Core.isRunningInBrowser()) {
      throw new Error(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n",
      );
    }

    super({
      baseURL: options.baseURL!,
      timeout: options.timeout ?? 600000, /* 10 minutes */
      httpAgent: options.httpAgent,
      maxRetries: options.maxRetries,
      fetch: options.fetch,
    });
    this._options = options;

    this.apiKey = apiKey;
    this.organization = organization;
  }

  completions: API.Completions = new API.Completions(this);
  chat: API.Chat = new API.Chat(this);
  edits: API.Edits = new API.Edits(this);
  embeddings: API.Embeddings = new API.Embeddings(this);
  files: API.Files = new API.Files(this);
  images: API.Images = new API.Images(this);
  audio: API.Audio = new API.Audio(this);
  moderations: API.Moderations = new API.Moderations(this);
  models: API.Models = new API.Models(this);
  fineTunes: API.FineTunes = new API.FineTunes(this);

  protected override defaultQuery(): Core.DefaultQuery | undefined {
    return this._options.defaultQuery;
  }

  protected override defaultHeaders(): Core.Headers {
    return {
      ...super.defaultHeaders(),
      "OpenAI-Organization": this.organization,
      ...this._options.defaultHeaders,
    };
  }

  protected override authHeaders(): Core.Headers {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  static OpenAI = this;

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
}

export const {
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
  // Helper functions
  export import toFile = Uploads.toFile;
  export import fileFromPath = Uploads.fileFromPath;

  export import Page = Pagination.Page;
  export type PageResponse<Item> = Pagination.PageResponse<Item>;

  export type Completions = API.Completions;
  export type Completion = API.Completion;
  export type CompletionChoice = API.CompletionChoice;
  export type CompletionUsage = API.CompletionUsage;
  export type CompletionCreateParams = API.CompletionCreateParams;
  export type CompletionCreateParamsNonStreaming =
    API.CompletionCreateParamsNonStreaming;
  export type CompletionCreateParamsStreaming =
    API.CompletionCreateParamsStreaming;

  export type Chat = API.Chat;

  export type Edits = API.Edits;
  export type Edit = API.Edit;
  export type EditCreateParams = API.EditCreateParams;

  export type Embeddings = API.Embeddings;
  export type CreateEmbeddingResponse = API.CreateEmbeddingResponse;
  export type Embedding = API.Embedding;
  export type EmbeddingCreateParams = API.EmbeddingCreateParams;

  export type Files = API.Files;
  export type FileContent = API.FileContent;
  export type FileDeleted = API.FileDeleted;
  export type FileObject = API.FileObject;
  export type FileObjectsPage = API.FileObjectsPage;
  export type FileCreateParams = API.FileCreateParams;

  export type Images = API.Images;
  export type Image = API.Image;
  export type ImagesResponse = API.ImagesResponse;
  export type ImageCreateVariationParams = API.ImageCreateVariationParams;
  export type ImageEditParams = API.ImageEditParams;
  export type ImageGenerateParams = API.ImageGenerateParams;

  export type Audio = API.Audio;

  export type Moderations = API.Moderations;
  export type Moderation = API.Moderation;
  export type ModerationCreateResponse = API.ModerationCreateResponse;
  export type ModerationCreateParams = API.ModerationCreateParams;

  export type Models = API.Models;
  export type Model = API.Model;
  export type ModelDeleted = API.ModelDeleted;
  export type ModelsPage = API.ModelsPage;

  export type FineTunes = API.FineTunes;
  export type FineTune = API.FineTune;
  export type FineTuneEvent = API.FineTuneEvent;
  export type FineTuneEventsListResponse = API.FineTuneEventsListResponse;
  export type FineTunesPage = API.FineTunesPage;
  export type FineTuneCreateParams = API.FineTuneCreateParams;
  export type FineTuneListEventsParams = API.FineTuneListEventsParams;
  export type FineTuneListEventsParamsNonStreaming =
    API.FineTuneListEventsParamsNonStreaming;
  export type FineTuneListEventsParamsStreaming =
    API.FineTuneListEventsParamsStreaming;
}

export default OpenAI;
