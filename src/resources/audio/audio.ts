// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as SpeechAPI from './speech';
import * as TranscriptionsAPI from './transcriptions';
import * as TranslationsAPI from './translations';

export class Audio extends APIResource {
  transcriptions: TranscriptionsAPI.Transcriptions = new TranscriptionsAPI.Transcriptions(this._client);
  translations: TranslationsAPI.Translations = new TranslationsAPI.Translations(this._client);
  speech: SpeechAPI.Speech = new SpeechAPI.Speech(this._client);
}

export namespace Audio {
  export import Transcriptions = TranscriptionsAPI.Transcriptions;
  export import Transcription = TranscriptionsAPI.Transcription;
  export import TranscriptionCreateParams = TranscriptionsAPI.TranscriptionCreateParams;
  export import Translations = TranslationsAPI.Translations;
  export import Translation = TranslationsAPI.Translation;
  export import TranslationCreateParams = TranslationsAPI.TranslationCreateParams;
  export import Speech = SpeechAPI.Speech;
  export import SpeechCreateParams = SpeechAPI.SpeechCreateParams;
}
