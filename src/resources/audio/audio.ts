// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as AudioAPI from './audio';
import * as SpeechAPI from './speech';
import * as TranscriptionsAPI from './transcriptions';
import * as TranslationsAPI from './translations';

export class Audio extends APIResource {
  transcriptions: TranscriptionsAPI.Transcriptions = new TranscriptionsAPI.Transcriptions(this._client);
  translations: TranslationsAPI.Translations = new TranslationsAPI.Translations(this._client);
  speech: SpeechAPI.Speech = new SpeechAPI.Speech(this._client);
}

export type AudioModel = 'whisper-1';

/**
 * The format of the output, in one of these options: `json`, `text`, `srt`,
 * `verbose_json`, or `vtt`.
 */
export type AudioResponseFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';

export namespace Audio {
  export import AudioModel = AudioAPI.AudioModel;
  export import AudioResponseFormat = AudioAPI.AudioResponseFormat;
  export import Transcriptions = TranscriptionsAPI.Transcriptions;
  export import Transcription = TranscriptionsAPI.Transcription;
  export import TranscriptionSegment = TranscriptionsAPI.TranscriptionSegment;
  export import TranscriptionVerbose = TranscriptionsAPI.TranscriptionVerbose;
  export import TranscriptionWord = TranscriptionsAPI.TranscriptionWord;
  export import TranscriptionCreateResponse = TranscriptionsAPI.TranscriptionCreateResponse;
  export type TranscriptionCreateParams<
    ResponseFormat extends AudioAPI.AudioResponseFormat | undefined =
      | AudioAPI.AudioResponseFormat
      | undefined,
  > = TranscriptionsAPI.TranscriptionCreateParams<ResponseFormat>;
  export import Translations = TranslationsAPI.Translations;
  export import Translation = TranslationsAPI.Translation;
  export import TranslationVerbose = TranslationsAPI.TranslationVerbose;
  export import TranslationCreateResponse = TranslationsAPI.TranslationCreateResponse;
  export type TranslationCreateParams<
    ResponseFormat extends AudioAPI.AudioResponseFormat | undefined =
      | AudioAPI.AudioResponseFormat
      | undefined,
  > = TranslationsAPI.TranslationCreateParams<ResponseFormat>;
  export import Speech = SpeechAPI.Speech;
  export import SpeechModel = SpeechAPI.SpeechModel;
  export import SpeechCreateParams = SpeechAPI.SpeechCreateParams;
}
