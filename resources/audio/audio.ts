// File generated from our OpenAPI spec by Stainless.

import { APIResource } from "../../resource.ts";
import { Transcriptions } from "./transcriptions.ts";
import { Translations } from "./translations.ts";
import * as API from "./mod.ts";

export class Audio extends APIResource {
  transcriptions: Transcriptions = new Transcriptions(this.client);
  translations: Translations = new Translations(this.client);
}

export namespace Audio {
  export type Transcriptions = API.Transcriptions;
  export type Transcription = API.Transcription;
  export type TranscriptionCreateParams = API.TranscriptionCreateParams;

  export type Translations = API.Translations;
  export type Translation = API.Translation;
  export type TranslationCreateParams = API.TranslationCreateParams;
}
