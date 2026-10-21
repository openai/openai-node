// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { APIPromise } from '../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../core/pagination';
import { type Uploadable } from '../../core/uploads';
import { RequestOptions } from '../../internal/request-options';
import { multipartFormRequestOptions } from '../../internal/uploads';
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

/**
 * Turn audio into text or text into audio.
 */
export class VoiceConsents extends APIResource {
  /**
   * Upload a voice consent recording.
   *
   * @example
   * ```ts
   * const voiceConsent =
   *   await client.audio.voiceConsents.create({
   *     language: 'language',
   *     name: 'name',
   *     recording: fs.createReadStream('path/to/file'),
   *   });
   * ```
   */
  create(body: VoiceConsentCreateParams, options?: RequestOptions): APIPromise<VoiceConsent> {
    return this._client.post(
      '/audio/voice_consents',
      resolveResourceRequestOptions(options, (options) =>
        multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client),
      ),
    );
  }

  /**
   * Retrieves a voice consent recording.
   *
   * @example
   * ```ts
   * const voiceConsent =
   *   await client.audio.voiceConsents.retrieve('consent_id');
   * ```
   */
  retrieve(consentID: string, options?: RequestOptions): APIPromise<VoiceConsent> {
    return this._client.get(
      path`/audio/voice_consents/${consentID}`,
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }

  /**
   * Updates a voice consent recording (metadata only).
   *
   * @example
   * ```ts
   * const voiceConsent =
   *   await client.audio.voiceConsents.update(
   *     'consent_id',
   *     { name: 'name' },
   *   );
   * ```
   */
  update(
    consentID: string,
    body: VoiceConsentUpdateParams,
    options?: RequestOptions,
  ): APIPromise<VoiceConsent> {
    return this._client.post(
      path`/audio/voice_consents/${consentID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Returns a list of voice consent recordings.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const voiceConsent of client.audio.voiceConsents.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (VoiceConsentListParams &
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
  ): PagePromise<VoiceConsentsPage, VoiceConsent>;
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
  ): PagePromise<VoiceConsentsPage, VoiceConsent>;
  list(
    query:
      | VoiceConsentListParams
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
  ): PagePromise<VoiceConsentsPage, VoiceConsent> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as VoiceConsentListParams | null | undefined;
    return this._client.getAPIList(
      '/audio/voice_consents',
      CursorPage<VoiceConsent>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Deletes a voice consent recording.
   *
   * @example
   * ```ts
   * const voiceConsentDeleted =
   *   await client.audio.voiceConsents.delete('consent_id');
   * ```
   */
  delete(consentID: string, options?: RequestOptions): APIPromise<VoiceConsentDeleted> {
    return this._client.delete(
      path`/audio/voice_consents/${consentID}`,
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }
}

export type VoiceConsentsPage = CursorPage<VoiceConsent>;

/**
 * A consent recording used to authorize creation of a custom voice.
 */
export interface VoiceConsent {
  /**
   * The consent recording identifier.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the consent recording was created.
   */
  created_at: number;

  /**
   * The BCP 47 language tag for the consent phrase (for example, `en-US`).
   */
  language: string;

  /**
   * The label provided when the consent recording was uploaded.
   */
  name: string;

  /**
   * The object type, which is always `audio.voice_consent`.
   */
  object: 'audio.voice_consent';
}

export interface VoiceConsentDeleted {
  /**
   * The consent recording identifier.
   */
  id: string;

  deleted: boolean;

  object: 'audio.voice_consent';
}

export interface VoiceConsentCreateParams {
  /**
   * The BCP 47 language tag for the consent phrase (for example, `en-US`).
   */
  language: string;

  /**
   * The label to use for this consent recording.
   */
  name: string;

  /**
   * The consent audio recording file. Maximum size is 10 MiB.
   *
   * Supported MIME types: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/ogg`,
   * `audio/aac`, `audio/flac`, `audio/webm`, `audio/mp4`.
   */
  recording: Uploadable;
}

export interface VoiceConsentUpdateParams {
  /**
   * The updated label for this consent recording.
   */
  name: string;
}

export interface VoiceConsentListParams extends CursorPageParams {}

export declare namespace VoiceConsents {
  export {
    type VoiceConsent as VoiceConsent,
    type VoiceConsentDeleted as VoiceConsentDeleted,
    type VoiceConsentsPage as VoiceConsentsPage,
    type VoiceConsentCreateParams as VoiceConsentCreateParams,
    type VoiceConsentUpdateParams as VoiceConsentUpdateParams,
    type VoiceConsentListParams as VoiceConsentListParams,
  };
}
