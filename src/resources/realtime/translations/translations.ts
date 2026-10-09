// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as ClientSecretsAPI from './client-secrets';
import { ClientSecretCreateParams, ClientSecrets } from './client-secrets';

export class Translations extends APIResource {
  clientSecrets: ClientSecretsAPI.ClientSecrets = new ClientSecretsAPI.ClientSecrets(this._client);
}

Translations.ClientSecrets = ClientSecrets;

export declare namespace Translations {
  export { ClientSecrets as ClientSecrets, type ClientSecretCreateParams as ClientSecretCreateParams };
}
