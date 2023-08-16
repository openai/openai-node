// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import * as API from './index';

export class Moderations extends APIResource {
  /**
   * Classifies if text violates OpenAI's Content Policy
   */
  create(
    body: ModerationCreateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<ModerationCreateResponse> {
    return this.post('/moderations', { body, ...options });
  }
}

export interface Moderation {
  /**
   * A list of the categories, and whether they are flagged or not.
   */
  categories: Moderation.Categories;

  /**
   * A list of the categories along with their scores as predicted by model.
   */
  category_scores: Moderation.CategoryScores;

  /**
   * Whether the content violates
   * [OpenAI's usage policies](/policies/usage-policies).
   */
  flagged: boolean;
}

export namespace Moderation {
  /**
   * A list of the categories, and whether they are flagged or not.
   */
  export interface Categories {
    /**
     * Whether the content was flagged as 'hate'.
     */
    hate: boolean;

    /**
     * Whether the content was flagged as 'hate/threatening'.
     */
    'hate/threatening': boolean;

    /**
     * Whether the content was flagged as 'self-harm'.
     */
    'self-harm': boolean;

    /**
     * Whether the content was flagged as 'sexual'.
     */
    sexual: boolean;

    /**
     * Whether the content was flagged as 'sexual/minors'.
     */
    'sexual/minors': boolean;

    /**
     * Whether the content was flagged as 'violence'.
     */
    violence: boolean;

    /**
     * Whether the content was flagged as 'violence/graphic'.
     */
    'violence/graphic': boolean;
  }

  /**
   * A list of the categories along with their scores as predicted by model.
   */
  export interface CategoryScores {
    /**
     * The score for the category 'hate'.
     */
    hate: number;

    /**
     * The score for the category 'hate/threatening'.
     */
    'hate/threatening': number;

    /**
     * The score for the category 'self-harm'.
     */
    'self-harm': number;

    /**
     * The score for the category 'sexual'.
     */
    sexual: number;

    /**
     * The score for the category 'sexual/minors'.
     */
    'sexual/minors': number;

    /**
     * The score for the category 'violence'.
     */
    violence: number;

    /**
     * The score for the category 'violence/graphic'.
     */
    'violence/graphic': number;
  }
}

/**
 * Represents policy compliance report by OpenAI's content moderation model against
 * a given input.
 */
export interface ModerationCreateResponse {
  /**
   * The unique identifier for the moderation request.
   */
  id: string;

  /**
   * The model used to generate the moderation results.
   */
  model: string;

  /**
   * A list of moderation objects.
   */
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
