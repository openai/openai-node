// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import * as CompletionsAPI from './completions';
import { ChatCompletionStoreMessagesPage } from './completions';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Messages extends APIResource {
  /**
   * Get the messages in a stored chat completion. Only chat completions that have
   * been created with the `store` parameter set to `true` will be returned.
   */
  list(
    completionID: string,
    query: MessageListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ChatCompletionStoreMessagesPage, CompletionsAPI.ChatCompletionStoreMessage> {
    return this._client.getAPIList(
      path`/chat/completions/${completionID}/messages`,
      CursorPage<CompletionsAPI.ChatCompletionStoreMessage>,
      { query, ...options },
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
