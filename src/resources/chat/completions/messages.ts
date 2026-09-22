// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as CompletionsAPI from './completions';
import { ChatCompletionStoreMessagesPage } from './completions';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

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
 * Given a list of messages comprising a conversation, the model will return a response.
 */
export class Messages extends APIResource {
  /**
   * Get the messages in a stored chat completion. Only Chat Completions that have
   * been created with the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletionStoreMessage of client.chat.completions.messages.list(
   *   'completion_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    completionID: string,
    query?:
      | (MessageListParams &
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
  ): PagePromise<ChatCompletionStoreMessagesPage, CompletionsAPI.ChatCompletionStoreMessage>;
  list(
    completionID: string,
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
  ): PagePromise<ChatCompletionStoreMessagesPage, CompletionsAPI.ChatCompletionStoreMessage>;
  list(
    completionID: string,
    query:
      | MessageListParams
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
  ): PagePromise<ChatCompletionStoreMessagesPage, CompletionsAPI.ChatCompletionStoreMessage> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as MessageListParams | null | undefined;
    return this._client.getAPIList(
      path`/chat/completions/${completionID}/messages`,
      CursorPage<CompletionsAPI.ChatCompletionStoreMessage>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { bearerAuth: true },
      })),
    );
  }
}

export interface MessageListParams extends CursorPageParams {
  /**
   * Sort order for messages by timestamp. Use `asc` for ascending order or `desc`
   * for descending order. Defaults to `asc`.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Messages {
  export { type MessageListParams as MessageListParams };
}

export { type ChatCompletionStoreMessagesPage };
