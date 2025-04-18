// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as AssistantsAPI from './assistants';
import * as ChatAPI from './chat/chat';
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
import * as RealtimeAPI from './realtime/realtime';
import {
  ConversationCreatedEvent,
  ConversationItem,
  ConversationItemContent,
  ConversationItemCreateEvent,
  ConversationItemCreatedEvent,
  ConversationItemDeleteEvent,
  ConversationItemDeletedEvent,
  ConversationItemInputAudioTranscriptionCompletedEvent,
  ConversationItemInputAudioTranscriptionDeltaEvent,
  ConversationItemInputAudioTranscriptionFailedEvent,
  ConversationItemRetrieveEvent,
  ConversationItemTruncateEvent,
  ConversationItemTruncatedEvent,
  ConversationItemWithReference,
  ErrorEvent,
  InputAudioBufferAppendEvent,
  InputAudioBufferClearEvent,
  InputAudioBufferClearedEvent,
  InputAudioBufferCommitEvent,
  InputAudioBufferCommittedEvent,
  InputAudioBufferSpeechStartedEvent,
  InputAudioBufferSpeechStoppedEvent,
  RateLimitsUpdatedEvent,
  Realtime,
  RealtimeClientEvent,
  RealtimeResponse,
  RealtimeResponseStatus,
  RealtimeResponseUsage,
  RealtimeServerEvent,
  ResponseAudioDeltaEvent,
  ResponseAudioDoneEvent,
  ResponseAudioTranscriptDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseCancelEvent,
  ResponseContentPartAddedEvent,
  ResponseContentPartDoneEvent,
  ResponseCreateEvent,
  ResponseCreatedEvent,
  ResponseDoneEvent,
  ResponseFunctionCallArgumentsDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  SessionCreatedEvent,
  SessionUpdateEvent,
  SessionUpdatedEvent,
  TranscriptionSessionUpdate,
  TranscriptionSessionUpdatedEvent,
} from './realtime/realtime';
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
  ThreadCreateAndRunPollParams,
  ThreadCreateAndRunStreamParams,
  ThreadCreateParams,
  ThreadDeleted,
  ThreadUpdateParams,
  Threads,
} from './threads/threads';
import { Chat } from './chat/chat';

export class Beta extends APIResource {
  realtime: RealtimeAPI.Realtime = new RealtimeAPI.Realtime(this._client);
  chat: ChatAPI.Chat = new ChatAPI.Chat(this._client);
  assistants: AssistantsAPI.Assistants = new AssistantsAPI.Assistants(this._client);
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this._client);
}

Beta.Realtime = Realtime;
Beta.Assistants = Assistants;
Beta.AssistantsPage = AssistantsPage;
Beta.Threads = Threads;

export declare namespace Beta {
  export {
    Realtime as Realtime,
    type ConversationCreatedEvent as ConversationCreatedEvent,
    type ConversationItem as ConversationItem,
    type ConversationItemContent as ConversationItemContent,
    type ConversationItemCreateEvent as ConversationItemCreateEvent,
    type ConversationItemCreatedEvent as ConversationItemCreatedEvent,
    type ConversationItemDeleteEvent as ConversationItemDeleteEvent,
    type ConversationItemDeletedEvent as ConversationItemDeletedEvent,
    type ConversationItemInputAudioTranscriptionCompletedEvent as ConversationItemInputAudioTranscriptionCompletedEvent,
    type ConversationItemInputAudioTranscriptionDeltaEvent as ConversationItemInputAudioTranscriptionDeltaEvent,
    type ConversationItemInputAudioTranscriptionFailedEvent as ConversationItemInputAudioTranscriptionFailedEvent,
    type ConversationItemRetrieveEvent as ConversationItemRetrieveEvent,
    type ConversationItemTruncateEvent as ConversationItemTruncateEvent,
    type ConversationItemTruncatedEvent as ConversationItemTruncatedEvent,
    type ConversationItemWithReference as ConversationItemWithReference,
    type ErrorEvent as ErrorEvent,
    type InputAudioBufferAppendEvent as InputAudioBufferAppendEvent,
    type InputAudioBufferClearEvent as InputAudioBufferClearEvent,
    type InputAudioBufferClearedEvent as InputAudioBufferClearedEvent,
    type InputAudioBufferCommitEvent as InputAudioBufferCommitEvent,
    type InputAudioBufferCommittedEvent as InputAudioBufferCommittedEvent,
    type InputAudioBufferSpeechStartedEvent as InputAudioBufferSpeechStartedEvent,
    type InputAudioBufferSpeechStoppedEvent as InputAudioBufferSpeechStoppedEvent,
    type RateLimitsUpdatedEvent as RateLimitsUpdatedEvent,
    type RealtimeClientEvent as RealtimeClientEvent,
    type RealtimeResponse as RealtimeResponse,
    type RealtimeResponseStatus as RealtimeResponseStatus,
    type RealtimeResponseUsage as RealtimeResponseUsage,
    type RealtimeServerEvent as RealtimeServerEvent,
    type ResponseAudioDeltaEvent as ResponseAudioDeltaEvent,
    type ResponseAudioDoneEvent as ResponseAudioDoneEvent,
    type ResponseAudioTranscriptDeltaEvent as ResponseAudioTranscriptDeltaEvent,
    type ResponseAudioTranscriptDoneEvent as ResponseAudioTranscriptDoneEvent,
    type ResponseCancelEvent as ResponseCancelEvent,
    type ResponseContentPartAddedEvent as ResponseContentPartAddedEvent,
    type ResponseContentPartDoneEvent as ResponseContentPartDoneEvent,
    type ResponseCreateEvent as ResponseCreateEvent,
    type ResponseCreatedEvent as ResponseCreatedEvent,
    type ResponseDoneEvent as ResponseDoneEvent,
    type ResponseFunctionCallArgumentsDeltaEvent as ResponseFunctionCallArgumentsDeltaEvent,
    type ResponseFunctionCallArgumentsDoneEvent as ResponseFunctionCallArgumentsDoneEvent,
    type ResponseOutputItemAddedEvent as ResponseOutputItemAddedEvent,
    type ResponseOutputItemDoneEvent as ResponseOutputItemDoneEvent,
    type ResponseTextDeltaEvent as ResponseTextDeltaEvent,
    type ResponseTextDoneEvent as ResponseTextDoneEvent,
    type SessionCreatedEvent as SessionCreatedEvent,
    type SessionUpdateEvent as SessionUpdateEvent,
    type SessionUpdatedEvent as SessionUpdatedEvent,
    type TranscriptionSessionUpdate as TranscriptionSessionUpdate,
    type TranscriptionSessionUpdatedEvent as TranscriptionSessionUpdatedEvent,
  };

  export { Chat };

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
    AssistantsPage as AssistantsPage,
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
    type ThreadCreateAndRunPollParams,
    type ThreadCreateAndRunStreamParams,
  };
}
