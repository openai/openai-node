// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import * as API from './';

export class Embeddings extends APIResource {
  /**
   * Creates an embedding vector representing the input text.
   */
  create(body: EmbeddingCreateParams, options?: Core.RequestOptions): Promise<Core.APIResponse<Embedding>> {
    return this.post('/embeddings', { body, ...options });
  }
}

export interface Embedding {
  data: Array<Embedding.Data>;

  model: string;

  object: string;

  usage: Embedding.Usage;
}

export namespace Embedding {
  export interface Data {
    embedding: Array<number>;

    index: number;

    object: string;
  }

  export interface Usage {
    prompt_tokens: number;

    total_tokens: number;
  }
}

export interface EmbeddingCreateParams {
  /**
   * Input text to embed, encoded as a string or array of tokens. To embed multiple
   * inputs in a single request, pass an array of strings or array of token arrays.
   * Each input must not exceed the max input tokens for the model (8191 tokens for
   * `text-embedding-ada-002`).
   * [Example Python code](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb)
   * for counting tokens.
   */
  input: string | Array<string> | Array<number> | Array<Array<number>>;

  /**
   * ID of the model to use. You can use the
   * [List models](/docs/api-reference/models/list) API to see all of your available
   * models, or see our [Model overview](/docs/models/overview) for descriptions of
   * them.
   */
  model: (string & {}) | 'text-embedding-ada-002';

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse. [Learn more](/docs/guides/safety-best-practices/end-user-ids).
   */
  user?: string;
}

export namespace Embeddings {
  export import Embedding = API.Embedding;
  export import EmbeddingCreateParams = API.EmbeddingCreateParams;
}
