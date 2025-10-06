// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as AssistantsAPI from './assistants';
import {
  Assistant,
  AssistantCreateParams,
  AssistantDeleted,
  AssistantListParams,
  AssistantStreamEvent,
  AssistantTool,
  AssistantUpdateParams,
  Assistants,
  AssistantsPage,
  CodeInterpreterTool,
  FileSearchTool,
  FunctionTool,
  MessageStreamEvent,
  RunStepStreamEvent,
  RunStreamEvent,
  ThreadStreamEvent,
} from './assistants';
import * as ChatKitAPI from './chatkit/chatkit';
import {
  ChatKit,
  ChatKitUploadFileParams,
  ChatKitUploadFileResponse,
  ChatKitWorkflow,
  FilePart,
  ImagePart,
} from './chatkit/chatkit';
import * as ThreadsAPI from './threads/threads';
import {
  AssistantResponseFormatOption,
  AssistantToolChoice,
  AssistantToolChoiceFunction,
  AssistantToolChoiceOption,
  Thread,
  ThreadCreateAndRunParams,
  ThreadCreateAndRunParamsNonStreaming,
  ThreadCreateAndRunParamsStreaming,
  ThreadCreateParams,
  ThreadDeleted,
  ThreadUpdateParams,
  Threads,
} from './threads/threads';

export class Beta extends APIResource {
  chatkit: ChatKitAPI.ChatKit = new ChatKitAPI.ChatKit(this._client);
  assistants: AssistantsAPI.Assistants = new AssistantsAPI.Assistants(this._client);
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this._client);
}

Beta.ChatKit = ChatKit;
Beta.Assistants = Assistants;
Beta.Threads = Threads;

export declare namespace Beta {
  export {
    ChatKit as ChatKit,
    type ChatKitWorkflow as ChatKitWorkflow,
    type FilePart as FilePart,
    type ImagePart as ImagePart,
    type ChatKitUploadFileResponse as ChatKitUploadFileResponse,
    type ChatKitUploadFileParams as ChatKitUploadFileParams,
  };

  export {
    Assistants as Assistants,
    type Assistant as Assistant,
    type AssistantDeleted as AssistantDeleted,
    type AssistantStreamEvent as AssistantStreamEvent,
    type AssistantTool as AssistantTool,
    type CodeInterpreterTool as CodeInterpreterTool,
    type FileSearchTool as FileSearchTool,
    type FunctionTool as FunctionTool,
    type MessageStreamEvent as MessageStreamEvent,
    type RunStepStreamEvent as RunStepStreamEvent,
    type RunStreamEvent as RunStreamEvent,
    type ThreadStreamEvent as ThreadStreamEvent,
    type AssistantsPage as AssistantsPage,
    type AssistantCreateParams as AssistantCreateParams,
    type AssistantUpdateParams as AssistantUpdateParams,
    type AssistantListParams as AssistantListParams,
  };

  export {
    Threads as Threads,
    type AssistantResponseFormatOption as AssistantResponseFormatOption,
    type AssistantToolChoice as AssistantToolChoice,
    type AssistantToolChoiceFunction as AssistantToolChoiceFunction,
    type AssistantToolChoiceOption as AssistantToolChoiceOption,
    type Thread as Thread,
    type ThreadDeleted as ThreadDeleted,
    type ThreadCreateParams as ThreadCreateParams,
    type ThreadUpdateParams as ThreadUpdateParams,
    type ThreadCreateAndRunParams as ThreadCreateAndRunParams,
    type ThreadCreateAndRunParamsNonStreaming as ThreadCreateAndRunParamsNonStreaming,
    type ThreadCreateAndRunParamsStreaming as ThreadCreateAndRunParamsStreaming,
  };
}
