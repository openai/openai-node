// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import { isRequestOptions } from '../../../core';
import * as Core from '../../../core';
import * as CheckpointsAPI from './checkpoints';
import {
  CheckpointListParams,
  Checkpoints,
  FineTuningJobCheckpoint,
  FineTuningJobCheckpointsPage,
} from './checkpoints';
import { CursorPage, type CursorPageParams } from '../../../pagination';

export class Jobs extends APIResource {
  checkpoints: CheckpointsAPI.Checkpoints = new CheckpointsAPI.Checkpoints(this._client);

  /**
   * Creates a fine-tuning job which begins the process of creating a new model from
   * a given dataset.
   *
   * Response includes details of the enqueued job including job status and the name
   * of the fine-tuned models once complete.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/fine-tuning)
   */
  create(body: JobCreateParams, options?: Core.RequestOptions): Core.APIPromise<FineTuningJob> {
    return this._client.post('/fine_tuning/jobs', { body, ...options });
  }

  /**
   * Get info about a fine-tuning job.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/fine-tuning)
   */
  retrieve(fineTuningJobId: string, options?: Core.RequestOptions): Core.APIPromise<FineTuningJob> {
    return this._client.get(`/fine_tuning/jobs/${fineTuningJobId}`, options);
  }

  /**
   * List your organization's fine-tuning jobs
   */
  list(
    query?: JobListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<FineTuningJobsPage, FineTuningJob>;
  list(options?: Core.RequestOptions): Core.PagePromise<FineTuningJobsPage, FineTuningJob>;
  list(
    query: JobListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<FineTuningJobsPage, FineTuningJob> {
    if (isRequestOptions(query)) {
      return this.list({}, query);
    }
    return this._client.getAPIList('/fine_tuning/jobs', FineTuningJobsPage, { query, ...options });
  }

  /**
   * Immediately cancel a fine-tune job.
   */
  cancel(fineTuningJobId: string, options?: Core.RequestOptions): Core.APIPromise<FineTuningJob> {
    return this._client.post(`/fine_tuning/jobs/${fineTuningJobId}/cancel`, options);
  }

  /**
   * Get status updates for a fine-tuning job.
   */
  listEvents(
    fineTuningJobId: string,
    query?: JobListEventsParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<FineTuningJobEventsPage, FineTuningJobEvent>;
  listEvents(
    fineTuningJobId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<FineTuningJobEventsPage, FineTuningJobEvent>;
  listEvents(
    fineTuningJobId: string,
    query: JobListEventsParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<FineTuningJobEventsPage, FineTuningJobEvent> {
    if (isRequestOptions(query)) {
      return this.listEvents(fineTuningJobId, {}, query);
    }
    return this._client.getAPIList(`/fine_tuning/jobs/${fineTuningJobId}/events`, FineTuningJobEventsPage, {
      query,
      ...options,
    });
  }
}

export class FineTuningJobsPage extends CursorPage<FineTuningJob> {}

export class FineTuningJobEventsPage extends CursorPage<FineTuningJobEvent> {}

/**
 * The `fine_tuning.job` object represents a fine-tuning job that has been created
 * through the API.
 */
export interface FineTuningJob {
  /**
   * The object identifier, which can be referenced in the API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the fine-tuning job was created.
   */
  created_at: number;

  /**
   * For fine-tuning jobs that have `failed`, this will contain more information on
   * the cause of the failure.
   */
  error: FineTuningJob.Error | null;

  /**
   * The name of the fine-tuned model that is being created. The value will be null
   * if the fine-tuning job is still running.
   */
  fine_tuned_model: string | null;

  /**
   * The Unix timestamp (in seconds) for when the fine-tuning job was finished. The
   * value will be null if the fine-tuning job is still running.
   */
  finished_at: number | null;

  /**
   * The hyperparameters used for the fine-tuning job. This value will only be
   * returned when running `supervised` jobs.
   */
  hyperparameters: FineTuningJob.Hyperparameters;

  /**
   * The base model that is being fine-tuned.
   */
  model: string;

  /**
   * The object type, which is always "fine_tuning.job".
   */
  object: 'fine_tuning.job';

  /**
   * The organization that owns the fine-tuning job.
   */
  organization_id: string;

  /**
   * The compiled results file ID(s) for the fine-tuning job. You can retrieve the
   * results with the
   * [Files API](https://platform.openai.com/docs/api-reference/files/retrieve-contents).
   */
  result_files: Array<string>;

  /**
   * The seed used for the fine-tuning job.
   */
  seed: number;

  /**
   * The current status of the fine-tuning job, which can be either
   * `validating_files`, `queued`, `running`, `succeeded`, `failed`, or `cancelled`.
   */
  status: 'validating_files' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

  /**
   * The total number of billable tokens processed by this fine-tuning job. The value
   * will be null if the fine-tuning job is still running.
   */
  trained_tokens: number | null;

  /**
   * The file ID used for training. You can retrieve the training data with the
   * [Files API](https://platform.openai.com/docs/api-reference/files/retrieve-contents).
   */
  training_file: string;

  /**
   * The file ID used for validation. You can retrieve the validation results with
   * the
   * [Files API](https://platform.openai.com/docs/api-reference/files/retrieve-contents).
   */
  validation_file: string | null;

  /**
   * The Unix timestamp (in seconds) for when the fine-tuning job is estimated to
   * finish. The value will be null if the fine-tuning job is not running.
   */
  estimated_finish?: number | null;

  /**
   * A list of integrations to enable for this fine-tuning job.
   */
  integrations?: Array<FineTuningJobWandbIntegrationObject> | null;

  /**
   * The method used for fine-tuning.
   */
  method?: FineTuningJob.Method;
}

export namespace FineTuningJob {
  /**
   * For fine-tuning jobs that have `failed`, this will contain more information on
   * the cause of the failure.
   */
  export interface Error {
    /**
     * A machine-readable error code.
     */
    code: string;

    /**
     * A human-readable error message.
     */
    message: string;

    /**
     * The parameter that was invalid, usually `training_file` or `validation_file`.
     * This field will be null if the failure was not parameter-specific.
     */
    param: string | null;
  }

  /**
   * The hyperparameters used for the fine-tuning job. This value will only be
   * returned when running `supervised` jobs.
   */
  export interface Hyperparameters {
    /**
     * Number of examples in each batch. A larger batch size means that model
     * parameters are updated less frequently, but with lower variance.
     */
    batch_size?: 'auto' | number;

    /**
     * Scaling factor for the learning rate. A smaller learning rate may be useful to
     * avoid overfitting.
     */
    learning_rate_multiplier?: 'auto' | number;

    /**
     * The number of epochs to train the model for. An epoch refers to one full cycle
     * through the training dataset.
     */
    n_epochs?: 'auto' | number;
  }

  /**
   * The method used for fine-tuning.
   */
  export interface Method {
    /**
     * Configuration for the DPO fine-tuning method.
     */
    dpo?: Method.Dpo;

    /**
     * Configuration for the supervised fine-tuning method.
     */
    supervised?: Method.Supervised;

    /**
     * The type of method. Is either `supervised` or `dpo`.
     */
    type?: 'supervised' | 'dpo';
  }

  export namespace Method {
    /**
     * Configuration for the DPO fine-tuning method.
     */
    export interface Dpo {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      hyperparameters?: Dpo.Hyperparameters;
    }

    export namespace Dpo {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      export interface Hyperparameters {
        /**
         * Number of examples in each batch. A larger batch size means that model
         * parameters are updated less frequently, but with lower variance.
         */
        batch_size?: 'auto' | number;

        /**
         * The beta value for the DPO method. A higher beta value will increase the weight
         * of the penalty between the policy and reference model.
         */
        beta?: 'auto' | number;

        /**
         * Scaling factor for the learning rate. A smaller learning rate may be useful to
         * avoid overfitting.
         */
        learning_rate_multiplier?: 'auto' | number;

        /**
         * The number of epochs to train the model for. An epoch refers to one full cycle
         * through the training dataset.
         */
        n_epochs?: 'auto' | number;
      }
    }

    /**
     * Configuration for the supervised fine-tuning method.
     */
    export interface Supervised {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      hyperparameters?: Supervised.Hyperparameters;
    }

    export namespace Supervised {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      export interface Hyperparameters {
        /**
         * Number of examples in each batch. A larger batch size means that model
         * parameters are updated less frequently, but with lower variance.
         */
        batch_size?: 'auto' | number;

        /**
         * Scaling factor for the learning rate. A smaller learning rate may be useful to
         * avoid overfitting.
         */
        learning_rate_multiplier?: 'auto' | number;

        /**
         * The number of epochs to train the model for. An epoch refers to one full cycle
         * through the training dataset.
         */
        n_epochs?: 'auto' | number;
      }
    }
  }
}

/**
 * Fine-tuning job event object
 */
export interface FineTuningJobEvent {
  /**
   * The object identifier.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the fine-tuning job was created.
   */
  created_at: number;

  /**
   * The log level of the event.
   */
  level: 'info' | 'warn' | 'error';

  /**
   * The message of the event.
   */
  message: string;

  /**
   * The object type, which is always "fine_tuning.job.event".
   */
  object: 'fine_tuning.job.event';

  /**
   * The data associated with the event.
   */
  data?: unknown;

  /**
   * The type of event.
   */
  type?: 'message' | 'metrics';
}

export type FineTuningJobIntegration = FineTuningJobWandbIntegrationObject;

/**
 * The settings for your integration with Weights and Biases. This payload
 * specifies the project that metrics will be sent to. Optionally, you can set an
 * explicit display name for your run, add tags to your run, and set a default
 * entity (team, username, etc) to be associated with your run.
 */
export interface FineTuningJobWandbIntegration {
  /**
   * The name of the project that the new run will be created under.
   */
  project: string;

  /**
   * The entity to use for the run. This allows you to set the team or username of
   * the WandB user that you would like associated with the run. If not set, the
   * default entity for the registered WandB API key is used.
   */
  entity?: string | null;

  /**
   * A display name to set for the run. If not set, we will use the Job ID as the
   * name.
   */
  name?: string | null;

  /**
   * A list of tags to be attached to the newly created run. These tags are passed
   * through directly to WandB. Some default tags are generated by OpenAI:
   * "openai/finetune", "openai/{base-model}", "openai/{ftjob-abcdef}".
   */
  tags?: Array<string>;
}

export interface FineTuningJobWandbIntegrationObject {
  /**
   * The type of the integration being enabled for the fine-tuning job
   */
  type: 'wandb';

  /**
   * The settings for your integration with Weights and Biases. This payload
   * specifies the project that metrics will be sent to. Optionally, you can set an
   * explicit display name for your run, add tags to your run, and set a default
   * entity (team, username, etc) to be associated with your run.
   */
  wandb: FineTuningJobWandbIntegration;
}

export interface JobCreateParams {
  /**
   * The name of the model to fine-tune. You can select one of the
   * [supported models](https://platform.openai.com/docs/guides/fine-tuning#which-models-can-be-fine-tuned).
   */
  model: (string & {}) | 'babbage-002' | 'davinci-002' | 'gpt-3.5-turbo' | 'gpt-4o-mini';

  /**
   * The ID of an uploaded file that contains training data.
   *
   * See [upload file](https://platform.openai.com/docs/api-reference/files/create)
   * for how to upload a file.
   *
   * Your dataset must be formatted as a JSONL file. Additionally, you must upload
   * your file with the purpose `fine-tune`.
   *
   * The contents of the file should differ depending on if the model uses the
   * [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input),
   * [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
   * format, or if the fine-tuning method uses the
   * [preference](https://platform.openai.com/docs/api-reference/fine-tuning/preference-input)
   * format.
   *
   * See the [fine-tuning guide](https://platform.openai.com/docs/guides/fine-tuning)
   * for more details.
   */
  training_file: string;

  /**
   * The hyperparameters used for the fine-tuning job. This value is now deprecated
   * in favor of `method`, and should be passed in under the `method` parameter.
   */
  hyperparameters?: JobCreateParams.Hyperparameters;

  /**
   * A list of integrations to enable for your fine-tuning job.
   */
  integrations?: Array<JobCreateParams.Integration> | null;

  /**
   * The method used for fine-tuning.
   */
  method?: JobCreateParams.Method;

  /**
   * The seed controls the reproducibility of the job. Passing in the same seed and
   * job parameters should produce the same results, but may differ in rare cases. If
   * a seed is not specified, one will be generated for you.
   */
  seed?: number | null;

  /**
   * A string of up to 64 characters that will be added to your fine-tuned model
   * name.
   *
   * For example, a `suffix` of "custom-model-name" would produce a model name like
   * `ft:gpt-4o-mini:openai:custom-model-name:7p4lURel`.
   */
  suffix?: string | null;

  /**
   * The ID of an uploaded file that contains validation data.
   *
   * If you provide this file, the data is used to generate validation metrics
   * periodically during fine-tuning. These metrics can be viewed in the fine-tuning
   * results file. The same data should not be present in both train and validation
   * files.
   *
   * Your dataset must be formatted as a JSONL file. You must upload your file with
   * the purpose `fine-tune`.
   *
   * See the [fine-tuning guide](https://platform.openai.com/docs/guides/fine-tuning)
   * for more details.
   */
  validation_file?: string | null;
}

export namespace JobCreateParams {
  /**
   * @deprecated: The hyperparameters used for the fine-tuning job. This value is now
   * deprecated in favor of `method`, and should be passed in under the `method`
   * parameter.
   */
  export interface Hyperparameters {
    /**
     * Number of examples in each batch. A larger batch size means that model
     * parameters are updated less frequently, but with lower variance.
     */
    batch_size?: 'auto' | number;

    /**
     * Scaling factor for the learning rate. A smaller learning rate may be useful to
     * avoid overfitting.
     */
    learning_rate_multiplier?: 'auto' | number;

    /**
     * The number of epochs to train the model for. An epoch refers to one full cycle
     * through the training dataset.
     */
    n_epochs?: 'auto' | number;
  }

  export interface Integration {
    /**
     * The type of integration to enable. Currently, only "wandb" (Weights and Biases)
     * is supported.
     */
    type: 'wandb';

    /**
     * The settings for your integration with Weights and Biases. This payload
     * specifies the project that metrics will be sent to. Optionally, you can set an
     * explicit display name for your run, add tags to your run, and set a default
     * entity (team, username, etc) to be associated with your run.
     */
    wandb: Integration.Wandb;
  }

  export namespace Integration {
    /**
     * The settings for your integration with Weights and Biases. This payload
     * specifies the project that metrics will be sent to. Optionally, you can set an
     * explicit display name for your run, add tags to your run, and set a default
     * entity (team, username, etc) to be associated with your run.
     */
    export interface Wandb {
      /**
       * The name of the project that the new run will be created under.
       */
      project: string;

      /**
       * The entity to use for the run. This allows you to set the team or username of
       * the WandB user that you would like associated with the run. If not set, the
       * default entity for the registered WandB API key is used.
       */
      entity?: string | null;

      /**
       * A display name to set for the run. If not set, we will use the Job ID as the
       * name.
       */
      name?: string | null;

      /**
       * A list of tags to be attached to the newly created run. These tags are passed
       * through directly to WandB. Some default tags are generated by OpenAI:
       * "openai/finetune", "openai/{base-model}", "openai/{ftjob-abcdef}".
       */
      tags?: Array<string>;
    }
  }

  /**
   * The method used for fine-tuning.
   */
  export interface Method {
    /**
     * Configuration for the DPO fine-tuning method.
     */
    dpo?: Method.Dpo;

    /**
     * Configuration for the supervised fine-tuning method.
     */
    supervised?: Method.Supervised;

    /**
     * The type of method. Is either `supervised` or `dpo`.
     */
    type?: 'supervised' | 'dpo';
  }

  export namespace Method {
    /**
     * Configuration for the DPO fine-tuning method.
     */
    export interface Dpo {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      hyperparameters?: Dpo.Hyperparameters;
    }

    export namespace Dpo {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      export interface Hyperparameters {
        /**
         * Number of examples in each batch. A larger batch size means that model
         * parameters are updated less frequently, but with lower variance.
         */
        batch_size?: 'auto' | number;

        /**
         * The beta value for the DPO method. A higher beta value will increase the weight
         * of the penalty between the policy and reference model.
         */
        beta?: 'auto' | number;

        /**
         * Scaling factor for the learning rate. A smaller learning rate may be useful to
         * avoid overfitting.
         */
        learning_rate_multiplier?: 'auto' | number;

        /**
         * The number of epochs to train the model for. An epoch refers to one full cycle
         * through the training dataset.
         */
        n_epochs?: 'auto' | number;
      }
    }

    /**
     * Configuration for the supervised fine-tuning method.
     */
    export interface Supervised {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      hyperparameters?: Supervised.Hyperparameters;
    }

    export namespace Supervised {
      /**
       * The hyperparameters used for the fine-tuning job.
       */
      export interface Hyperparameters {
        /**
         * Number of examples in each batch. A larger batch size means that model
         * parameters are updated less frequently, but with lower variance.
         */
        batch_size?: 'auto' | number;

        /**
         * Scaling factor for the learning rate. A smaller learning rate may be useful to
         * avoid overfitting.
         */
        learning_rate_multiplier?: 'auto' | number;

        /**
         * The number of epochs to train the model for. An epoch refers to one full cycle
         * through the training dataset.
         */
        n_epochs?: 'auto' | number;
      }
    }
  }
}

export interface JobListParams extends CursorPageParams {}

export interface JobListEventsParams extends CursorPageParams {}

Jobs.FineTuningJobsPage = FineTuningJobsPage;
Jobs.FineTuningJobEventsPage = FineTuningJobEventsPage;
Jobs.Checkpoints = Checkpoints;
Jobs.FineTuningJobCheckpointsPage = FineTuningJobCheckpointsPage;

export declare namespace Jobs {
  export {
    type FineTuningJob as FineTuningJob,
    type FineTuningJobEvent as FineTuningJobEvent,
    type FineTuningJobIntegration as FineTuningJobIntegration,
    type FineTuningJobWandbIntegration as FineTuningJobWandbIntegration,
    type FineTuningJobWandbIntegrationObject as FineTuningJobWandbIntegrationObject,
    FineTuningJobsPage as FineTuningJobsPage,
    FineTuningJobEventsPage as FineTuningJobEventsPage,
    type JobCreateParams as JobCreateParams,
    type JobListParams as JobListParams,
    type JobListEventsParams as JobListEventsParams,
  };

  export {
    Checkpoints as Checkpoints,
    type FineTuningJobCheckpoint as FineTuningJobCheckpoint,
    FineTuningJobCheckpointsPage as FineTuningJobCheckpointsPage,
    type CheckpointListParams as CheckpointListParams,
  };
}
