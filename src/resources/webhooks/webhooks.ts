// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { buildHeaders, HeadersLike } from '../../internal/headers';
import { verifyWebhookSignature, webhookSignatureRequiresSigning } from '../../lib/webhook-signature';

import * as EventTypesAPI from './event-types';
import { EventTypes } from './event-types';
import { APIPromise } from '../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../core/pagination';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

// Recognizable options across SDK runtime versions. Keep this independent of
// private RequestOptions fields so older handwritten runtimes still compile.
const normalizeRequestOptionsForQueryKeys = new Set([
  'method',
  'path',
  'query',
  'body',
  'headers',
  'maxRetries',
  'stream',
  'timeout',
  'httpAgent',
  'fetchOptions',
  'signal',
  'idempotencyKey',
  'defaultBaseURL',
  '__metadata',
  '__binaryRequest',
  '__binaryResponse',
  '__streamClass',
  '__security',
  '__synthesizeEventData',
]);

function normalizeRequestOptionsForQuery(
  value: unknown,
  queryKeys: ReadonlyArray<string>,
  options: RequestOptions | undefined,
):
  | ({
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    })
  | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Optional never fields can still be explicitly undefined unless consumers
  // enable exactOptionalPropertyTypes. Snapshot data without invoking getters.
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([, descriptor]) => descriptor.enumerable && (!('value' in descriptor) || descriptor.value !== undefined),
  );
  const keys = entries.map(([key]) => key);
  const requestOnly = keys.some(
    (key) => normalizeRequestOptionsForQueryKeys.has(key) && !queryKeys.includes(key),
  );
  if (!requestOnly) return undefined;
  // Declared query fields, including stream, must use the query argument.
  // Mixing them with request-only options is ambiguous and could change the return type.
  if (
    options !== undefined ||
    keys.some((key) => !normalizeRequestOptionsForQueryKeys.has(key) || queryKeys.includes(key))
  ) {
    throw new TypeError('Query parameters and request options must be passed as separate arguments.');
  }
  // The query position must not gain authority to change the request destination
  // or transport. Those overrides require the explicit request options argument.
  if (
    keys.some(
      (key) => !['headers', 'maxRetries', 'timeout', 'signal', 'idempotencyKey', 'query'].includes(key),
    )
  ) {
    throw new TypeError('Pass transport overrides in the explicit request options argument.');
  }
  // Copy only the validated fields. Spreading value would reintroduce undefined
  // transport overrides, and deleting them would mutate the caller's object.
  return Object.fromEntries(
    entries.map(([key, descriptor]) => {
      if ('value' in descriptor) return [key, descriptor.value];
      return [key, descriptor.get ? Reflect.apply(descriptor.get, value, []) : undefined];
    }),
  ) as {
    [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
  } & {
    [
      K in
        | 'method'
        | 'path'
        | 'body'
        | 'stream'
        | 'httpAgent'
        | 'fetchOptions'
        | 'defaultBaseURL'
        | '__metadata'
        | '__binaryRequest'
        | '__binaryResponse'
        | '__streamClass'
        | '__security'
        | '__synthesizeEventData'
    ]?: never;
  };
}

export class Webhooks extends APIResource {
  eventTypes: EventTypesAPI.EventTypes = new EventTypesAPI.EventTypes(this._client);

  /**
   * Creates a webhook endpoint for the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEndpointWithSecret =
   *   await client.webhooks.create({
   *     event_types: ['batch.completed'],
   *     name: 'x',
   *     url: 'https://',
   *   });
   * ```
   */
  create(body: WebhookCreateParams, options?: RequestOptions): APIPromise<WebhookEndpointWithSecret> {
    return this._client.post(
      '/webhook_endpoints',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Retrieves a webhook endpoint for the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEndpoint = await client.webhooks.retrieve(
   *   'whe_123',
   * );
   * ```
   */
  retrieve(webhookEndpointID: string, options?: RequestOptions): APIPromise<WebhookEndpoint> {
    return this._client.get(
      path`/webhook_endpoints/${webhookEndpointID}`,
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }

  /**
   * Updates a webhook endpoint for the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEndpoint = await client.webhooks.update('whe_123');
   * ```
   */
  update(
    webhookEndpointID: string,
    body: WebhookUpdateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<WebhookEndpoint> {
    return this._client.post(
      path`/webhook_endpoints/${webhookEndpointID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Returns webhook endpoints for the authenticated project in newest-first order.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const webhookEndpoint of client.webhooks.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (WebhookListParams &
          (
            | {
                [
                  K in
                    | 'method'
                    | 'path'
                    | 'query'
                    | 'body'
                    | 'headers'
                    | 'maxRetries'
                    | 'stream'
                    | 'timeout'
                    | 'httpAgent'
                    | 'fetchOptions'
                    | 'signal'
                    | 'idempotencyKey'
                    | 'defaultBaseURL'
                    | '__metadata'
                    | '__binaryRequest'
                    | '__binaryResponse'
                    | '__streamClass'
                    | '__security'
                    | '__synthesizeEventData'
                ]?: never;
              }
            | null
            | undefined
          ))
      | null
      | undefined,
    options?: RequestOptions,
  ): PagePromise<WebhookEndpointsPage, WebhookEndpoint>;
  list(
    options?: {
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    },
  ): PagePromise<WebhookEndpointsPage, WebhookEndpoint>;
  list(
    query:
      | WebhookListParams
      | ({
          [
            K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query'
          ]?: RequestOptions[K];
        } & {
          [
            K in
              | 'method'
              | 'path'
              | 'body'
              | 'stream'
              | 'httpAgent'
              | 'fetchOptions'
              | 'defaultBaseURL'
              | '__metadata'
              | '__binaryRequest'
              | '__binaryResponse'
              | '__streamClass'
              | '__security'
              | '__synthesizeEventData'
          ]?: never;
        })
      | null
      | undefined = {},
    options?: RequestOptions,
  ): PagePromise<WebhookEndpointsPage, WebhookEndpoint> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as WebhookListParams | null | undefined;
    return this._client.getAPIList(
      '/webhook_endpoints',
      CursorPage<WebhookEndpoint>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Deletes a webhook endpoint for the authenticated project.
   *
   * @example
   * ```ts
   * const deletedWebhookEndpoint = await client.webhooks.delete(
   *   'whe_123',
   * );
   * ```
   */
  delete(webhookEndpointID: string, options?: RequestOptions): APIPromise<DeletedWebhookEndpoint> {
    return this._client.delete(
      path`/webhook_endpoints/${webhookEndpointID}`,
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }

  /**
   * Rotates the signing secret for a webhook endpoint in the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEndpointWithSecret =
   *   await client.webhooks.rotateSecret('whe_123');
   * ```
   */
  rotateSecret(
    webhookEndpointID: string,
    body: WebhookRotateSecretParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<WebhookEndpointWithSecret> {
    return this._client.post(
      path`/webhook_endpoints/${webhookEndpointID}/rotate_secret`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Sends a sample event to a webhook endpoint for the authenticated project.
   *
   * @example
   * ```ts
   * const webhookEndpointTestResult =
   *   await client.webhooks.test('whe_123', {
   *     event_type: 'batch.completed',
   *   });
   * ```
   */
  test(
    webhookEndpointID: string,
    body: WebhookTestParams,
    options?: RequestOptions,
  ): APIPromise<WebhookEndpointTestResult> {
    return this._client.post(
      path`/webhook_endpoints/${webhookEndpointID}/test`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Validates that the given payload was sent by OpenAI and parses the payload.
   */
  async unwrap(
    payload: string,
    headers: HeadersLike,
    secret: string | undefined | null = this._client.webhookSecret,
    tolerance: number = 300,
  ): Promise<UnwrapWebhookEvent> {
    await this.verifySignature(payload, headers, secret, tolerance);

    return JSON.parse(payload) as UnwrapWebhookEvent;
  }

  /**
   * Validates whether or not the webhook payload was sent by OpenAI.
   *
   * An error will be raised if the webhook payload was not sent by OpenAI.
   *
   * @param payload - The webhook payload
   * @param headers - The webhook headers
   * @param secret - The webhook secret (optional, will use client secret if not provided)
   * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
   */
  async verifySignature(
    payload: string,
    headers: HeadersLike,
    secret: string | undefined | null = this._client.webhookSecret,
    tolerance: number = 300,
  ): Promise<void> {
    if (
      typeof crypto === 'undefined' ||
      typeof crypto.subtle?.importKey !== 'function' ||
      typeof crypto.subtle.verify !== 'function'
    ) {
      throw new Error('Webhook signature verification is only supported when the `crypto` global is defined');
    }

    this.#validateSecret(secret);

    const headersObj = buildHeaders([headers]).values;
    const signatureHeader = this.#getRequiredHeader(headersObj, 'webhook-signature');
    const timestamp = this.#getRequiredHeader(headersObj, 'webhook-timestamp');
    const webhookId = this.#getRequiredHeader(headersObj, 'webhook-id');

    if (webhookSignatureRequiresSigning(signatureHeader) && typeof crypto.subtle.sign !== 'function') {
      throw new Error('Webhook signature verification is only supported when the `crypto` global is defined');
    }

    return await verifyWebhookSignature(payload, signatureHeader, timestamp, webhookId, secret, tolerance);
  }

  #validateSecret(secret: string | null | undefined): asserts secret is string {
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error(
        `The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function`,
      );
    }
  }

  #getRequiredHeader(headers: Headers, name: string): string {
    if (!headers) {
      throw new Error(`Headers are required`);
    }

    const value = headers.get(name);

    if (value === null || value === undefined) {
      throw new Error(`Missing required header: ${name}`);
    }

    return value;
  }
}

export type WebhookEndpointsPage = CursorPage<WebhookEndpoint>;

/**
 * Sent when a batch API request has been cancelled.
 */
export interface BatchCancelledWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the batch API request was cancelled.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: BatchCancelledWebhookEvent.Data;

  /**
   * The type of the event. Always `batch.cancelled`.
   */
  type: 'batch.cancelled';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace BatchCancelledWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the batch API request.
     */
    id: string;
  }
}

/**
 * Sent when a batch API request has been completed.
 */
export interface BatchCompletedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the batch API request was completed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: BatchCompletedWebhookEvent.Data;

  /**
   * The type of the event. Always `batch.completed`.
   */
  type: 'batch.completed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace BatchCompletedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the batch API request.
     */
    id: string;
  }
}

/**
 * Sent when a batch API request has expired.
 */
export interface BatchExpiredWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the batch API request expired.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: BatchExpiredWebhookEvent.Data;

  /**
   * The type of the event. Always `batch.expired`.
   */
  type: 'batch.expired';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace BatchExpiredWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the batch API request.
     */
    id: string;
  }
}

/**
 * Sent when a batch API request has failed.
 */
export interface BatchFailedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the batch API request failed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: BatchFailedWebhookEvent.Data;

  /**
   * The type of the event. Always `batch.failed`.
   */
  type: 'batch.failed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace BatchFailedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the batch API request.
     */
    id: string;
  }
}

export interface DeletedWebhookEndpoint {
  /**
   * The ID of the deleted webhook endpoint.
   */
  id: string;

  /**
   * Whether the endpoint was deleted.
   */
  deleted: boolean;

  /**
   * The object type, which is always webhook_endpoint.deleted.
   */
  object: 'webhook_endpoint.deleted';
}

/**
 * Sent when an eval run has been canceled.
 */
export interface EvalRunCanceledWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the eval run was canceled.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: EvalRunCanceledWebhookEvent.Data;

  /**
   * The type of the event. Always `eval.run.canceled`.
   */
  type: 'eval.run.canceled';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace EvalRunCanceledWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the eval run.
     */
    id: string;
  }
}

/**
 * Sent when an eval run has failed.
 */
export interface EvalRunFailedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the eval run failed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: EvalRunFailedWebhookEvent.Data;

  /**
   * The type of the event. Always `eval.run.failed`.
   */
  type: 'eval.run.failed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace EvalRunFailedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the eval run.
     */
    id: string;
  }
}

/**
 * Sent when an eval run has succeeded.
 */
export interface EvalRunSucceededWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the eval run succeeded.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: EvalRunSucceededWebhookEvent.Data;

  /**
   * The type of the event. Always `eval.run.succeeded`.
   */
  type: 'eval.run.succeeded';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace EvalRunSucceededWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the eval run.
     */
    id: string;
  }
}

/**
 * Sent when a fine-tuning job has been cancelled.
 */
export interface FineTuningJobCancelledWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the fine-tuning job was cancelled.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: FineTuningJobCancelledWebhookEvent.Data;

  /**
   * The type of the event. Always `fine_tuning.job.cancelled`.
   */
  type: 'fine_tuning.job.cancelled';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace FineTuningJobCancelledWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the fine-tuning job.
     */
    id: string;
  }
}

/**
 * Sent when a fine-tuning job has failed.
 */
export interface FineTuningJobFailedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the fine-tuning job failed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: FineTuningJobFailedWebhookEvent.Data;

  /**
   * The type of the event. Always `fine_tuning.job.failed`.
   */
  type: 'fine_tuning.job.failed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace FineTuningJobFailedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the fine-tuning job.
     */
    id: string;
  }
}

/**
 * Sent when a fine-tuning job has succeeded.
 */
export interface FineTuningJobSucceededWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the fine-tuning job succeeded.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: FineTuningJobSucceededWebhookEvent.Data;

  /**
   * The type of the event. Always `fine_tuning.job.succeeded`.
   */
  type: 'fine_tuning.job.succeeded';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace FineTuningJobSucceededWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the fine-tuning job.
     */
    id: string;
  }
}

/**
 * @deprecated Deprecated: use `live.transport.incoming`. Retained for existing
 * subscriptions during migration; new subscriptions to this event are not allowed.
 * Sent when an incoming API SIP session is available for Live acceptance. The same
 * pending session can also emit `realtime.call.incoming`; the first successful
 * Realtime or Live accept endpoint selects the runtime surface.
 */
export interface LiveCallIncomingWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the event was created.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: LiveCallIncomingWebhookEvent.Data;

  /**
   * The type of the event. Always `live.call.incoming`.
   */
  type: 'live.call.incoming';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace LiveCallIncomingWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The `live_...` ID of the pending SIP session. Pass this value unchanged to Live
     * call controls and sideband connections. The corresponding
     * `realtime.call.incoming` event uses a separate `rtc_...` call ID.
     */
    session_id: string;

    /**
     * Headers from the SIP INVITE, excluding SIP authorization headers. Retained
     * names, values, repeated entries, and order are preserved. Treat these values as
     * untrusted call metadata.
     */
    sip_headers: Array<Data.SipHeader>;

    /**
     * Media protection selected on the SIP leg during SDP negotiation. `srtp`
     * indicates SRTP; `rtp` indicates unencrypted RTP. Omitted when unknown. This does
     * not describe SIP signaling security or confirm that media has flowed. Clients
     * should handle unrecognized values as unknown.
     */
    sip_media_security?: 'rtp' | 'srtp' | (string & {});
  }

  export namespace Data {
    /**
     * A header from the SIP Invite.
     */
    export interface SipHeader {
      /**
       * Name of the SIP Header.
       */
      name: string;

      /**
       * Value of the SIP Header.
       */
      value: string;
    }
  }
}

/**
 * Sent when an incoming API SIP session is available for Live acceptance. The same
 * pending session can also emit `realtime.call.incoming`; the first successful
 * Realtime or Live accept endpoint selects the runtime surface.
 */
export interface LiveTransportIncomingWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the event was created.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: LiveTransportIncomingWebhookEvent.Data;

  /**
   * The type of the event. Always `live.transport.incoming`.
   */
  type: 'live.transport.incoming';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace LiveTransportIncomingWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The `live_...` ID of the pending SIP session. Forward this value unchanged when
     * accepting or rejecting the call through the Live API.
     */
    session_id: string;

    /**
     * Headers from the SIP INVITE, excluding SIP authorization headers. Retained
     * names, values, repeated entries, and order are preserved. Treat these values as
     * untrusted call metadata.
     */
    sip_headers: Array<Data.SipHeader>;

    /**
     * The incoming transport type. Always `sip`.
     */
    type: 'sip';

    /**
     * Media protection selected on the SIP leg during SDP negotiation. `srtp`
     * indicates SRTP; `rtp` indicates unencrypted RTP. Omitted when unknown. This does
     * not describe SIP signaling security or confirm that media has flowed. Clients
     * should handle unrecognized values as unknown.
     */
    sip_media_security?: 'rtp' | 'srtp' | (string & {});
  }

  export namespace Data {
    /**
     * A header from the SIP Invite.
     */
    export interface SipHeader {
      /**
       * Name of the SIP Header.
       */
      name: string;

      /**
       * Value of the SIP Header.
       */
      value: string;
    }
  }
}

/**
 * Sent when an incoming API SIP session is available for Realtime acceptance. The
 * same pending session can also emit `live.transport.incoming`; the first
 * successful Realtime or Live accept endpoint selects the runtime surface.
 */
export interface RealtimeCallIncomingWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the model response was completed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: RealtimeCallIncomingWebhookEvent.Data;

  /**
   * The type of the event. Always `realtime.call.incoming`.
   */
  type: 'realtime.call.incoming';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace RealtimeCallIncomingWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The ID of the pending SIP call. Pass this value unchanged when accepting or
     * rejecting the call through the Realtime API. For the Live API, use the
     * `session_id` from `live.transport.incoming` instead.
     */
    call_id: string;

    /**
     * Headers from the SIP INVITE, excluding SIP authorization headers. Retained
     * names, values, repeated entries, and order are preserved. Treat these values as
     * untrusted call metadata.
     */
    sip_headers: Array<Data.SipHeader>;

    /**
     * Media protection selected on the SIP leg during SDP negotiation. `srtp`
     * indicates SRTP; `rtp` indicates unencrypted RTP. Omitted when unknown. This does
     * not describe SIP signaling security or confirm that media has flowed. Clients
     * should handle unrecognized values as unknown.
     */
    sip_media_security?: 'rtp' | 'srtp' | (string & {});
  }

  export namespace Data {
    /**
     * A header from the SIP Invite.
     */
    export interface SipHeader {
      /**
       * Name of the SIP Header.
       */
      name: string;

      /**
       * Value of the SIP Header.
       */
      value: string;
    }
  }
}

/**
 * Sent when a background response has been cancelled.
 */
export interface ResponseCancelledWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the model response was cancelled.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: ResponseCancelledWebhookEvent.Data;

  /**
   * The type of the event. Always `response.cancelled`.
   */
  type: 'response.cancelled';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace ResponseCancelledWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the model response.
     */
    id: string;
  }
}

/**
 * Sent when a background response has been completed.
 */
export interface ResponseCompletedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the model response was completed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: ResponseCompletedWebhookEvent.Data;

  /**
   * The type of the event. Always `response.completed`.
   */
  type: 'response.completed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace ResponseCompletedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the model response.
     */
    id: string;
  }
}

/**
 * Sent when a background response has failed.
 */
export interface ResponseFailedWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the model response failed.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: ResponseFailedWebhookEvent.Data;

  /**
   * The type of the event. Always `response.failed`.
   */
  type: 'response.failed';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace ResponseFailedWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the model response.
     */
    id: string;
  }
}

/**
 * Sent when a background response has been interrupted.
 */
export interface ResponseIncompleteWebhookEvent {
  /**
   * The unique ID of the event.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the model response was interrupted.
   */
  created_at: number;

  /**
   * Event data payload.
   */
  data: ResponseIncompleteWebhookEvent.Data;

  /**
   * The type of the event. Always `response.incomplete`.
   */
  type: 'response.incomplete';

  /**
   * The object of the event. Always `event`.
   */
  object?: 'event';
}

export namespace ResponseIncompleteWebhookEvent {
  /**
   * Event data payload.
   */
  export interface Data {
    /**
     * The unique ID of the model response.
     */
    id: string;
  }
}

/**
 * Sent when an approved safety alert is available for an API project.
 */
export interface SafetyAlertCreatedWebhookEvent {
  /**
   * The unique ID of the webhook event.
   */
  id: string;

  /**
   * The Unix timestamp in seconds when the event was created.
   */
  created_at: number;

  data: SafetyAlertCreatedWebhookEvent.Data;

  /**
   * Always `event`.
   */
  object: 'event';

  /**
   * Always `safety.alert.created`.
   */
  type: 'safety.alert.created';
}

export namespace SafetyAlertCreatedWebhookEvent {
  export interface Data {
    /**
     * The safety alert ID to pass to `GET /v1/safety/alerts/{id}`.
     */
    id: string;
  }
}

/**
 * Sent when a deactivation is issued for a safety identifier in your organization.
 */
export interface SafetyDeactivationIssuedWebhookEvent {
  /**
   * The unique ID of the webhook event.
   */
  id: string;

  /**
   * The Unix timestamp in seconds when the event was created.
   */
  created_at: number;

  data: SafetyDeactivationIssuedWebhookEvent.Data;

  /**
   * Always `event`.
   */
  object: 'event';

  /**
   * Always `safety.deactivation_issued`.
   */
  type: 'safety.deactivation_issued';
}

export namespace SafetyDeactivationIssuedWebhookEvent {
  export interface Data {
    /**
     * The safety case ID to pass to `GET /v1/safety/cases/{id}`.
     */
    id: string;
  }
}

/**
 * Sent when an approved safety alert is available for an enterprise workspace.
 */
export interface SafetyOrgAlertCreatedWebhookEvent {
  /**
   * The unique ID of the webhook event.
   */
  id: string;

  /**
   * The Unix timestamp in seconds when the event was created.
   */
  created_at: number;

  data: SafetyOrgAlertCreatedWebhookEvent.Data;

  /**
   * Always `event`.
   */
  object: 'event';

  /**
   * Always `safety.org_alert.created`.
   */
  type: 'safety.org_alert.created';
}

export namespace SafetyOrgAlertCreatedWebhookEvent {
  export interface Data {
    /**
     * The safety alert ID to pass to `GET /v1/safety/alerts/{id}`.
     */
    id: string;
  }
}

/**
 * Sent when a warning is issued for a safety identifier in your organization.
 */
export interface SafetyWarningIssuedWebhookEvent {
  /**
   * The unique ID of the webhook event.
   */
  id: string;

  /**
   * The Unix timestamp in seconds when the event was created.
   */
  created_at: number;

  data: SafetyWarningIssuedWebhookEvent.Data;

  /**
   * Always `event`.
   */
  object: 'event';

  /**
   * Always `safety.warning_issued`.
   */
  type: 'safety.warning_issued';
}

export namespace SafetyWarningIssuedWebhookEvent {
  export interface Data {
    /**
     * The safety case ID to pass to `GET /v1/safety/cases/{id}`.
     */
    id: string;
  }
}

/**
 * Sent when a batch API request has been cancelled.
 */
export type UnwrapWebhookEvent =
  | BatchCancelledWebhookEvent
  | BatchCompletedWebhookEvent
  | BatchExpiredWebhookEvent
  | BatchFailedWebhookEvent
  | EvalRunCanceledWebhookEvent
  | EvalRunFailedWebhookEvent
  | EvalRunSucceededWebhookEvent
  | FineTuningJobCancelledWebhookEvent
  | FineTuningJobFailedWebhookEvent
  | FineTuningJobSucceededWebhookEvent
  | LiveCallIncomingWebhookEvent
  | LiveTransportIncomingWebhookEvent
  | RealtimeCallIncomingWebhookEvent
  | ResponseCancelledWebhookEvent
  | ResponseCompletedWebhookEvent
  | ResponseFailedWebhookEvent
  | ResponseIncompleteWebhookEvent
  | SafetyAlertCreatedWebhookEvent
  | SafetyDeactivationIssuedWebhookEvent
  | SafetyOrgAlertCreatedWebhookEvent
  | SafetyWarningIssuedWebhookEvent;

export interface WebhookEndpoint {
  /**
   * The unique ID of the webhook endpoint.
   */
  id: string;

  /**
   * The Unix timestamp when the endpoint was created.
   */
  created_at: number;

  /**
   * The event types that trigger deliveries to this endpoint.
   */
  event_types: Array<string>;

  /**
   * The human-readable name of the endpoint.
   */
  name: string;

  /**
   * The object type, which is always webhook_endpoint.
   */
  object: 'webhook_endpoint';

  /**
   * A masked hint for the endpoint's signing secret.
   */
  signing_secret_hint: string | null;

  /**
   * The HTTPS URL that receives webhook deliveries.
   */
  url: string;

  /**
   * The Unix timestamp of the last endpoint configuration or signing-secret change.
   * Initialized at creation; tests and unchanged updates do not advance it.
   */
  updated_at?: number;
}

export interface WebhookEndpointList {
  /**
   * The webhook endpoints in this page.
   */
  data: Array<WebhookEndpoint>;

  /**
   * The ID of the first endpoint in this page.
   */
  first_id: string | null;

  /**
   * Whether more webhook endpoints are available.
   */
  has_more: boolean;

  /**
   * The ID of the last endpoint in this page.
   */
  last_id: string | null;

  /**
   * The object type, which is always list.
   */
  object: 'list';
}

export interface WebhookEndpointTestResult {
  /**
   * The event type sent in the test.
   */
  event_type: string;

  /**
   * The object type, which is always webhook_endpoint.test.
   */
  object: 'webhook_endpoint.test';

  /**
   * The HTTP status code returned by the endpoint.
   */
  status_code: number;

  /**
   * Whether the test request completed. Always true for returned results; use
   * status_code to determine the endpoint response.
   */
  success: true;

  /**
   * The ID of the webhook endpoint that received the test.
   */
  webhook_endpoint_id: string;
}

export interface WebhookEndpointWithSecret {
  /**
   * The unique ID of the webhook endpoint.
   */
  id: string;

  /**
   * The Unix timestamp when the endpoint was created.
   */
  created_at: number;

  /**
   * The event types that trigger deliveries to this endpoint.
   */
  event_types: Array<string>;

  /**
   * The human-readable name of the endpoint.
   */
  name: string;

  /**
   * The object type, which is always webhook_endpoint.
   */
  object: 'webhook_endpoint';

  /**
   * The endpoint's signing secret. This is returned only when the endpoint is
   * created or the secret is rotated.
   */
  signing_secret: string;

  /**
   * A masked hint for the endpoint's signing secret.
   */
  signing_secret_hint: string | null;

  /**
   * The HTTPS URL that receives webhook deliveries.
   */
  url: string;

  /**
   * The Unix timestamp of the last endpoint configuration or signing-secret change.
   * Initialized at creation; tests and unchanged updates do not advance it.
   */
  updated_at?: number;
}

export interface WebhookEventTypeList {
  /**
   * The webhook event types available to the authenticated project.
   */
  data: Array<string>;

  /**
   * The object type, which is always list.
   */
  object: 'list';
}

export interface WebhookCreateParams {
  /**
   * The event types that trigger deliveries to this endpoint.
   */
  event_types: Array<
    | 'batch.completed'
    | 'batch.failed'
    | 'batch.expired'
    | 'batch.cancelled'
    | 'response.completed'
    | 'response.failed'
    | 'response.cancelled'
    | 'response.incomplete'
    | 'eval.run.succeeded'
    | 'eval.run.failed'
    | 'eval.run.canceled'
    | 'fine_tuning.job.succeeded'
    | 'fine_tuning.job.failed'
    | 'fine_tuning.job.cancelled'
    | 'realtime.call.incoming'
    | 'video.completed'
    | 'video.failed'
    | 'safety.alert.created'
  >;

  /**
   * A human-readable name for the webhook endpoint.
   */
  name: string;

  /**
   * The HTTPS URL that receives webhook deliveries.
   */
  url: string;
}

export interface WebhookUpdateParams {
  /**
   * The complete set of event types that should trigger deliveries.
   */
  event_types?: Array<
    | 'batch.completed'
    | 'batch.failed'
    | 'batch.expired'
    | 'batch.cancelled'
    | 'response.completed'
    | 'response.failed'
    | 'response.cancelled'
    | 'response.incomplete'
    | 'eval.run.succeeded'
    | 'eval.run.failed'
    | 'eval.run.canceled'
    | 'fine_tuning.job.succeeded'
    | 'fine_tuning.job.failed'
    | 'fine_tuning.job.cancelled'
    | 'realtime.call.incoming'
    | 'video.completed'
    | 'video.failed'
    | 'safety.alert.created'
  >;

  /**
   * A new human-readable name for the webhook endpoint.
   */
  name?: string;

  /**
   * A new HTTPS URL that receives webhook deliveries.
   */
  url?: string;
}

export interface WebhookListParams extends Omit<CursorPageParams, 'after'> {
  /**
   * ID of the last webhook endpoint from the previous page.
   */
  after?: string | null;
}

export interface WebhookRotateSecretParams {
  /**
   * Whether to keep the previous signing secret valid for 24 hours after rotation.
   * Defaults to false, which invalidates the previous secret immediately.
   */
  keep_old_secret_active_for_24_hours?: boolean;
}

export interface WebhookTestParams {
  /**
   * The event type to send as a sample delivery.
   */
  event_type:
    | 'batch.completed'
    | 'batch.failed'
    | 'batch.expired'
    | 'batch.cancelled'
    | 'response.completed'
    | 'response.failed'
    | 'response.cancelled'
    | 'response.incomplete'
    | 'eval.run.succeeded'
    | 'eval.run.failed'
    | 'eval.run.canceled'
    | 'fine_tuning.job.succeeded'
    | 'fine_tuning.job.failed'
    | 'fine_tuning.job.cancelled'
    | 'realtime.call.incoming'
    | 'video.completed'
    | 'video.failed'
    | 'safety.alert.created';
}

Webhooks.EventTypes = EventTypes;

export declare namespace Webhooks {
  export {
    type BatchCancelledWebhookEvent as BatchCancelledWebhookEvent,
    type BatchCompletedWebhookEvent as BatchCompletedWebhookEvent,
    type BatchExpiredWebhookEvent as BatchExpiredWebhookEvent,
    type BatchFailedWebhookEvent as BatchFailedWebhookEvent,
    type DeletedWebhookEndpoint as DeletedWebhookEndpoint,
    type EvalRunCanceledWebhookEvent as EvalRunCanceledWebhookEvent,
    type EvalRunFailedWebhookEvent as EvalRunFailedWebhookEvent,
    type EvalRunSucceededWebhookEvent as EvalRunSucceededWebhookEvent,
    type FineTuningJobCancelledWebhookEvent as FineTuningJobCancelledWebhookEvent,
    type FineTuningJobFailedWebhookEvent as FineTuningJobFailedWebhookEvent,
    type FineTuningJobSucceededWebhookEvent as FineTuningJobSucceededWebhookEvent,
    type LiveCallIncomingWebhookEvent as LiveCallIncomingWebhookEvent,
    type LiveTransportIncomingWebhookEvent as LiveTransportIncomingWebhookEvent,
    type RealtimeCallIncomingWebhookEvent as RealtimeCallIncomingWebhookEvent,
    type ResponseCancelledWebhookEvent as ResponseCancelledWebhookEvent,
    type ResponseCompletedWebhookEvent as ResponseCompletedWebhookEvent,
    type ResponseFailedWebhookEvent as ResponseFailedWebhookEvent,
    type ResponseIncompleteWebhookEvent as ResponseIncompleteWebhookEvent,
    type SafetyAlertCreatedWebhookEvent as SafetyAlertCreatedWebhookEvent,
    type SafetyDeactivationIssuedWebhookEvent as SafetyDeactivationIssuedWebhookEvent,
    type SafetyOrgAlertCreatedWebhookEvent as SafetyOrgAlertCreatedWebhookEvent,
    type SafetyWarningIssuedWebhookEvent as SafetyWarningIssuedWebhookEvent,
    type UnwrapWebhookEvent as UnwrapWebhookEvent,
    type WebhookEndpoint as WebhookEndpoint,
    type WebhookEndpointList as WebhookEndpointList,
    type WebhookEndpointTestResult as WebhookEndpointTestResult,
    type WebhookEndpointWithSecret as WebhookEndpointWithSecret,
    type WebhookEventTypeList as WebhookEventTypeList,
    type WebhookEndpointsPage as WebhookEndpointsPage,
    type WebhookCreateParams as WebhookCreateParams,
    type WebhookUpdateParams as WebhookUpdateParams,
    type WebhookListParams as WebhookListParams,
    type WebhookRotateSecretParams as WebhookRotateSecretParams,
    type WebhookTestParams as WebhookTestParams,
  };

  export { EventTypes as EventTypes };
}
