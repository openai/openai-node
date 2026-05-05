// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as CallsAPI from './calls';
import { Calls } from './calls';
import * as ClientSecretsAPI from './client-secrets';
import { ClientSecrets } from './client-secrets';

export class Translations extends APIResource {
  clientSecrets: ClientSecretsAPI.ClientSecrets = new ClientSecretsAPI.ClientSecrets(this._client);
  calls: CallsAPI.Calls = new CallsAPI.Calls(this._client);
}

Translations.ClientSecrets = ClientSecrets;
Translations.Calls = Calls;

export declare namespace Translations {
  export { ClientSecrets as ClientSecrets };

  export { Calls as Calls };
}
