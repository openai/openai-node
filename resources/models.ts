// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import * as API from './';

export class Models extends APIResource {
  /**
   * Retrieves a model instance, providing basic information about the model such as
   * the owner and permissioning.
   */
  retrieve(model: string, options?: Core.RequestOptions): Promise<Core.APIResponse<Model>> {
    return this.get(`/models/${model}`, options);
  }

  /**
   * Lists the currently available models, and provides basic information about each
   * one such as the owner and availability.
   */
  list(options?: Core.RequestOptions): Promise<Core.APIResponse<ListModelsResponse>> {
    return this.get('/models', options);
  }

  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization.
   */
  del(model: string, options?: Core.RequestOptions): Promise<Core.APIResponse<ModelDeletedResponse>> {
    return this.delete(`/models/${model}`, options);
  }
}

export interface ListModelsResponse {
  data: Array<Model>;

  object: string;
}

export interface Model {
  created: number;

  id: string;

  object: string;

  owned_by: string;
}

export interface ModelDeletedResponse {
  deleted: boolean;

  id: string;

  object: string;
}

export namespace Models {
  export import ListModelsResponse = API.ListModelsResponse;
  export import Model = API.Model;
  export import ModelDeletedResponse = API.ModelDeletedResponse;
}
