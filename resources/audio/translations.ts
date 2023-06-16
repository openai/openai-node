// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import type * as FormData from 'formdata-node';
import { multipartFormRequestOptions } from '~/core';

export class Translations extends APIResource {
  /**
   * Translates audio into into English.
   */
  create(
    body: TranslationCreateParams,
    options?: Core.RequestOptions,
  ): Promise<Core.APIResponse<Translation>> {
    return this.post('/audio/translations', multipartFormRequestOptions({ body, ...options }));
  }
}

export interface Translation {
  text: string;
}

export interface TranslationCreateParams {
  /**
   * The audio file object (not file name) translate, in one of these formats: mp3,
   * mp4, mpeg, mpga, m4a, wav, or webm.
   */
  file: FormData.Blob | FormData.File;

  /**
   * ID of the model to use. Only `whisper-1` is currently available.
   */
  model: string;

  /**
   * An optional text to guide the model's style or continue a previous audio
   * segment. The [prompt](/docs/guides/speech-to-text/prompting) should be in
   * English.
   */
  prompt?: string;

  /**
   * The format of the transcript output, in one of these options: json, text, srt,
   * verbose_json, or vtt.
   */
  response_format?: string;

  /**
   * The sampling temperature, between 0 and 1. Higher values like 0.8 will make the
   * output more random, while lower values like 0.2 will make it more focused and
   * deterministic. If set to 0, the model will use
   * [log probability](https://en.wikipedia.org/wiki/Log_probability) to
   * automatically increase the temperature until certain thresholds are hit.
   */
  temperature?: number;
}
