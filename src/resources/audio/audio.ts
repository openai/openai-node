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
  export type AudioModel = AudioAPI.AudioModel;
  export type AudioResponseFormat = AudioAPI.AudioResponseFormat;
  export import Transcriptions = TranscriptionsAPI.Transcriptions;
  export type Transcription = TranscriptionsAPI.Transcription;
  export type TranscriptionSegment = TranscriptionsAPI.TranscriptionSegment;
  export type TranscriptionVerbose = TranscriptionsAPI.TranscriptionVerbose;
  export type TranscriptionWord = TranscriptionsAPI.TranscriptionWord;
  export type TranscriptionCreateResponse = TranscriptionsAPI.TranscriptionCreateResponse;
  export type TranscriptionCreateParams = TranscriptionsAPI.TranscriptionCreateParams;
  export import Translations = TranslationsAPI.Translations;
  export type Translation = TranslationsAPI.Translation;
  export type TranslationVerbose = TranslationsAPI.TranslationVerbose;
  export type TranslationCreateResponse = TranslationsAPI.TranslationCreateResponse;
  export type TranslationCreateParams = TranslationsAPI.TranslationCreateParams;
  export import Speech = SpeechAPI.Speech;
  export type SpeechModel = SpeechAPI.SpeechModel;
  export type SpeechCreateParams = SpeechAPI.SpeechCreateParams;
}
