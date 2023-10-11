// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as TranscriptionsAPI from 'openai/resources/audio/transcriptions';
import * as TranslationsAPI from 'openai/resources/audio/translations';

export class Audio extends APIResource {
  transcriptions: TranscriptionsAPI.Transcriptions = new TranscriptionsAPI.Transcriptions(this.client);
  translations: TranslationsAPI.Translations = new TranslationsAPI.Translations(this.client);
}

export namespace Audio {
  export import Transcriptions = TranscriptionsAPI.Transcriptions;
  export type Transcription = TranscriptionsAPI.Transcription;
  export type TranscriptionCreateParams = TranscriptionsAPI.TranscriptionCreateParams;
  export import Translations = TranslationsAPI.Translations;
  export type Translation = TranslationsAPI.Translation;
  export type TranslationCreateParams = TranslationsAPI.TranslationCreateParams;
}
