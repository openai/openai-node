// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as Shared from '../shared';
import * as ItemsAPI from './items';
import {
  ConversationItem,
  ConversationItemList,
  ConversationItemsPage,
  ItemCreateParams,
  ItemDeleteParams,
  ItemListParams,
  ItemRetrieveParams,
  Items,
} from './items';
import * as ResponsesAPI from '../responses/responses';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class Conversations extends APIResource {
  items: ItemsAPI.Items = new ItemsAPI.Items(this._client);

  /**
   * Create a conversation.
   */
  create(body: ConversationCreateParams, options?: RequestOptions): APIPromise<Conversation> {
    return this._client.post('/conversations', { body, ...options });
  }

  /**
   * Get a conversation with the given ID.
   */
  retrieve(conversationID: string, options?: RequestOptions): APIPromise<Conversation> {
    return this._client.get(path`/conversations/${conversationID}`, options);
  }

  /**
   * Update a conversation's metadata with the given ID.
   */
  update(
    conversationID: string,
    body: ConversationUpdateParams,
    options?: RequestOptions,
  ): APIPromise<Conversation> {
    return this._client.post(path`/conversations/${conversationID}`, { body, ...options });
  }

  /**
   * Delete a conversation with the given ID.
   */
  delete(conversationID: string, options?: RequestOptions): APIPromise<ConversationDeletedResource> {
    return this._client.delete(path`/conversations/${conversationID}`, options);
  }
}

/**
 * A screenshot of a computer.
 */
export interface ComputerScreenshotContent {
  /**
   * The identifier of an uploaded file that contains the screenshot.
   */
  file_id: string | null;

  /**
   * The URL of the screenshot image.
   */
  image_url: string | null;

  /**
   * Specifies the event type. For a computer screenshot, this property is always set
   * to `computer_screenshot`.
   */
  type: 'computer_screenshot';
}

export interface Conversation {
  /**
   * The unique ID of the conversation.
   */
  id: string;

  /**
   * The time at which the conversation was created, measured in seconds since the
   * Unix epoch.
   */
  created_at: number;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard. Keys are strings with a maximum
   * length of 64 characters. Values are strings with a maximum length of 512
   * characters.
   */
  metadata: unknown;

  /**
   * The object type, which is always `conversation`.
   */
  object: 'conversation';
}

export interface ConversationDeleted {
  id: string;

  deleted: boolean;

  object: 'conversation.deleted';
}

export interface ConversationDeletedResource {
  id: string;

  deleted: boolean;

  object: 'conversation.deleted';
}

/**
 * A message to or from the model.
 */
export interface Message {
  /**
   * The unique ID of the message.
   */
  id: string;

  /**
   * The content of the message
   */
  content: Array<
    | ResponsesAPI.ResponseInputText
    | ResponsesAPI.ResponseOutputText
    | TextContent
    | SummaryTextContent
    | ResponsesAPI.ResponseOutputRefusal
    | ResponsesAPI.ResponseInputImage
    | ComputerScreenshotContent
    | ResponsesAPI.ResponseInputFile
  >;

  /**
   * The role of the message. One of `unknown`, `user`, `assistant`, `system`,
   * `critic`, `discriminator`, `developer`, or `tool`.
   */
  role: 'unknown' | 'user' | 'assistant' | 'system' | 'critic' | 'discriminator' | 'developer' | 'tool';

  /**
   * The status of item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status: 'in_progress' | 'completed' | 'incomplete';

  /**
   * The type of the message. Always set to `message`.
   */
  type: 'message';
}

/**
 * A summary text from the model.
 */
export interface SummaryTextContent {
  text: string;

  type: 'summary_text';
}

/**
 * A text content.
 */
export interface TextContent {
  text: string;

  type: 'text';
}

export type InputTextContent = ResponsesAPI.ResponseInputText;

export type OutputTextContent = ResponsesAPI.ResponseOutputText;

export type RefusalContent = ResponsesAPI.ResponseOutputRefusal;

export type InputImageContent = ResponsesAPI.ResponseInputImage;

export type InputFileContent = ResponsesAPI.ResponseInputFile;

export interface ConversationCreateParams {
  /**
   * Initial items to include in the conversation context. You may add up to 20 items
   * at a time.
   */
  items?: Array<ResponsesAPI.ResponseInputItem> | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata?: Shared.Metadata | null;
}

export interface ConversationUpdateParams {
  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard. Keys are strings with a maximum
   * length of 64 characters. Values are strings with a maximum length of 512
   * characters.
   */
  metadata: { [key: string]: string };
}

Conversations.Items = Items;

export declare namespace Conversations {
  export {
    type ComputerScreenshotContent as ComputerScreenshotContent,
    type Conversation as Conversation,
    type ConversationDeleted as ConversationDeleted,
    type ConversationDeletedResource as ConversationDeletedResource,
    type Message as Message,
    type SummaryTextContent as SummaryTextContent,
    type TextContent as TextContent,
    type InputTextContent as InputTextContent,
    type OutputTextContent as OutputTextContent,
    type RefusalContent as RefusalContent,
    type InputImageContent as InputImageContent,
    type InputFileContent as InputFileContent,
    type ConversationCreateParams as ConversationCreateParams,
    type ConversationUpdateParams as ConversationUpdateParams,
  };

  export {
    Items as Items,
    type ConversationItem as ConversationItem,
    type ConversationItemList as ConversationItemList,
    type ConversationItemsPage as ConversationItemsPage,
    type ItemCreateParams as ItemCreateParams,
    type ItemRetrieveParams as ItemRetrieveParams,
    type ItemListParams as ItemListParams,
    type ItemDeleteParams as ItemDeleteParams,
  };
}
