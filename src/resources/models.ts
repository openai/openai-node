// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import * as API from './';
import { Page } from 'openai/pagination';

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
  list(options?: Core.RequestOptions): Core.PagePromise<ModelsPage> {
    return this.getAPIList('/models', ModelsPage, options);
  }

  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization.
   */
  del(model: string, options?: Core.RequestOptions): Promise<Core.APIResponse<ModelDeleted>> {
    return this.delete(`/models/${model}`, options);
  }
}

/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export class ModelsPage extends Page<Model> {}

export interface Model {
  id: string;

  created: number;

  object: string;

  owned_by: string;
}

export interface ModelDeleted {
  id: string;

  deleted: boolean;

  object: string;
}

export namespace Models {
  export import Model = API.Model;
  export import ModelDeleted = API.ModelDeleted;
  export import ModelsPage = API.ModelsPage;
}
