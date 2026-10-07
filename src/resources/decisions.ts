// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class Decisions extends APIResource {
  /**
   * Evaluate ordered classification and scoring questions against shared input.
   * Answers are returned in question order.
   *
   * Supply input as a string or user messages containing text and inline images.
   * Only user messages with `input_text` and `input_image` parts are supported;
   * non-user roles, function calls, files, audio, and item references are not
   * supported. Images require a data URL, not an external URL or file ID. At most
   * 128 images are allowed across the request.
   *
   * Each question can return a refusal instead of a scored answer. A refusal has
   * type `refusal` and the corresponding question name, or null if unnamed.
   */
  create(body: DecisionCreateParams, options?: RequestOptions): APIPromise<Decision> {
    return this._client.post(
      '/decisions',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }
}

export interface Decision {
  answers: Array<
    | Decision.AnswerResourcePredicate
    | Decision.AnswerResourceChoice
    | Decision.AnswerResourceScore
    | Decision.AnswerResourceRefusal
  >;

  model: string;

  usage: Decision.Usage;
}

export namespace Decision {
  export interface AnswerResourcePredicate {
    name: string | null;

    probability: number;

    /**
     * The type of the object. Always `predicate`.
     */
    type: 'predicate';
  }

  export interface AnswerResourceChoice {
    /**
     * Choice values are typed: a string and a boolean with the same text are distinct.
     */
    choice: string | boolean;

    confidence: number;

    name: string | null;

    probabilities: Array<AnswerResourceChoice.Probability>;

    /**
     * The type of the object. Always `choice`.
     */
    type: 'choice';
  }

  export namespace AnswerResourceChoice {
    export interface Probability {
      probability: number;

      /**
       * Choice values are typed: a string and a boolean with the same text are distinct.
       */
      value: string | boolean;
    }
  }

  export interface AnswerResourceScore {
    confidence: number;

    name: string | null;

    probabilities: Array<AnswerResourceScore.Probability>;

    score: number;

    /**
     * The type of the object. Always `score`.
     */
    type: 'score';
  }

  export namespace AnswerResourceScore {
    export interface Probability {
      label: string;

      probability: number;

      value: number;
    }
  }

  /**
   * The host may decline one question without disclosing its refusal score.
   */
  export interface AnswerResourceRefusal {
    name: string | null;

    /**
     * The type of the object. Always `refusal`.
     */
    type: 'refusal';
  }

  export interface Usage {
    input_tokens: number;

    input_tokens_details: Usage.InputTokensDetails;

    output_tokens: number;

    output_tokens_details: Usage.OutputTokensDetails;

    total_tokens: number;
  }

  export namespace Usage {
    export interface InputTokensDetails {
      cache_write_tokens: number;

      cached_tokens: number;
    }

    export interface OutputTokensDetails {
      reasoning_tokens: number;
    }
  }
}

/**
 * An inline image. External URLs and file IDs are not supported.
 */
export interface DecisionInputImage {
  /**
   * A base64-encoded image in a data URL.
   */
  image_url: string;

  type: 'input_image';

  /**
   * The image detail level, using the selected model's image profile. Defaults to
   * auto.
   */
  detail?: 'low' | 'high' | 'auto' | 'original' | null;
}

/**
 * A user message containing text or inline images.
 */
export interface DecisionInputMessage {
  /**
   * Text evidence or an ordered list of text and inline image parts.
   */
  content: string | Array<DecisionInputPart>;

  role: 'user';

  type?: 'message';
}

/**
 * An inline image. External URLs and file IDs are not supported.
 */
export type DecisionInputPart = DecisionInputText | DecisionInputImage;

export interface DecisionInputText {
  text: string;

  type: 'input_text';
}

export interface DecisionCreateParams {
  /**
   * Shared evidence, as a string or an array of user messages containing text and
   * inline images. Non-user roles, function calls, function-call outputs, files,
   * audio, and item references are not supported. At most 128 image parts are
   * allowed across all messages in one request.
   */
  input: string | Array<DecisionInputMessage>;

  model: string;

  questions: Array<
    | DecisionCreateParams.QuestionParamPredicate
    | DecisionCreateParams.QuestionParamChoice
    | DecisionCreateParams.QuestionParamScore
  >;

  /**
   * Opaque caller-provided end-user identifier, scoped by the verified org. Match
   * Responses' limit; this is never the authenticated user identity.
   */
  safety_identifier?: string | null;
}

export namespace DecisionCreateParams {
  export interface QuestionParamPredicate {
    instructions: string;

    /**
     * The type of the object. Always `predicate`.
     */
    type: 'predicate';

    name?: string;
  }

  export interface QuestionParamChoice {
    choices: Array<QuestionParamChoice.Choice>;

    instructions: string;

    /**
     * The type of the object. Always `choice`.
     */
    type: 'choice';

    name?: string;
  }

  export namespace QuestionParamChoice {
    export interface Choice {
      /**
       * Choice values are typed: a string and a boolean with the same text are distinct.
       */
      value: string | boolean;

      description?: string;
    }
  }

  export interface QuestionParamScore {
    instructions: string;

    levels: Array<QuestionParamScore.Level>;

    /**
     * The type of the object. Always `score`.
     */
    type: 'score';

    name?: string;
  }

  export namespace QuestionParamScore {
    export interface Level {
      label: string;

      description?: string;
    }
  }
}

export declare namespace Decisions {
  export {
    type Decision as Decision,
    type DecisionInputImage as DecisionInputImage,
    type DecisionInputMessage as DecisionInputMessage,
    type DecisionInputPart as DecisionInputPart,
    type DecisionInputText as DecisionInputText,
    type DecisionCreateParams as DecisionCreateParams,
  };
}
