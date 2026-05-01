// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { RequestOptions } from '../../../internal/request-options';

export class Usage extends APIResource {
  /**
   * Get audio speeches usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.audioSpeeches({
   *     start_time: 0,
   *   });
   * ```
   */
  audioSpeeches(
    query: UsageAudioSpeechesParams,
    options?: RequestOptions,
  ): APIPromise<UsageAudioSpeechesResponse> {
    return this._client.get('/organization/usage/audio_speeches', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get audio transcriptions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.audioTranscriptions(
   *     { start_time: 0 },
   *   );
   * ```
   */
  audioTranscriptions(
    query: UsageAudioTranscriptionsParams,
    options?: RequestOptions,
  ): APIPromise<UsageAudioTranscriptionsResponse> {
    return this._client.get('/organization/usage/audio_transcriptions', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get code interpreter sessions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.codeInterpreterSessions(
   *     { start_time: 0 },
   *   );
   * ```
   */
  codeInterpreterSessions(
    query: UsageCodeInterpreterSessionsParams,
    options?: RequestOptions,
  ): APIPromise<UsageCodeInterpreterSessionsResponse> {
    return this._client.get('/organization/usage/code_interpreter_sessions', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get completions usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.completions({
   *     start_time: 0,
   *   });
   * ```
   */
  completions(query: UsageCompletionsParams, options?: RequestOptions): APIPromise<UsageCompletionsResponse> {
    return this._client.get('/organization/usage/completions', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get costs details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.costs({
   *     start_time: 0,
   *   });
   * ```
   */
  costs(query: UsageCostsParams, options?: RequestOptions): APIPromise<UsageCostsResponse> {
    return this._client.get('/organization/costs', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get embeddings usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.embeddings({
   *     start_time: 0,
   *   });
   * ```
   */
  embeddings(query: UsageEmbeddingsParams, options?: RequestOptions): APIPromise<UsageEmbeddingsResponse> {
    return this._client.get('/organization/usage/embeddings', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get images usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.images({
   *     start_time: 0,
   *   });
   * ```
   */
  images(query: UsageImagesParams, options?: RequestOptions): APIPromise<UsageImagesResponse> {
    return this._client.get('/organization/usage/images', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get moderations usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.moderations({
   *     start_time: 0,
   *   });
   * ```
   */
  moderations(query: UsageModerationsParams, options?: RequestOptions): APIPromise<UsageModerationsResponse> {
    return this._client.get('/organization/usage/moderations', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get vector stores usage details for the organization.
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.usage.vectorStores({
   *     start_time: 0,
   *   });
   * ```
   */
  vectorStores(
    query: UsageVectorStoresParams,
    options?: RequestOptions,
  ): APIPromise<UsageVectorStoresResponse> {
    return this._client.get('/organization/usage/vector_stores', {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export interface UsageAudioSpeechesResponse {
  data: Array<UsageAudioSpeechesResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageAudioSpeechesResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageAudioTranscriptionsResponse {
  data: Array<UsageAudioTranscriptionsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageAudioTranscriptionsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageCodeInterpreterSessionsResponse {
  data: Array<UsageCodeInterpreterSessionsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageCodeInterpreterSessionsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageCompletionsResponse {
  data: Array<UsageCompletionsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageCompletionsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageCostsResponse {
  data: Array<UsageCostsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageCostsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageEmbeddingsResponse {
  data: Array<UsageEmbeddingsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageEmbeddingsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageImagesResponse {
  data: Array<UsageImagesResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageImagesResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageModerationsResponse {
  data: Array<UsageModerationsResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageModerationsResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageVectorStoresResponse {
  data: Array<UsageVectorStoresResponse.Data>;

  has_more: boolean;

  next_page: string | null;

  object: 'page';
}

export namespace UsageVectorStoresResponse {
  export interface Data {
    end_time: number;

    object: 'bucket';

    results: Array<
      | Data.OrganizationUsageCompletionsResult
      | Data.OrganizationUsageEmbeddingsResult
      | Data.OrganizationUsageModerationsResult
      | Data.OrganizationUsageImagesResult
      | Data.OrganizationUsageAudioSpeechesResult
      | Data.OrganizationUsageAudioTranscriptionsResult
      | Data.OrganizationUsageVectorStoresResult
      | Data.OrganizationUsageCodeInterpreterSessionsResult
      | Data.OrganizationCostsResult
    >;

    start_time: number;
  }

  export namespace Data {
    /**
     * The aggregated completions usage details of the specific time bucket.
     */
    export interface OrganizationUsageCompletionsResult {
      /**
       * The aggregated number of text input tokens used, including cached tokens. For
       * customers subscribe to scale tier, this includes scale tier tokens.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.completions.result';

      /**
       * The aggregated number of text output tokens used. For customers subscribe to
       * scale tier, this includes scale tier tokens.
       */
      output_tokens: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=batch`, this field tells whether the grouped usage result is
       * batch or not.
       */
      batch?: boolean | null;

      /**
       * The aggregated number of audio input tokens used, including cached tokens.
       */
      input_audio_tokens?: number;

      /**
       * The aggregated number of text input tokens that has been cached from previous
       * requests. For customers subscribe to scale tier, this includes scale tier
       * tokens.
       */
      input_cached_tokens?: number;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * The aggregated number of audio output tokens used.
       */
      output_audio_tokens?: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=service_tier`, this field provides the service tier of the
       * grouped usage result.
       */
      service_tier?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated embeddings usage details of the specific time bucket.
     */
    export interface OrganizationUsageEmbeddingsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.embeddings.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated moderations usage details of the specific time bucket.
     */
    export interface OrganizationUsageModerationsResult {
      /**
       * The aggregated number of input tokens used.
       */
      input_tokens: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.moderations.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated images usage details of the specific time bucket.
     */
    export interface OrganizationUsageImagesResult {
      /**
       * The number of images processed.
       */
      images: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.images.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=size`, this field provides the image size of the grouped usage
       * result.
       */
      size?: string | null;

      /**
       * When `group_by=source`, this field provides the source of the grouped usage
       * result, possible values are `image.generation`, `image.edit`, `image.variation`.
       */
      source?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio speeches usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioSpeechesResult {
      /**
       * The number of characters processed.
       */
      characters: number;

      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_speeches.result';

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated audio transcriptions usage details of the specific time bucket.
     */
    export interface OrganizationUsageAudioTranscriptionsResult {
      /**
       * The count of requests made to the model.
       */
      num_model_requests: number;

      object: 'organization.usage.audio_transcriptions.result';

      /**
       * The number of seconds processed.
       */
      seconds: number;

      /**
       * When `group_by=api_key_id`, this field provides the API key ID of the grouped
       * usage result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=model`, this field provides the model name of the grouped usage
       * result.
       */
      model?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;

      /**
       * When `group_by=user_id`, this field provides the user ID of the grouped usage
       * result.
       */
      user_id?: string | null;
    }

    /**
     * The aggregated vector stores usage details of the specific time bucket.
     */
    export interface OrganizationUsageVectorStoresResult {
      object: 'organization.usage.vector_stores.result';

      /**
       * The vector stores usage in bytes.
       */
      usage_bytes: number;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated code interpreter sessions usage details of the specific time
     * bucket.
     */
    export interface OrganizationUsageCodeInterpreterSessionsResult {
      /**
       * The number of code interpreter sessions.
       */
      num_sessions: number;

      object: 'organization.usage.code_interpreter_sessions.result';

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * usage result.
       */
      project_id?: string | null;
    }

    /**
     * The aggregated costs details of the specific time bucket.
     */
    export interface OrganizationCostsResult {
      object: 'organization.costs.result';

      /**
       * The monetary value in its associated currency.
       */
      amount?: OrganizationCostsResult.Amount;

      /**
       * When `group_by=api_key_id`, this field provides the API Key ID of the grouped
       * costs result.
       */
      api_key_id?: string | null;

      /**
       * When `group_by=line_item`, this field provides the line item of the grouped
       * costs result.
       */
      line_item?: string | null;

      /**
       * When `group_by=project_id`, this field provides the project ID of the grouped
       * costs result.
       */
      project_id?: string | null;
    }

    export namespace OrganizationCostsResult {
      /**
       * The monetary value in its associated currency.
       */
      export interface Amount {
        /**
         * Lowercase ISO-4217 currency e.g. "usd"
         */
        currency?: string;

        /**
         * The numeric value of the cost.
         */
        value?: number;
      }
    }
  }
}

export interface UsageAudioSpeechesParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model` or any combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageAudioTranscriptionsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model` or any combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageCodeInterpreterSessionsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`.
   */
  group_by?: Array<'project_id'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;
}

export interface UsageCompletionsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * If `true`, return batch jobs only. If `false`, return non-batch jobs only. By
   * default, return both.
   */
  batch?: boolean;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier` or any
   * combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model' | 'batch' | 'service_tier'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageCostsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only costs for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently only `1d` is supported, default
   * to `1d`.
   */
  bucket_width?: '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the costs by the specified fields. Support fields include `project_id`,
   * `line_item`, `api_key_id` and any combination of them.
   */
  group_by?: Array<'project_id' | 'line_item' | 'api_key_id'>;

  /**
   * A limit on the number of buckets to be returned. Limit can range between 1 and
   * 180, and the default is 7.
   */
  limit?: number;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only costs for these projects.
   */
  project_ids?: Array<string>;
}

export interface UsageEmbeddingsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model` or any combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageImagesParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model`, `size`, `source` or any
   * combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model' | 'size' | 'source'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usages for these image sizes. Possible values are `256x256`,
   * `512x512`, `1024x1024`, `1792x1792`, `1024x1792` or any combination of them.
   */
  sizes?: Array<'256x256' | '512x512' | '1024x1024' | '1792x1792' | '1024x1792'>;

  /**
   * Return only usages for these sources. Possible values are `image.generation`,
   * `image.edit`, `image.variation` or any combination of them.
   */
  sources?: Array<'image.generation' | 'image.edit' | 'image.variation'>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageModerationsParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Return only usage for these API keys.
   */
  api_key_ids?: Array<string>;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`, `user_id`, `api_key_id`, `model` or any combination of them.
   */
  group_by?: Array<'project_id' | 'user_id' | 'api_key_id' | 'model'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * Return only usage for these models.
   */
  models?: Array<string>;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only usage for these users.
   */
  user_ids?: Array<string>;
}

export interface UsageVectorStoresParams {
  /**
   * Start time (Unix seconds) of the query time range, inclusive.
   */
  start_time: number;

  /**
   * Width of each time bucket in response. Currently `1m`, `1h` and `1d` are
   * supported, default to `1d`.
   */
  bucket_width?: '1m' | '1h' | '1d';

  /**
   * End time (Unix seconds) of the query time range, exclusive.
   */
  end_time?: number;

  /**
   * Group the usage data by the specified fields. Support fields include
   * `project_id`.
   */
  group_by?: Array<'project_id'>;

  /**
   * Specifies the number of buckets to return.
   *
   * - `bucket_width=1d`: default: 7, max: 31
   * - `bucket_width=1h`: default: 24, max: 168
   * - `bucket_width=1m`: default: 60, max: 1440
   */
  limit?: number;

  /**
   * A cursor for use in pagination. Corresponding to the `next_page` field from the
   * previous response.
   */
  page?: string;

  /**
   * Return only usage for these projects.
   */
  project_ids?: Array<string>;
}

export declare namespace Usage {
  export {
    type UsageAudioSpeechesResponse as UsageAudioSpeechesResponse,
    type UsageAudioTranscriptionsResponse as UsageAudioTranscriptionsResponse,
    type UsageCodeInterpreterSessionsResponse as UsageCodeInterpreterSessionsResponse,
    type UsageCompletionsResponse as UsageCompletionsResponse,
    type UsageCostsResponse as UsageCostsResponse,
    type UsageEmbeddingsResponse as UsageEmbeddingsResponse,
    type UsageImagesResponse as UsageImagesResponse,
    type UsageModerationsResponse as UsageModerationsResponse,
    type UsageVectorStoresResponse as UsageVectorStoresResponse,
    type UsageAudioSpeechesParams as UsageAudioSpeechesParams,
    type UsageAudioTranscriptionsParams as UsageAudioTranscriptionsParams,
    type UsageCodeInterpreterSessionsParams as UsageCodeInterpreterSessionsParams,
    type UsageCompletionsParams as UsageCompletionsParams,
    type UsageCostsParams as UsageCostsParams,
    type UsageEmbeddingsParams as UsageEmbeddingsParams,
    type UsageImagesParams as UsageImagesParams,
    type UsageModerationsParams as UsageModerationsParams,
    type UsageVectorStoresParams as UsageVectorStoresParams,
  };
}
