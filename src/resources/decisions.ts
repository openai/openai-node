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
   * Use this endpoint to quickly answer classification or scoring questions about
   * some input. You can ask multiple questions in one request.
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
  /**
   * Answers in question order. Any question can return a refusal instead of an
   * answer; other questions can still receive answers. A refusal has
   * `type: "refusal"` and the question's `name`, or `null` if it was unnamed.
   */
  answers: Array<
    | Decision.AnswerResourcePredicate
    | Decision.AnswerResourceChoice
    | Decision.AnswerResourceScore
    | Decision.AnswerResourceRefusal
  >;

  /**
   * The model used.
   */
  model: string;

  /**
   * Token usage for the request.
   */
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
   * The model declined to answer this question. Other questions in the same request
   * can still receive answers.
   */
  export interface AnswerResourceRefusal {
    name: string | null;

    /**
     * The type of the object. Always `refusal`.
     */
    type: 'refusal';
  }

  /**
   * Token usage for the request.
   */
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
 * An image provided as a base64 data URL or a publicly accessible HTTP(S) URL.
 * File IDs are not supported.
 */
export interface DecisionInputImage {
  /**
   * A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.
   */
  image_url: string;

  type: 'input_image';

  /**
   * The image detail level, using the selected model's image profile. Defaults to
   * auto.
   */
  detail?: 'low' | 'high' | 'auto' | 'original' | null;

  /**
   * Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL
   * from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a
   * token block.
   */
  prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null;
}

/**
 * A user message containing text or images.
 */
export interface DecisionInputMessage {
  /**
   * Text evidence or an ordered list of text and image parts.
   */
  content: string | Array<DecisionInputPart>;

  role: 'user';

  type?: 'message';
}

/**
 * An image provided as a base64 data URL or a publicly accessible HTTP(S) URL.
 * File IDs are not supported.
 */
export type DecisionInputPart = DecisionInputText | DecisionInputImage;

export interface DecisionInputText {
  text: string;

  type: 'input_text';

  /**
   * Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL
   * from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a
   * token block.
   */
  prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null;
}

/**
 * Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL
 * from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a
 * token block.
 */
export interface DecisionPromptCacheBreakpoint {
  /**
   * The breakpoint mode. Always `explicit`.
   */
  mode: 'explicit';
}

export interface DecisionCreateParams {
  /**
   * The text or images to evaluate for every question. Provide a text string or user
   * messages containing text and images. Images can be base64 data URLs or publicly
   * accessible HTTP(S) URLs; at most 128 images are allowed across all messages in
   * one request. Files, audio, tools, and item references are not supported.
   */
  input: string | Array<DecisionInputMessage>;

  /**
   * The model to use. Only `gpt-6-luna` is supported.
   */
  model: string;

  /**
   * Ask 1–200 questions about the input. Each question can be a predicate, choice,
   * or score. Answers come back in the same order.
   */
  questions: Array<
    | DecisionCreateParams.QuestionParamPredicate
    | DecisionCreateParams.QuestionParamChoice
    | DecisionCreateParams.QuestionParamScore
  >;

  /**
   * Partition prompt cache reuse by caller-provided key.
   */
  prompt_cache_key?: string | null;

  /**
   * Options for prompt caching. Supported for `gpt-5.6` and later models. By
   * default, OpenAI automatically chooses one implicit cache breakpoint. You can add
   * explicit breakpoints to content blocks with `prompt_cache_breakpoint`. Each
   * request can write up to four breakpoints. For cache matching, OpenAI considers
   * up to the latest 80 breakpoints in the conversation, without a content-block
   * lookback limit. Set `mode` to `explicit` to disable the implicit breakpoint. The
   * `ttl` defaults to `30m`, which is currently the only supported value. See the
   * [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
   * for current details.
   */
  prompt_cache_options?: DecisionCreateParams.PromptCacheOptions | null;

  /**
   * Opaque caller-provided end-user identifier, scoped by the verified org. Match
   * Responses' limit; this is never the authenticated user identity.
   */
  safety_identifier?: string | null;
}

export namespace DecisionCreateParams {
  /**
   * Estimate how likely it is that a statement about the input is true.
   */
  export interface QuestionParamPredicate {
    instructions: string;

    /**
     * The type of the object. Always `predicate`.
     */
    type: 'predicate';

    name?: string;
  }

  /**
   * Choose from the supplied options based on the input.
   */
  export interface QuestionParamChoice {
    /**
     * Provide between 2 and 255 choices. Each choice must be unique.
     */
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

  /**
   * Rate the input against the supplied ordered levels.
   */
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

  /**
   * Options for prompt caching. Supported for `gpt-5.6` and later models. By
   * default, OpenAI automatically chooses one implicit cache breakpoint. You can add
   * explicit breakpoints to content blocks with `prompt_cache_breakpoint`. Each
   * request can write up to four breakpoints. For cache matching, OpenAI considers
   * up to the latest 80 breakpoints in the conversation, without a content-block
   * lookback limit. Set `mode` to `explicit` to disable the implicit breakpoint. The
   * `ttl` defaults to `30m`, which is currently the only supported value. See the
   * [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
   * for current details.
   */
  export interface PromptCacheOptions {
    /**
     * Controls whether OpenAI automatically creates an implicit cache breakpoint.
     * Defaults to `implicit`. With `implicit`, OpenAI creates one implicit breakpoint
     * and writes up to the latest three explicit breakpoints in the request. With
     * `explicit`, OpenAI does not create an implicit breakpoint and writes up to the
     * latest four explicit breakpoints. If there are no explicit breakpoints, the
     * request does not use prompt caching.
     */
    mode?: 'implicit' | 'explicit' | null;

    /**
     * The minimum lifetime applied to every implicit and explicit cache breakpoint
     * written by the request. Defaults to `30m`, which is currently the only supported
     * value. The backend may retain cache entries for longer.
     */
    ttl?: '30m';
  }
}

export declare namespace Decisions {
  export {
    type Decision as Decision,
    type DecisionInputImage as DecisionInputImage,
    type DecisionInputMessage as DecisionInputMessage,
    type DecisionInputPart as DecisionInputPart,
    type DecisionInputText as DecisionInputText,
    type DecisionPromptCacheBreakpoint as DecisionPromptCacheBreakpoint,
    type DecisionCreateParams as DecisionCreateParams,
  };
}
