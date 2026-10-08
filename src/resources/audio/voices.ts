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
   * Create a custom voice you can use for audio output (for example, in
   * Text-to-Speech and the Realtime API). This requires an audio sample and a
   * previously uploaded consent recording.
   *
   * Send `name`, `audio_sample`, and the `consent` recording ID as multipart form
   * data. The optional `type` defaults to `audio_sample`.
   *
   * Returns the saved voice's metadata. See the
   * [custom voices guide](https://developers.openai.com/api/docs/guides/text-to-speech#custom-voices)
   * for requirements and best practices. Custom voices are limited to eligible
   * customers.
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
 * A custom voice that can be used for audio output.
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
   * How the voice was created.
   */
  type: 'audio_sample';
}

export type VoiceCreateParams = VoiceCreateParams.Consent;

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
}

export declare namespace Voices {
  export { type Voice as Voice, type VoiceCreateParams as VoiceCreateParams };
}
