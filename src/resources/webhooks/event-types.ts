// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as WebhooksAPI from './webhooks';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class EventTypes extends APIResource {
  /**
   * Returns webhook event types visible to the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEventTypeList =
   *   await client.webhooks.eventTypes.list();
   * ```
   */
  list(options?: RequestOptions): APIPromise<WebhooksAPI.WebhookEventTypeList> {
    return this._client.get(
      '/webhook_event_types',
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }
}
