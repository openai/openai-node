// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import * as API from './';

export class Moderations extends APIResource {
  /**
   * Classifies if text violates OpenAI's Content Policy
   */
  create(
    body: ModerationCreateParams,
    options?: Core.RequestOptions,
  ): Promise<Core.APIResponse<ModerationCreateResponse>> {
    return this.post('/moderations', { body, ...options });
  }
}

export interface Moderation {
  categories: Moderation.Categories;

  category_scores: Moderation.CategoryScores;

  flagged: boolean;
}

export namespace Moderation {
  export interface Categories {
    hate: boolean;

    'hate/threatening': boolean;

    'self-harm': boolean;

    sexual: boolean;

    'sexual/minors': boolean;

    violence: boolean;

    'violence/graphic': boolean;
  }

  export interface CategoryScores {
    hate: number;

    'hate/threatening': number;

    'self-harm': number;

    sexual: number;

    'sexual/minors': number;

    violence: number;

    'violence/graphic': number;
  }
}

export interface ModerationCreateResponse {
  id: string;

  model: string;

  results: Array<Moderation>;
}

export interface ModerationCreateParams {
  /**
   * The input text to classify
   */
  input: string | Array<string>;

  /**
   * Two content moderations models are available: `text-moderation-stable` and
   * `text-moderation-latest`.
   *
   * The default is `text-moderation-latest` which will be automatically upgraded
   * over time. This ensures you are always using our most accurate model. If you use
   * `text-moderation-stable`, we will provide advanced notice before updating the
   * model. Accuracy of `text-moderation-stable` may be slightly lower than for
   * `text-moderation-latest`.
   */
  model?: (string & {}) | 'text-moderation-latest' | 'text-moderation-stable';
}

export namespace Moderations {
  export import Moderation = API.Moderation;
  export import ModerationCreateResponse = API.ModerationCreateResponse;
  export import ModerationCreateParams = API.ModerationCreateParams;
}
