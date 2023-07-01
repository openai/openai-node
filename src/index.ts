// File generated from our OpenAPI spec by Stainless.

import * as qs from 'qs';
import * as Core from './core';
import * as Pagination from './pagination';
import * as API from './resources/index';
import * as Errors from './error';
import type { Agent } from 'openai/_shims/agent';
import * as Uploads from './uploads';

type Config = {
  /**
   * Defaults to process.env["OPENAI_API_KEY"].
   */
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  httpAgent?: Agent;
  maxRetries?: number;
  defaultHeaders?: Core.Headers;
};

/** Instantiate the API Client. */
export class OpenAI extends Core.APIClient {
  apiKey: string;

  private _options: Config;

  constructor(config?: Config) {
    const options: Config = {
      apiKey: typeof process === 'undefined' ? '' : process.env['OPENAI_API_KEY'] || '',
      baseURL: 'https://api.openai.com/v1',
      ...config,
    };

    if (!options.apiKey && options.apiKey !== null) {
      throw new Error(
        "The OPENAI_API_KEY environment variable is missing or empty; either provide it, or instantiate the OpenAI client with an apiKey option, like new OpenAI({ apiKey: 'my api key' }).",
      );
    }

    super({
      baseURL: options.baseURL!,
      timeout: options.timeout,
      httpAgent: options.httpAgent,
      maxRetries: options.maxRetries,
    });
    this.apiKey = options.apiKey;
    this._options = options;
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

  protected override defaultHeaders(): Core.Headers {
    return {
      ...super.defaultHeaders(),
      ...this._options.defaultHeaders,
    };
  }

  protected override authHeaders(): Core.Headers {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  protected override qsOptions(): qs.IStringifyOptions {
    return { arrayFormat: 'comma' };
  }

  static APIError = Errors.APIError;
  static APIConnectionError = Errors.APIConnectionError;
  static APIConnectionTimeoutError = Errors.APIConnectionTimeoutError;
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
  export import PageResponse = Pagination.PageResponse;

  export import Completions = API.Completions;
  export import Completion = API.Completion;
  export import CompletionChoice = API.CompletionChoice;
  export import CompletionCreateParams = API.CompletionCreateParams;

  export import Chat = API.Chat;

  export import Edits = API.Edits;
  export import Edit = API.Edit;
  export import EditCreateParams = API.EditCreateParams;

  export import Embeddings = API.Embeddings;
  export import Embedding = API.Embedding;
  export import EmbeddingCreateParams = API.EmbeddingCreateParams;

  export import Files = API.Files;
  export import FileContent = API.FileContent;
  export import FileDeleted = API.FileDeleted;
  export import FileObject = API.FileObject;
  export import FileObjectsPage = API.FileObjectsPage;
  export import FileCreateParams = API.FileCreateParams;

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
  export import ModelsPage = API.ModelsPage;

  export import FineTunes = API.FineTunes;
  export import FineTune = API.FineTune;
  export import FineTuneEvent = API.FineTuneEvent;
  export import FineTuneEventsListResponse = API.FineTuneEventsListResponse;
  export import FineTunesPage = API.FineTunesPage;
  export import FineTuneCreateParams = API.FineTuneCreateParams;
  export import FineTuneListEventsParams = API.FineTuneListEventsParams;
}

export default OpenAI;
