// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { APIPromise } from '../../core/api-promise';
import { type Uploadable } from '../../core/uploads';
import { RequestOptions } from '../../internal/request-options';
import { multipartFormRequestOptions } from '../../internal/uploads';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

/**
 * Turn audio into text or text into audio.
 */
export class Voices extends APIResource {
  /**
   * Creates a voice from a text prompt or from a consent recording and an audio
   * sample.
   *
   * For prompt-based creation, send `type: "prompt"` with a `name` and `prompt` as
   * JSON or multipart form data. For creation from an audio sample, send
   * `type: "audio_sample"` with a `name`, `audio_sample`, and `consent` recording ID
   * as multipart form data. The type defaults to `audio_sample` when omitted.
   *
   * Returns the saved voice's metadata. Voices created from text prompts are
   * supported only in Live, not in Realtime or the speech endpoint. The response
   * does not include preview audio.
   *
   * @example
   * ```ts
   * const voice = await client.audio.voices.create({
   *   audio_sample: fs.createReadStream('path/to/file'),
   *   consent: 'consent',
   *   name: 'x',
   * });
   * ```
   */
  create(body: VoiceCreateParams, options?: RequestOptions): APIPromise<Voice> {
    return this._client.post(
      '/audio/voices',
      resolveResourceRequestOptions(options, (options) =>
        multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client),
      ),
    );
  }
}

/**
 * A custom voice that can be used for audio output. Voices created from text
 * prompts are supported only in Live.
 */
export interface Voice {
  /**
   * The voice identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the voice was created.
   */
  created_at: number;

  /**
   * The name of the voice.
   */
  name: string;

  /**
   * The object type, which is always `audio.voice`.
   */
  object: 'audio.voice';

  /**
   * How the voice was created. Voices created from text prompts are supported only
   * in Live.
   */
  type: 'audio_sample' | 'prompt';
}

export type VoiceCreateParams = VoiceCreateParams.Consent | VoiceCreateParams.Prompt;

export declare namespace VoiceCreateParams {
  /**
   * Creates a voice from a consent recording and an audio sample. Requires
   * multipart/form-data.
   */
  export interface Consent {
    /**
     * The sample audio recording file. Maximum size is 10 MiB.
     *
     * Supported MIME types: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/ogg`,
     * `audio/aac`, `audio/flac`, `audio/webm`, `audio/mp4`.
     */
    audio_sample: Uploadable;

    /**
     * The consent recording ID (for example, `cons_1234`).
     */
    consent: string;

    /**
     * The name of the new voice.
     */
    name: string;

    /**
     * The voice creation method. Defaults to `audio_sample` when omitted.
     */
    type?: 'audio_sample';
  }

  /**
   * Creates a synthetic voice from a text description. Supports application/json or
   * multipart/form-data.
   */
  export interface Prompt {
    /**
     * The name of the new voice.
     */
    name: string;

    /**
     * A description of the desired voice. Must not contain only whitespace.
     */
    prompt: string;

    /**
     * Set to `prompt` to create a voice from a text description.
     */
    type: 'prompt';

    /**
     * The voice creation model to use. Defaults to `auto`.
     */
    model?: string | 'auto' | '2026-10-01';

    /**
     * Optional text for the voice to speak during creation. If omitted, a script is
     * generated from the prompt. Must not be blank after trimming whitespace; scripts
     * that are too short are rejected.
     */
    script_hint?: string;
  }
}

export declare namespace Voices {
  export { type Voice as Voice, type VoiceCreateParams as VoiceCreateParams };
}
