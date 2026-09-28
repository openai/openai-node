// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as RealtimeAPI from '../realtime';
import { APIPromise } from '../../../core/api-promise';
import { RequestOptions } from '../../../internal/request-options';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class ClientSecrets extends APIResource {
  /**
   * Create a Realtime translation client secret with an associated translation
   * session configuration.
   *
   * Client secrets are short-lived tokens that can be passed to a client app, such
   * as a web frontend or mobile client, which grants access to the Realtime
   * Translation API without leaking your main API key. You can configure a custom
   * TTL for each client secret.
   *
   * Returns the created client secret and the effective translation session object.
   * The client secret is a string that looks like `ek_1234`.
   *
   * @example
   * ```ts
   * const realtimeTranslationClientSecretCreateResponse =
   *   await client.realtime.translations.clientSecrets.create(
   *     { session: { model: 'model' } },
   *   );
   * ```
   */
  create(
    body: ClientSecretCreateParams,
    options?: RequestOptions,
  ): APIPromise<RealtimeAPI.RealtimeTranslationClientSecretCreateResponse> {
    return this._client.post(
      '/realtime/translations/client_secrets',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }
}

export interface ClientSecretCreateParams {
  /**
   * Realtime translation session configuration. Translation sessions stream source
   * audio in and translated audio plus transcript deltas out continuously.
   */
  session: RealtimeAPI.RealtimeTranslationSessionCreateRequest;

  /**
   * Configuration for the client secret expiration. Expiration refers to the time
   * after which a client secret will no longer be valid for creating sessions. The
   * session itself may continue after that time once started. A secret can be used
   * to create multiple sessions until it expires.
   */
  expires_after?: ClientSecretCreateParams.ExpiresAfter;
}

export namespace ClientSecretCreateParams {
  /**
   * Configuration for the client secret expiration. Expiration refers to the time
   * after which a client secret will no longer be valid for creating sessions. The
   * session itself may continue after that time once started. A secret can be used
   * to create multiple sessions until it expires.
   */
  export interface ExpiresAfter {
    /**
     * The anchor point for the client secret expiration, meaning that `seconds` will
     * be added to the `created_at` time of the client secret to produce an expiration
     * timestamp. Only `created_at` is currently supported.
     */
    anchor?: 'created_at';

    /**
     * The number of seconds from the anchor point to the expiration. Select a value
     * between `10` and `7200` (2 hours). This default to 600 seconds (10 minutes) if
     * not specified.
     */
    seconds?: number;
  }
}

export declare namespace ClientSecrets {
  export { type ClientSecretCreateParams as ClientSecretCreateParams };
}
