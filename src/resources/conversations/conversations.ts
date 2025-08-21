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
   * Create a conversation with the given ID.
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

export interface ContainerFileCitationBody {
  /**
   * The ID of the container file.
   */
  container_id: string;

  /**
   * The index of the last character of the container file citation in the message.
   */
  end_index: number;

  /**
   * The ID of the file.
   */
  file_id: string;

  /**
   * The filename of the container file cited.
   */
  filename: string;

  /**
   * The index of the first character of the container file citation in the message.
   */
  start_index: number;

  /**
   * The type of the container file citation. Always `container_file_citation`.
   */
  type: 'container_file_citation';
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

export interface FileCitationBody {
  /**
   * The ID of the file.
   */
  file_id: string;

  /**
   * The filename of the file cited.
   */
  filename: string;

  /**
   * The index of the file in the list of files.
   */
  index: number;

  /**
   * The type of the file citation. Always `file_citation`.
   */
  type: 'file_citation';
}

export interface InputFileContent {
  /**
   * The ID of the file to be sent to the model.
   */
  file_id: string | null;

  /**
   * The type of the input item. Always `input_file`.
   */
  type: 'input_file';

  /**
   * The URL of the file to be sent to the model.
   */
  file_url?: string;

  /**
   * The name of the file to be sent to the model.
   */
  filename?: string;
}

export interface InputImageContent {
  /**
   * The detail level of the image to be sent to the model. One of `high`, `low`, or
   * `auto`. Defaults to `auto`.
   */
  detail: 'low' | 'high' | 'auto';

  /**
   * The ID of the file to be sent to the model.
   */
  file_id: string | null;

  /**
   * The URL of the image to be sent to the model. A fully qualified URL or base64
   * encoded image in a data URL.
   */
  image_url: string | null;

  /**
   * The type of the input item. Always `input_image`.
   */
  type: 'input_image';
}

export interface InputTextContent {
  /**
   * The text input to the model.
   */
  text: string;

  /**
   * The type of the input item. Always `input_text`.
   */
  type: 'input_text';
}

export interface LobProb {
  token: string;

  bytes: Array<number>;

  logprob: number;

  top_logprobs: Array<TopLogProb>;
}

export interface Message {
  /**
   * The unique ID of the message.
   */
  id: string;

  /**
   * The content of the message
   */
  content: Array<
    | InputTextContent
    | OutputTextContent
    | TextContent
    | SummaryTextContent
    | RefusalContent
    | InputImageContent
    | ComputerScreenshotContent
    | InputFileContent
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

export interface OutputTextContent {
  /**
   * The annotations of the text output.
   */
  annotations: Array<FileCitationBody | URLCitationBody | ContainerFileCitationBody>;

  /**
   * The text output from the model.
   */
  text: string;

  /**
   * The type of the output text. Always `output_text`.
   */
  type: 'output_text';

  logprobs?: Array<LobProb>;
}

export interface RefusalContent {
  /**
   * The refusal explanation from the model.
   */
  refusal: string;

  /**
   * The type of the refusal. Always `refusal`.
   */
  type: 'refusal';
}

export interface SummaryTextContent {
  text: string;

  type: 'summary_text';
}

export interface TextContent {
  text: string;

  type: 'text';
}

export interface TopLogProb {
  token: string;

  bytes: Array<number>;

  logprob: number;
}

export interface URLCitationBody {
  /**
   * The index of the last character of the URL citation in the message.
   */
  end_index: number;

  /**
   * The index of the first character of the URL citation in the message.
   */
  start_index: number;

  /**
   * The title of the web resource.
   */
  title: string;

  /**
   * The type of the URL citation. Always `url_citation`.
   */
  type: 'url_citation';

  /**
   * The URL of the web resource.
   */
  url: string;
}

export interface ConversationCreateParams {
  /**
   * Initial items to include in the conversation context. You may add up to 20 items
   * at a time.
   */
  items?: Array<ResponsesAPI.ResponseInputItem> | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. Useful for storing
   * additional information about the object in a structured format.
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
    type ContainerFileCitationBody as ContainerFileCitationBody,
    type Conversation as Conversation,
    type ConversationDeleted as ConversationDeleted,
    type ConversationDeletedResource as ConversationDeletedResource,
    type FileCitationBody as FileCitationBody,
    type InputFileContent as InputFileContent,
    type InputImageContent as InputImageContent,
    type InputTextContent as InputTextContent,
    type LobProb as LobProb,
    type Message as Message,
    type OutputTextContent as OutputTextContent,
    type RefusalContent as RefusalContent,
    type SummaryTextContent as SummaryTextContent,
    type TextContent as TextContent,
    type TopLogProb as TopLogProb,
    type URLCitationBody as URLCitationBody,
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
