// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import * as API from './';

export class Edits extends APIResource {
  /**
   * Creates a new edit for the provided input, instruction, and parameters.
   */
  create(body: EditCreateParams, options?: Core.RequestOptions): Promise<Core.APIResponse<Edit>> {
    return this.post('/edits', { body, ...options });
  }
}

export interface Edit {
  choices: Array<Edit.Choice>;

  created: number;

  object: string;

  usage: Edit.Usage;
}

export namespace Edit {
  export interface Choice {
    finish_reason?: 'stop' | 'length';

    index?: number;

    logprobs?: Choice.Logprobs | null;

    text?: string;
  }

  export namespace Choice {
    export interface Logprobs {
      text_offset?: Array<number>;

      token_logprobs?: Array<number>;

      tokens?: Array<string>;

      top_logprobs?: Array<unknown>;
    }
  }

  export interface Usage {
    completion_tokens: number;

    prompt_tokens: number;

    total_tokens: number;
  }
}

export interface EditCreateParams {
  /**
   * The instruction that tells the model how to edit the prompt.
   */
  instruction: string;

  /**
   * ID of the model to use. You can use the `text-davinci-edit-001` or
   * `code-davinci-edit-001` model with this endpoint.
   */
  model: (string & {}) | 'text-davinci-edit-001' | 'code-davinci-edit-001';

  /**
   * The input text to use as a starting point for the edit.
   */
  input?: string | null;

  /**
   * How many edits to generate for the input and instruction.
   */
  n?: number | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   *
   * We generally recommend altering this or `top_p` but not both.
   */
  temperature?: number | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p?: number | null;
}

export namespace Edits {
  export import Edit = API.Edit;
  export import EditCreateParams = API.EditCreateParams;
}
