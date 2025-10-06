// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as SessionsAPI from './sessions';
import { SessionCreateParams, Sessions } from './sessions';
import * as ThreadsAPI from './threads';
import {
  ChatKitAttachment,
  ChatKitResponseOutputText,
  ChatKitThread,
  ChatKitThreadAssistantMessageItem,
  ChatKitThreadItemList,
  ChatKitThreadItemListDataPage,
  ChatKitThreadUserMessageItem,
  ChatKitThreadsPage,
  ChatKitWidgetItem,
  ChatSession,
  ChatSessionAutomaticThreadTitling,
  ChatSessionChatKitConfiguration,
  ChatSessionChatKitConfigurationParam,
  ChatSessionExpiresAfterParam,
  ChatSessionFileUpload,
  ChatSessionHistory,
  ChatSessionRateLimits,
  ChatSessionRateLimitsParam,
  ChatSessionStatus,
  ChatSessionWorkflowParam,
  ThreadDeleteResponse,
  ThreadListItemsParams,
  ThreadListParams,
  Threads,
} from './threads';
import { APIPromise } from '../../../core/api-promise';
import { type Uploadable } from '../../../core/uploads';
import { buildHeaders } from '../../../internal/headers';
import { RequestOptions } from '../../../internal/request-options';
import { maybeMultipartFormRequestOptions } from '../../../internal/uploads';

export class ChatKit extends APIResource {
  sessions: SessionsAPI.Sessions = new SessionsAPI.Sessions(this._client);
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this._client);

  /**
   * Upload a ChatKit file
   *
   * @example
   * ```ts
   * const response = await client.beta.chatkit.uploadFile({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  uploadFile(body: ChatKitUploadFileParams, options?: RequestOptions): APIPromise<ChatKitUploadFileResponse> {
    return this._client.post(
      '/chatkit/files',
      maybeMultipartFormRequestOptions(
        { body, ...options, headers: buildHeaders([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]) },
        this._client,
      ),
    );
  }
}

/**
 * Workflow metadata and state returned for the session.
 */
export interface ChatKitWorkflow {
  /**
   * Identifier of the workflow backing the session.
   */
  id: string;

  /**
   * State variable key-value pairs applied when invoking the workflow. Defaults to
   * null when no overrides were provided.
   */
  state_variables: { [key: string]: string | boolean | number } | null;

  /**
   * Tracing settings applied to the workflow.
   */
  tracing: ChatKitWorkflow.Tracing;

  /**
   * Specific workflow version used for the session. Defaults to null when using the
   * latest deployment.
   */
  version: string | null;
}

export namespace ChatKitWorkflow {
  /**
   * Tracing settings applied to the workflow.
   */
  export interface Tracing {
    /**
     * Indicates whether tracing is enabled.
     */
    enabled: boolean;
  }
}

/**
 * Metadata for a non-image file uploaded through ChatKit.
 */
export interface FilePart {
  /**
   * Unique identifier for the uploaded file.
   */
  id: string;

  /**
   * MIME type reported for the uploaded file. Defaults to null when unknown.
   */
  mime_type: string | null;

  /**
   * Original filename supplied by the uploader. Defaults to null when unnamed.
   */
  name: string | null;

  /**
   * Type discriminator that is always `file`.
   */
  type: 'file';

  /**
   * Signed URL for downloading the uploaded file. Defaults to null when no download
   * link is available.
   */
  upload_url: string | null;
}

/**
 * Metadata for an image uploaded through ChatKit.
 */
export interface ImagePart {
  /**
   * Unique identifier for the uploaded image.
   */
  id: string;

  /**
   * MIME type of the uploaded image.
   */
  mime_type: string;

  /**
   * Original filename for the uploaded image. Defaults to null when unnamed.
   */
  name: string | null;

  /**
   * Preview URL that can be rendered inline for the image.
   */
  preview_url: string;

  /**
   * Type discriminator that is always `image`.
   */
  type: 'image';

  /**
   * Signed URL for downloading the uploaded image. Defaults to null when no download
   * link is available.
   */
  upload_url: string | null;
}

/**
 * Represents either a file or image attachment.
 */
export type ChatKitUploadFileResponse = FilePart | ImagePart;

export interface ChatKitUploadFileParams {
  /**
   * Binary file contents to store with the ChatKit session. Supports PDFs and PNG,
   * JPG, JPEG, GIF, or WEBP images.
   */
  file: Uploadable;
}

ChatKit.Sessions = Sessions;
ChatKit.Threads = Threads;

export declare namespace ChatKit {
  export {
    type ChatKitWorkflow as ChatKitWorkflow,
    type FilePart as FilePart,
    type ImagePart as ImagePart,
    type ChatKitUploadFileResponse as ChatKitUploadFileResponse,
    type ChatKitUploadFileParams as ChatKitUploadFileParams,
  };

  export { Sessions as Sessions, type SessionCreateParams as SessionCreateParams };

  export {
    Threads as Threads,
    type ChatSession as ChatSession,
    type ChatSessionAutomaticThreadTitling as ChatSessionAutomaticThreadTitling,
    type ChatSessionChatKitConfiguration as ChatSessionChatKitConfiguration,
    type ChatSessionChatKitConfigurationParam as ChatSessionChatKitConfigurationParam,
    type ChatSessionExpiresAfterParam as ChatSessionExpiresAfterParam,
    type ChatSessionFileUpload as ChatSessionFileUpload,
    type ChatSessionHistory as ChatSessionHistory,
    type ChatSessionRateLimits as ChatSessionRateLimits,
    type ChatSessionRateLimitsParam as ChatSessionRateLimitsParam,
    type ChatSessionStatus as ChatSessionStatus,
    type ChatSessionWorkflowParam as ChatSessionWorkflowParam,
    type ChatKitAttachment as ChatKitAttachment,
    type ChatKitResponseOutputText as ChatKitResponseOutputText,
    type ChatKitThread as ChatKitThread,
    type ChatKitThreadAssistantMessageItem as ChatKitThreadAssistantMessageItem,
    type ChatKitThreadItemList as ChatKitThreadItemList,
    type ChatKitThreadUserMessageItem as ChatKitThreadUserMessageItem,
    type ChatKitWidgetItem as ChatKitWidgetItem,
    type ThreadDeleteResponse as ThreadDeleteResponse,
    type ChatKitThreadsPage as ChatKitThreadsPage,
    type ChatKitThreadItemListDataPage as ChatKitThreadItemListDataPage,
    type ThreadListParams as ThreadListParams,
    type ThreadListItemsParams as ThreadListItemsParams,
  };
}
