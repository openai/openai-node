// File generated from our OpenAPI spec by Stainless.

import * as Core from "../core.ts";
import { APIResource } from "../resource.ts";
import * as API from "./mod.ts";
import { Page } from "../pagination.ts";

export class Models extends APIResource {
  /**
   * Retrieves a model instance, providing basic information about the model such as
   * the owner and permissioning.
   */
  retrieve(
    model: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Model> {
    return this.get(`/models/${model}`, options);
  }

  /**
   * Lists the currently available models, and provides basic information about each
   * one such as the owner and availability.
   */
  list(options?: Core.RequestOptions): Core.PagePromise<ModelsPage, Model> {
    return this.getAPIList("/models", ModelsPage, options);
  }

  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization.
   */
  del(
    model: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<ModelDeleted> {
    return this.delete(`/models/${model}`, options);
  }
}

/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export class ModelsPage extends Page<Model> {}
// alias so we can export it in the namespace
type _ModelsPage = ModelsPage;

/**
 * Describes an OpenAI model offering that can be used with the API.
 */
export interface Model {
  /**
   * The model identifier, which can be referenced in the API endpoints.
   */
  id: string;

  /**
   * The date and time when the model was created.
   */
  created: number;

  /**
   * The object type, which is always "model".
   */
  object: string;

  /**
   * The organization that owns the model.
   */
  owned_by: string;
}

export interface ModelDeleted {
  id: string;

  deleted: boolean;

  object: string;
}

export namespace Models {
  export type Model = API.Model;
  export type ModelDeleted = API.ModelDeleted;
  export type ModelsPage = _ModelsPage;
}
