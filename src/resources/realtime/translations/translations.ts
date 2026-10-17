// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as RealtimeAPI from '../realtime';
import * as ClientSecretsAPI from './client-secrets';
import { ClientSecretCreateParams, ClientSecrets } from './client-secrets';

export class Translations extends APIResource {
  clientSecrets: ClientSecretsAPI.ClientSecrets = new ClientSecretsAPI.ClientSecrets(this._client);
}

/**
 * A Realtime translation client event.
 */
export type ConnectClientEvent =
  | RealtimeAPI.RealtimeTranslationSessionUpdateEvent
  | RealtimeAPI.RealtimeTranslationInputAudioBufferAppendEvent
  | RealtimeAPI.RealtimeTranslationSessionCloseEvent;

Translations.ClientSecrets = ClientSecrets;

export declare namespace Translations {
  export { type ConnectClientEvent as ConnectClientEvent };

  export { ClientSecrets as ClientSecrets, type ClientSecretCreateParams as ClientSecretCreateParams };
}
