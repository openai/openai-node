// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as RealtimeAPI from './realtime';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';

export class ClientSecrets extends APIResource {
  /**
   * Create a Realtime session and client secret for either realtime or
   * transcription.
   */
  create(body: ClientSecretCreateParams, options?: RequestOptions): APIPromise<ClientSecretCreateResponse> {
    return this._client.post('/realtime/client_secrets', { body, ...options });
  }
}

/**
 * A Realtime session configuration object.
 */
export interface RealtimeSessionCreateResponse {
  /**
   * Unique identifier for the session that looks like `sess_1234567890abcdef`.
   */
  id?: string;

  /**
   * Configuration for input and output audio for the session.
   */
  audio?: RealtimeSessionCreateResponse.Audio;

  /**
   * Expiration timestamp for the session, in seconds since epoch.
   */
  expires_at?: number;

  /**
   * Additional fields to include in server outputs.
   *
   * - `item.input_audio_transcription.logprobs`: Include logprobs for input audio
   *   transcription.
   */
  include?: Array<'item.input_audio_transcription.logprobs'>;

  /**
   * The default system instructions (i.e. system message) prepended to model calls.
   * This field allows the client to guide the model on desired responses. The model
   * can be instructed on response content and format, (e.g. "be extremely succinct",
   * "act friendly", "here are examples of good responses") and on audio behavior
   * (e.g. "talk quickly", "inject emotion into your voice", "laugh frequently"). The
   * instructions are not guaranteed to be followed by the model, but they provide
   * guidance to the model on the desired behavior.
   *
   * Note that the server sets default instructions which will be used if this field
   * is not set and are visible in the `session.created` event at the start of the
   * session.
   */
  instructions?: string;

  /**
   * Maximum number of output tokens for a single assistant response, inclusive of
   * tool calls. Provide an integer between 1 and 4096 to limit output tokens, or
   * `inf` for the maximum available tokens for a given model. Defaults to `inf`.
   */
  max_output_tokens?: number | 'inf';

  /**
   * The Realtime model used for this session.
   */
  model?: string;

  /**
   * The object type. Always `realtime.session`.
   */
  object?: string;

  /**
   * The set of modalities the model can respond with. To disable audio, set this to
   * ["text"].
   */
  output_modalities?: Array<'text' | 'audio'>;

  /**
   * How the model chooses tools. Options are `auto`, `none`, `required`, or specify
   * a function.
   */
  tool_choice?: string;

  /**
   * Tools (functions) available to the model.
   */
  tools?: Array<RealtimeSessionCreateResponse.Tool>;

  /**
   * Configuration options for tracing. Set to null to disable tracing. Once tracing
   * is enabled for a session, the configuration cannot be modified.
   *
   * `auto` will create a trace for the session with default values for the workflow
   * name, group id, and metadata.
   */
  tracing?: 'auto' | RealtimeSessionCreateResponse.TracingConfiguration;

  /**
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  turn_detection?: RealtimeSessionCreateResponse.TurnDetection;
}

export namespace RealtimeSessionCreateResponse {
  /**
   * Configuration for input and output audio for the session.
   */
  export interface Audio {
    input?: Audio.Input;

    output?: Audio.Output;
  }

  export namespace Audio {
    export interface Input {
      /**
       * The format of input audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
       */
      format?: string;

      /**
       * Configuration for input audio noise reduction.
       */
      noise_reduction?: Input.NoiseReduction;

      /**
       * Configuration for input audio transcription.
       */
      transcription?: Input.Transcription;

      /**
       * Configuration for turn detection.
       */
      turn_detection?: Input.TurnDetection;
    }

    export namespace Input {
      /**
       * Configuration for input audio noise reduction.
       */
      export interface NoiseReduction {
        type?: 'near_field' | 'far_field';
      }

      /**
       * Configuration for input audio transcription.
       */
      export interface Transcription {
        /**
         * The language of the input audio.
         */
        language?: string;

        /**
         * The model to use for transcription.
         */
        model?: string;

        /**
         * Optional text to guide the model's style or continue a previous audio segment.
         */
        prompt?: string;
      }

      /**
       * Configuration for turn detection.
       */
      export interface TurnDetection {
        prefix_padding_ms?: number;

        silence_duration_ms?: number;

        threshold?: number;

        /**
         * Type of turn detection, only `server_vad` is currently supported.
         */
        type?: string;
      }
    }

    export interface Output {
      /**
       * The format of output audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
       */
      format?: string;

      speed?: number;

      voice?:
        | (string & {})
        | 'alloy'
        | 'ash'
        | 'ballad'
        | 'coral'
        | 'echo'
        | 'sage'
        | 'shimmer'
        | 'verse'
        | 'marin'
        | 'cedar';
    }
  }

  export interface Tool {
    /**
     * The description of the function, including guidance on when and how to call it,
     * and guidance about what to tell the user when calling (if anything).
     */
    description?: string;

    /**
     * The name of the function.
     */
    name?: string;

    /**
     * Parameters of the function in JSON Schema.
     */
    parameters?: unknown;

    /**
     * The type of the tool, i.e. `function`.
     */
    type?: 'function';
  }

  /**
   * Granular configuration for tracing.
   */
  export interface TracingConfiguration {
    /**
     * The group id to attach to this trace to enable filtering and grouping in the
     * traces dashboard.
     */
    group_id?: string;

    /**
     * The arbitrary metadata to attach to this trace to enable filtering in the traces
     * dashboard.
     */
    metadata?: unknown;

    /**
     * The name of the workflow to attach to this trace. This is used to name the trace
     * in the traces dashboard.
     */
    workflow_name?: string;
  }

  /**
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  export interface TurnDetection {
    /**
     * Amount of audio to include before the VAD detected speech (in milliseconds).
     * Defaults to 300ms.
     */
    prefix_padding_ms?: number;

    /**
     * Duration of silence to detect speech stop (in milliseconds). Defaults to 500ms.
     * With shorter values the model will respond more quickly, but may jump in on
     * short pauses from the user.
     */
    silence_duration_ms?: number;

    /**
     * Activation threshold for VAD (0.0 to 1.0), this defaults to 0.5. A higher
     * threshold will require louder audio to activate the model, and thus might
     * perform better in noisy environments.
     */
    threshold?: number;

    /**
     * Type of turn detection, only `server_vad` is currently supported.
     */
    type?: string;
  }
}

/**
 * Response from creating a session and client secret for the Realtime API.
 */
export interface ClientSecretCreateResponse {
  /**
   * Expiration timestamp for the client secret, in seconds since epoch.
   */
  expires_at: number;

  /**
   * The session configuration for either a realtime or transcription session.
   */
  session:
    | RealtimeSessionCreateResponse
    | ClientSecretCreateResponse.RealtimeTranscriptionSessionCreateResponse;

  /**
   * The generated client secret value.
   */
  value: string;
}

export namespace ClientSecretCreateResponse {
  /**
   * A Realtime transcription session configuration object.
   */
  export interface RealtimeTranscriptionSessionCreateResponse {
    /**
     * Unique identifier for the session that looks like `sess_1234567890abcdef`.
     */
    id?: string;

    /**
     * Configuration for input audio for the session.
     */
    audio?: RealtimeTranscriptionSessionCreateResponse.Audio;

    /**
     * Expiration timestamp for the session, in seconds since epoch.
     */
    expires_at?: number;

    /**
     * Additional fields to include in server outputs.
     *
     * - `item.input_audio_transcription.logprobs`: Include logprobs for input audio
     *   transcription.
     */
    include?: Array<'item.input_audio_transcription.logprobs'>;

    /**
     * The object type. Always `realtime.transcription_session`.
     */
    object?: string;
  }

  export namespace RealtimeTranscriptionSessionCreateResponse {
    /**
     * Configuration for input audio for the session.
     */
    export interface Audio {
      input?: Audio.Input;
    }

    export namespace Audio {
      export interface Input {
        /**
         * The format of input audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
         */
        format?: string;

        /**
         * Configuration for input audio noise reduction.
         */
        noise_reduction?: Input.NoiseReduction;

        /**
         * Configuration of the transcription model.
         */
        transcription?: Input.Transcription;

        /**
         * Configuration for turn detection.
         */
        turn_detection?: Input.TurnDetection;
      }

      export namespace Input {
        /**
         * Configuration for input audio noise reduction.
         */
        export interface NoiseReduction {
          type?: 'near_field' | 'far_field';
        }

        /**
         * Configuration of the transcription model.
         */
        export interface Transcription {
          /**
           * The language of the input audio. Supplying the input language in
           * [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) (e.g. `en`)
           * format will improve accuracy and latency.
           */
          language?: string;

          /**
           * The model to use for transcription. Can be `gpt-4o-transcribe`,
           * `gpt-4o-mini-transcribe`, or `whisper-1`.
           */
          model?: 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe' | 'whisper-1';

          /**
           * An optional text to guide the model's style or continue a previous audio
           * segment. The
           * [prompt](https://platform.openai.com/docs/guides/speech-to-text#prompting)
           * should match the audio language.
           */
          prompt?: string;
        }

        /**
         * Configuration for turn detection.
         */
        export interface TurnDetection {
          prefix_padding_ms?: number;

          silence_duration_ms?: number;

          threshold?: number;

          /**
           * Type of turn detection, only `server_vad` is currently supported.
           */
          type?: string;
        }
      }
    }
  }
}

export interface ClientSecretCreateParams {
  /**
   * Configuration for the ephemeral token expiration.
   */
  expires_after?: ClientSecretCreateParams.ExpiresAfter;

  /**
   * Session configuration to use for the client secret. Choose either a realtime
   * session or a transcription session.
   */
  session?: RealtimeAPI.RealtimeSessionCreateRequest | RealtimeAPI.RealtimeTranscriptionSessionCreateRequest;
}

export namespace ClientSecretCreateParams {
  /**
   * Configuration for the ephemeral token expiration.
   */
  export interface ExpiresAfter {
    /**
     * The anchor point for the ephemeral token expiration. Only `created_at` is
     * currently supported.
     */
    anchor?: 'created_at';

    /**
     * The number of seconds from the anchor point to the expiration. Select a value
     * between `10` and `7200`.
     */
    seconds?: number;
  }
}

export declare namespace ClientSecrets {
  export {
    type RealtimeSessionCreateResponse as RealtimeSessionCreateResponse,
    type ClientSecretCreateResponse as ClientSecretCreateResponse,
    type ClientSecretCreateParams as ClientSecretCreateParams,
  };
}
