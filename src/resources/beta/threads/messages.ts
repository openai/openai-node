// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import { isRequestOptions } from '../../../core';
import * as Core from '../../../core';
import * as Shared from '../../shared';
import * as AssistantsAPI from '../assistants';
import { CursorPage, type CursorPageParams } from '../../../pagination';

export class Messages extends APIResource {
  /**
   * Create a message.
   */
  create(
    threadId: string,
    body: MessageCreateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Message> {
    return this._client.post(`/threads/${threadId}/messages`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Retrieve a message.
   */
  retrieve(threadId: string, messageId: string, options?: Core.RequestOptions): Core.APIPromise<Message> {
    return this._client.get(`/threads/${threadId}/messages/${messageId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Modifies a message.
   */
  update(
    threadId: string,
    messageId: string,
    body: MessageUpdateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Message> {
    return this._client.post(`/threads/${threadId}/messages/${messageId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Returns a list of messages for a given thread.
   */
  list(
    threadId: string,
    query?: MessageListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<MessagesPage, Message>;
  list(threadId: string, options?: Core.RequestOptions): Core.PagePromise<MessagesPage, Message>;
  list(
    threadId: string,
    query: MessageListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<MessagesPage, Message> {
    if (isRequestOptions(query)) {
      return this.list(threadId, {}, query);
    }
    return this._client.getAPIList(`/threads/${threadId}/messages`, MessagesPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Deletes a message.
   */
  del(threadId: string, messageId: string, options?: Core.RequestOptions): Core.APIPromise<MessageDeleted> {
    return this._client.delete(`/threads/${threadId}/messages/${messageId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }
}

export class MessagesPage extends CursorPage<Message> {}

/**
 * A citation within the message that points to a specific quote from a specific
 * File associated with the assistant or the message. Generated when the assistant
 * uses the "file_search" tool to search files.
 */
export type Annotation = FileCitationAnnotation | FilePathAnnotation;

/**
 * A citation within the message that points to a specific quote from a specific
 * File associated with the assistant or the message. Generated when the assistant
 * uses the "file_search" tool to search files.
 */
export type AnnotationDelta = FileCitationDeltaAnnotation | FilePathDeltaAnnotation;

/**
 * A citation within the message that points to a specific quote from a specific
 * File associated with the assistant or the message. Generated when the assistant
 * uses the "file_search" tool to search files.
 */
export interface FileCitationAnnotation {
  end_index: number;

  file_citation: FileCitationAnnotation.FileCitation;

  start_index: number;

  /**
   * The text in the message content that needs to be replaced.
   */
  text: string;

  /**
   * Always `file_citation`.
   */
  type: 'file_citation';
}

export namespace FileCitationAnnotation {
  export interface FileCitation {
    /**
     * The ID of the specific File the citation is from.
     */
    file_id: string;
  }
}

/**
 * A citation within the message that points to a specific quote from a specific
 * File associated with the assistant or the message. Generated when the assistant
 * uses the "file_search" tool to search files.
 */
export interface FileCitationDeltaAnnotation {
  /**
   * The index of the annotation in the text content part.
   */
  index: number;

  /**
   * Always `file_citation`.
   */
  type: 'file_citation';

  end_index?: number;

  file_citation?: FileCitationDeltaAnnotation.FileCitation;

  start_index?: number;

  /**
   * The text in the message content that needs to be replaced.
   */
  text?: string;
}

export namespace FileCitationDeltaAnnotation {
  export interface FileCitation {
    /**
     * The ID of the specific File the citation is from.
     */
    file_id?: string;

    /**
     * The specific quote in the file.
     */
    quote?: string;
  }
}

/**
 * A URL for the file that's generated when the assistant used the
 * `code_interpreter` tool to generate a file.
 */
export interface FilePathAnnotation {
  end_index: number;

  file_path: FilePathAnnotation.FilePath;

  start_index: number;

  /**
   * The text in the message content that needs to be replaced.
   */
  text: string;

  /**
   * Always `file_path`.
   */
  type: 'file_path';
}

export namespace FilePathAnnotation {
  export interface FilePath {
    /**
     * The ID of the file that was generated.
     */
    file_id: string;
  }
}

/**
 * A URL for the file that's generated when the assistant used the
 * `code_interpreter` tool to generate a file.
 */
export interface FilePathDeltaAnnotation {
  /**
   * The index of the annotation in the text content part.
   */
  index: number;

  /**
   * Always `file_path`.
   */
  type: 'file_path';

  end_index?: number;

  file_path?: FilePathDeltaAnnotation.FilePath;

  start_index?: number;

  /**
   * The text in the message content that needs to be replaced.
   */
  text?: string;
}

export namespace FilePathDeltaAnnotation {
  export interface FilePath {
    /**
     * The ID of the file that was generated.
     */
    file_id?: string;
  }
}

export interface ImageFile {
  /**
   * The [File](https://platform.openai.com/docs/api-reference/files) ID of the image
   * in the message content. Set `purpose="vision"` when uploading the File if you
   * need to later display the file content.
   */
  file_id: string;

  /**
   * Specifies the detail level of the image if specified by the user. `low` uses
   * fewer tokens, you can opt in to high resolution using `high`.
   */
  detail?: 'auto' | 'low' | 'high';
}

/**
 * References an image [File](https://platform.openai.com/docs/api-reference/files)
 * in the content of a message.
 */
export interface ImageFileContentBlock {
  image_file: ImageFile;

  /**
   * Always `image_file`.
   */
  type: 'image_file';
}

export interface ImageFileDelta {
  /**
   * Specifies the detail level of the image if specified by the user. `low` uses
   * fewer tokens, you can opt in to high resolution using `high`.
   */
  detail?: 'auto' | 'low' | 'high';

  /**
   * The [File](https://platform.openai.com/docs/api-reference/files) ID of the image
   * in the message content. Set `purpose="vision"` when uploading the File if you
   * need to later display the file content.
   */
  file_id?: string;
}

/**
 * References an image [File](https://platform.openai.com/docs/api-reference/files)
 * in the content of a message.
 */
export interface ImageFileDeltaBlock {
  /**
   * The index of the content part in the message.
   */
  index: number;

  /**
   * Always `image_file`.
   */
  type: 'image_file';

  image_file?: ImageFileDelta;
}

export interface ImageURL {
  /**
   * The external URL of the image, must be a supported image types: jpeg, jpg, png,
   * gif, webp.
   */
  url: string;

  /**
   * Specifies the detail level of the image. `low` uses fewer tokens, you can opt in
   * to high resolution using `high`. Default value is `auto`
   */
  detail?: 'auto' | 'low' | 'high';
}

/**
 * References an image URL in the content of a message.
 */
export interface ImageURLContentBlock {
  image_url: ImageURL;

  /**
   * The type of the content part.
   */
  type: 'image_url';
}

export interface ImageURLDelta {
  /**
   * Specifies the detail level of the image. `low` uses fewer tokens, you can opt in
   * to high resolution using `high`.
   */
  detail?: 'auto' | 'low' | 'high';

  /**
   * The URL of the image, must be a supported image types: jpeg, jpg, png, gif,
   * webp.
   */
  url?: string;
}

/**
 * References an image URL in the content of a message.
 */
export interface ImageURLDeltaBlock {
  /**
   * The index of the content part in the message.
   */
  index: number;

  /**
   * Always `image_url`.
   */
  type: 'image_url';

  image_url?: ImageURLDelta;
}

/**
 * Represents a message within a
 * [thread](https://platform.openai.com/docs/api-reference/threads).
 */
export interface Message {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * If applicable, the ID of the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) that
   * authored this message.
   */
  assistant_id: string | null;

  /**
   * A list of files attached to the message, and the tools they were added to.
   */
  attachments: Array<Message.Attachment> | null;

  /**
   * The Unix timestamp (in seconds) for when the message was completed.
   */
  completed_at: number | null;

  /**
   * The content of the message in array of text and/or images.
   */
  content: Array<MessageContent>;

  /**
   * The Unix timestamp (in seconds) for when the message was created.
   */
  created_at: number;

  /**
   * The Unix timestamp (in seconds) for when the message was marked as incomplete.
   */
  incomplete_at: number | null;

  /**
   * On an incomplete message, details about why the message is incomplete.
   */
  incomplete_details: Message.IncompleteDetails | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata: Shared.Metadata | null;

  /**
   * The object type, which is always `thread.message`.
   */
  object: 'thread.message';

  /**
   * The entity that produced the message. One of `user` or `assistant`.
   */
  role: 'user' | 'assistant';

  /**
   * The ID of the [run](https://platform.openai.com/docs/api-reference/runs)
   * associated with the creation of this message. Value is `null` when messages are
   * created manually using the create message or create thread endpoints.
   */
  run_id: string | null;

  /**
   * The status of the message, which can be either `in_progress`, `incomplete`, or
   * `completed`.
   */
  status: 'in_progress' | 'incomplete' | 'completed';

  /**
   * The [thread](https://platform.openai.com/docs/api-reference/threads) ID that
   * this message belongs to.
   */
  thread_id: string;
}

export namespace Message {
  export interface Attachment {
    /**
     * The ID of the file to attach to the message.
     */
    file_id?: string;

    /**
     * The tools to add this file to.
     */
    tools?: Array<AssistantsAPI.CodeInterpreterTool | Attachment.AssistantToolsFileSearchTypeOnly>;
  }

  export namespace Attachment {
    export interface AssistantToolsFileSearchTypeOnly {
      /**
       * The type of tool being defined: `file_search`
       */
      type: 'file_search';
    }
  }

  /**
   * On an incomplete message, details about why the message is incomplete.
   */
  export interface IncompleteDetails {
    /**
     * The reason the message is incomplete.
     */
    reason: 'content_filter' | 'max_tokens' | 'run_cancelled' | 'run_expired' | 'run_failed';
  }
}

/**
 * References an image [File](https://platform.openai.com/docs/api-reference/files)
 * in the content of a message.
 */
export type MessageContent =
  | ImageFileContentBlock
  | ImageURLContentBlock
  | TextContentBlock
  | RefusalContentBlock;

/**
 * References an image [File](https://platform.openai.com/docs/api-reference/files)
 * in the content of a message.
 */
export type MessageContentDelta =
  | ImageFileDeltaBlock
  | TextDeltaBlock
  | RefusalDeltaBlock
  | ImageURLDeltaBlock;

/**
 * References an image [File](https://platform.openai.com/docs/api-reference/files)
 * in the content of a message.
 */
export type MessageContentPartParam = ImageFileContentBlock | ImageURLContentBlock | TextContentBlockParam;

export interface MessageDeleted {
  id: string;

  deleted: boolean;

  object: 'thread.message.deleted';
}

/**
 * The delta containing the fields that have changed on the Message.
 */
export interface MessageDelta {
  /**
   * The content of the message in array of text and/or images.
   */
  content?: Array<MessageContentDelta>;

  /**
   * The entity that produced the message. One of `user` or `assistant`.
   */
  role?: 'user' | 'assistant';
}

/**
 * Represents a message delta i.e. any changed fields on a message during
 * streaming.
 */
export interface MessageDeltaEvent {
  /**
   * The identifier of the message, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The delta containing the fields that have changed on the Message.
   */
  delta: MessageDelta;

  /**
   * The object type, which is always `thread.message.delta`.
   */
  object: 'thread.message.delta';
}

/**
 * The refusal content generated by the assistant.
 */
export interface RefusalContentBlock {
  refusal: string;

  /**
   * Always `refusal`.
   */
  type: 'refusal';
}

/**
 * The refusal content that is part of a message.
 */
export interface RefusalDeltaBlock {
  /**
   * The index of the refusal part in the message.
   */
  index: number;

  /**
   * Always `refusal`.
   */
  type: 'refusal';

  refusal?: string;
}

export interface Text {
  annotations: Array<Annotation>;

  /**
   * The data that makes up the text.
   */
  value: string;
}

/**
 * The text content that is part of a message.
 */
export interface TextContentBlock {
  text: Text;

  /**
   * Always `text`.
   */
  type: 'text';
}

/**
 * The text content that is part of a message.
 */
export interface TextContentBlockParam {
  /**
   * Text content to be sent to the model
   */
  text: string;

  /**
   * Always `text`.
   */
  type: 'text';
}

export interface TextDelta {
  annotations?: Array<AnnotationDelta>;

  /**
   * The data that makes up the text.
   */
  value?: string;
}

/**
 * The text content that is part of a message.
 */
export interface TextDeltaBlock {
  /**
   * The index of the content part in the message.
   */
  index: number;

  /**
   * Always `text`.
   */
  type: 'text';

  text?: TextDelta;
}

export interface MessageCreateParams {
  /**
   * The text contents of the message.
   */
  content: string | Array<MessageContentPartParam>;

  /**
   * The role of the entity that is creating the message. Allowed values include:
   *
   * - `user`: Indicates the message is sent by an actual user and should be used in
   *   most cases to represent user-generated messages.
   * - `assistant`: Indicates the message is generated by the assistant. Use this
   *   value to insert messages from the assistant into the conversation.
   */
  role: 'user' | 'assistant';

  /**
   * A list of files attached to the message, and the tools they should be added to.
   */
  attachments?: Array<MessageCreateParams.Attachment> | null;

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

export namespace MessageCreateParams {
  export interface Attachment {
    /**
     * The ID of the file to attach to the message.
     */
    file_id?: string;

    /**
     * The tools to add this file to.
     */
    tools?: Array<AssistantsAPI.CodeInterpreterTool | Attachment.FileSearch>;
  }

  export namespace Attachment {
    export interface FileSearch {
      /**
       * The type of tool being defined: `file_search`
       */
      type: 'file_search';
    }
  }
}

export interface MessageUpdateParams {
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

export interface MessageListParams extends CursorPageParams {
  /**
   * A cursor for use in pagination. `before` is an object ID that defines your place
   * in the list. For instance, if you make a list request and receive 100 objects,
   * starting with obj_foo, your subsequent call can include before=obj_foo in order
   * to fetch the previous page of the list.
   */
  before?: string;

  /**
   * Sort order by the `created_at` timestamp of the objects. `asc` for ascending
   * order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * Filter messages by the run ID that generated them.
   */
  run_id?: string;
}

Messages.MessagesPage = MessagesPage;

export declare namespace Messages {
  export {
    type Annotation as Annotation,
    type AnnotationDelta as AnnotationDelta,
    type FileCitationAnnotation as FileCitationAnnotation,
    type FileCitationDeltaAnnotation as FileCitationDeltaAnnotation,
    type FilePathAnnotation as FilePathAnnotation,
    type FilePathDeltaAnnotation as FilePathDeltaAnnotation,
    type ImageFile as ImageFile,
    type ImageFileContentBlock as ImageFileContentBlock,
    type ImageFileDelta as ImageFileDelta,
    type ImageFileDeltaBlock as ImageFileDeltaBlock,
    type ImageURL as ImageURL,
    type ImageURLContentBlock as ImageURLContentBlock,
    type ImageURLDelta as ImageURLDelta,
    type ImageURLDeltaBlock as ImageURLDeltaBlock,
    type Message as Message,
    type MessageContent as MessageContent,
    type MessageContentDelta as MessageContentDelta,
    type MessageContentPartParam as MessageContentPartParam,
    type MessageDeleted as MessageDeleted,
    type MessageDelta as MessageDelta,
    type MessageDeltaEvent as MessageDeltaEvent,
    type RefusalContentBlock as RefusalContentBlock,
    type RefusalDeltaBlock as RefusalDeltaBlock,
    type Text as Text,
    type TextContentBlock as TextContentBlock,
    type TextContentBlockParam as TextContentBlockParam,
    type TextDelta as TextDelta,
    type TextDeltaBlock as TextDeltaBlock,
    MessagesPage as MessagesPage,
    type MessageCreateParams as MessageCreateParams,
    type MessageUpdateParams as MessageUpdateParams,
    type MessageListParams as MessageListParams,
  };
}
