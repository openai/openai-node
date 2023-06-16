// File generated from our OpenAPI spec by Stainless.

import { APIResource } from '~/resource';
import { Transcriptions } from './transcriptions';
import { Translations } from './translations';

export class Audio extends APIResource {
  transcriptions: Transcriptions = new Transcriptions(this.client);
  translations: Translations = new Translations(this.client);
}
