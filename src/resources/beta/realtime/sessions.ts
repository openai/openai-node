// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import * as Core from '../../../core';

export class Sessions extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API. Can be configured with the same session parameters as the
   * `session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   */
  create(body: SessionCreateParams, options?: Core.RequestOptions): Core.APIPromise<SessionCreateResponse> {
    return this._client.post('/realtime/sessions', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }
}

/**
 * Realtime session object configuration.
 */
export interface Session {
  /**
   * Unique identifier for the session object.
   */
  id?: string;

  /**
   * The format of input audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`. For
   * `pcm16`, input audio must be 16-bit PCM at a 24kHz sample rate, single channel
   * (mono), and little-endian byte order.
   */
  input_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';

  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through Whisper and should be treated as rough guidance rather
   * than the representation understood by the model.
   */
  input_audio_transcription?: Session.InputAudioTranscription;

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
  max_response_output_tokens?: number | 'inf';

  /**
   * The set of modalities the model can respond with. To disable audio, set this to
   * ["text"].
   */
  modalities?: Array<'text' | 'audio'>;

  /**
   * The Realtime model used for this session.
   */
  model?:
    | (string & {})
    | 'gpt-4o-realtime-preview'
    | 'gpt-4o-realtime-preview-2024-10-01'
    | 'gpt-4o-realtime-preview-2024-12-17'
    | 'gpt-4o-mini-realtime-preview'
    | 'gpt-4o-mini-realtime-preview-2024-12-17';

  /**
   * The format of output audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
   * For `pcm16`, output audio is sampled at a rate of 24kHz.
   */
  output_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';

  /**
   * Sampling temperature for the model, limited to [0.6, 1.2]. Defaults to 0.8.
   */
  temperature?: number;

  /**
   * How the model chooses tools. Options are `auto`, `none`, `required`, or specify
   * a function.
   */
  tool_choice?: string;

  /**
   * Tools (functions) available to the model.
   */
  tools?: Array<Session.Tool>;

  /**
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  turn_detection?: Session.TurnDetection | null;

  /**
   * The voice the model uses to respond. Voice cannot be changed during the session
   * once the model has responded with audio at least once. Current voice options are
   * `alloy`, `ash`, `ballad`, `coral`, `echo` `sage`, `shimmer` and `verse`.
   */
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
}

export namespace Session {
  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through Whisper and should be treated as rough guidance rather
   * than the representation understood by the model.
   */
  export interface InputAudioTranscription {
    /**
     * The model to use for transcription, `whisper-1` is the only currently supported
     * model.
     */
    model?: string;
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
    type?: 'server_vad';
  }
}

/**
 * A new Realtime session configuration, with an ephermeral key. Default TTL for
 * keys is one minute.
 */
export interface SessionCreateResponse {
  /**
   * Ephemeral key returned by the API.
   */
  client_secret: SessionCreateResponse.ClientSecret;

  /**
   * The format of input audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
   */
  input_audio_format?: string;

  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through Whisper and should be treated as rough guidance rather
   * than the representation understood by the model.
   */
  input_audio_transcription?: SessionCreateResponse.InputAudioTranscription;

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
  max_response_output_tokens?: number | 'inf';

  /**
   * The set of modalities the model can respond with. To disable audio, set this to
   * ["text"].
   */
  modalities?: Array<'text' | 'audio'>;

  /**
   * The format of output audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
   */
  output_audio_format?: string;

  /**
   * Sampling temperature for the model, limited to [0.6, 1.2]. Defaults to 0.8.
   */
  temperature?: number;

  /**
   * How the model chooses tools. Options are `auto`, `none`, `required`, or specify
   * a function.
   */
  tool_choice?: string;

  /**
   * Tools (functions) available to the model.
   */
  tools?: Array<SessionCreateResponse.Tool>;

  /**
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  turn_detection?: SessionCreateResponse.TurnDetection;

  /**
   * The voice the model uses to respond. Voice cannot be changed during the session
   * once the model has responded with audio at least once. Current voice options are
   * `alloy`, `ash`, `ballad`, `coral`, `echo` `sage`, `shimmer` and `verse`.
   */
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
}

export namespace SessionCreateResponse {
  /**
   * Ephemeral key returned by the API.
   */
  export interface ClientSecret {
    /**
     * Timestamp for when the token expires. Currently, all tokens expire after one
     * minute.
     */
    expires_at: number;

    /**
     * Ephemeral key usable in client environments to authenticate connections to the
     * Realtime API. Use this in client-side environments rather than a standard API
     * token, which should only be used server-side.
     */
    value: string;
  }

  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through Whisper and should be treated as rough guidance rather
   * than the representation understood by the model.
   */
  export interface InputAudioTranscription {
    /**
     * The model to use for transcription, `whisper-1` is the only currently supported
     * model.
     */
    model?: string;
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

export interface SessionCreateParams {
  /**
   * The format of input audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`. For
   * `pcm16`, input audio must be 16-bit PCM at a 24kHz sample rate, single channel
   * (mono), and little-endian byte order.
   */
  input_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';

  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through
   * [OpenAI Whisper transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription)
   * and should be treated as rough guidance rather than the representation
   * understood by the model. The client can optionally set the language and prompt
   * for transcription, these fields will be passed to the Whisper API.
   */
  input_audio_transcription?: SessionCreateParams.InputAudioTranscription;

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
  max_response_output_tokens?: number | 'inf';

  /**
   * The set of modalities the model can respond with. To disable audio, set this to
   * ["text"].
   */
  modalities?: Array<'text' | 'audio'>;

  /**
   * The Realtime model used for this session.
   */
  model?:
    | 'gpt-4o-realtime-preview'
    | 'gpt-4o-realtime-preview-2024-10-01'
    | 'gpt-4o-realtime-preview-2024-12-17'
    | 'gpt-4o-mini-realtime-preview'
    | 'gpt-4o-mini-realtime-preview-2024-12-17';

  /**
   * The format of output audio. Options are `pcm16`, `g711_ulaw`, or `g711_alaw`.
   * For `pcm16`, output audio is sampled at a rate of 24kHz.
   */
  output_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';

  /**
   * Sampling temperature for the model, limited to [0.6, 1.2]. Defaults to 0.8.
   */
  temperature?: number;

  /**
   * How the model chooses tools. Options are `auto`, `none`, `required`, or specify
   * a function.
   */
  tool_choice?: string;

  /**
   * Tools (functions) available to the model.
   */
  tools?: Array<SessionCreateParams.Tool>;

  /**
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  turn_detection?: SessionCreateParams.TurnDetection;

  /**
   * The voice the model uses to respond. Voice cannot be changed during the session
   * once the model has responded with audio at least once. Current voice options are
   * `alloy`, `ash`, `ballad`, `coral`, `echo` `sage`, `shimmer` and `verse`.
   */
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
}

export namespace SessionCreateParams {
  /**
   * Configuration for input audio transcription, defaults to off and can be set to
   * `null` to turn off once on. Input audio transcription is not native to the
   * model, since the model consumes audio directly. Transcription runs
   * asynchronously through
   * [OpenAI Whisper transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription)
   * and should be treated as rough guidance rather than the representation
   * understood by the model. The client can optionally set the language and prompt
   * for transcription, these fields will be passed to the Whisper API.
   */
  export interface InputAudioTranscription {
    /**
     * The language of the input audio. Supplying the input language in
     * [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) (e.g. `en`)
     * format will improve accuracy and latency.
     */
    language?: string;

    /**
     * The model to use for transcription, `whisper-1` is the only currently supported
     * model.
     */
    model?: string;

    /**
     * An optional text to guide the model's style or continue a previous audio
     * segment. The
     * [prompt](https://platform.openai.com/docs/guides/speech-to-text#prompting)
     * should match the audio language.
     */
    prompt?: string;
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
   * Configuration for turn detection. Can be set to `null` to turn off. Server VAD
   * means that the model will detect the start and end of speech based on audio
   * volume and respond at the end of user speech.
   */
  export interface TurnDetection {
    /**
     * Whether or not to automatically generate a response when VAD is enabled. `true`
     * by default.
     */
    create_response?: boolean;

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

export declare namespace Sessions {
  export {
    type Session as Session,
    type SessionCreateResponse as SessionCreateResponse,
    type SessionCreateParams as SessionCreateParams,
  };
}
