// File generated from our OpenAPI spec by Stainless.

import qs from 'qs';
import * as Core from './core';
import * as API from './resources';
import * as Errors from '~/error';
import type { Agent } from 'http';
import * as FileFromPath from 'formdata-node/file-from-path';

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
      apiKey: process.env['OPENAI_API_KEY'] || '',
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
  answers: API.Answers = new API.Answers(this);
  classifications: API.Classifications = new API.Classifications(this);
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

export import fileFromPath = FileFromPath.fileFromPath;

export namespace OpenAI {
  // Helper functions
  export import fileFromPath = FileFromPath.fileFromPath;

  export import Completion = API.Completion;
  export import CompletionChoice = API.CompletionChoice;
  export import CompletionCreateParams = API.CompletionCreateParams;

  export import Edit = API.Edit;
  export import EditCreateParams = API.EditCreateParams;

  export import Embedding = API.Embedding;
  export import EmbeddingCreateParams = API.EmbeddingCreateParams;

  export import File = API.File;
  export import FileListResponse = API.FileListResponse;
  export import FileDeleteResponse = API.FileDeleteResponse;
  export import FileRetrieveFileContentResponse = API.FileRetrieveFileContentResponse;
  export import FileCreateParams = API.FileCreateParams;

  export import Image = API.Image;
  export import ImagesResponse = API.ImagesResponse;
  export import ImageCreateVariationParams = API.ImageCreateVariationParams;
  export import ImageEditParams = API.ImageEditParams;
  export import ImageGenerateParams = API.ImageGenerateParams;

  export import AnswerCreateResponse = API.AnswerCreateResponse;
  export import AnswerCreateParams = API.AnswerCreateParams;

  export import ClassificationCreateResponse = API.ClassificationCreateResponse;
  export import ClassificationCreateParams = API.ClassificationCreateParams;

  export import Moderation = API.Moderation;
  export import ModerationCreateResponse = API.ModerationCreateResponse;
  export import ModerationCreateParams = API.ModerationCreateParams;

  export import DeleteModelResponse = API.DeleteModelResponse;
  export import ListModelsResponse = API.ListModelsResponse;
  export import Model = API.Model;

  export import FineTune = API.FineTune;
  export import FineTuneEvent = API.FineTuneEvent;
  export import ListFineTuneEventsResponse = API.ListFineTuneEventsResponse;
  export import ListFineTunesResponse = API.ListFineTunesResponse;
  export import FineTuneCreateParams = API.FineTuneCreateParams;
  export import FineTuneListEventsParams = API.FineTuneListEventsParams;
}

exports = module.exports = OpenAI;
export default OpenAI;
