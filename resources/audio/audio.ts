// File generated from our OpenAPI spec by Stainless.

import { APIResource } from "../../resource.ts";
import * as TranscriptionsAPI from "./transcriptions.ts";
import * as TranslationsAPI from "./translations.ts";

export class Audio extends APIResource {
  transcriptions: TranscriptionsAPI.Transcriptions = new TranscriptionsAPI
    .Transcriptions(this.client);
  translations: TranslationsAPI.Translations = new TranslationsAPI.Translations(
    this.client,
  );
}

export namespace Audio {
  export import Transcriptions = TranscriptionsAPI.Transcriptions;
  export type Transcription = TranscriptionsAPI.Transcription;
  export type TranscriptionCreateParams =
    TranscriptionsAPI.TranscriptionCreateParams;
  export import Translations = TranslationsAPI.Translations;
  export type Translation = TranslationsAPI.Translation;
  export type TranslationCreateParams = TranslationsAPI.TranslationCreateParams;
}
