// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as AssistantsAPI from './assistants';
import * as ThreadsAPI from './threads/threads';
import * as VectorStoresAPI from './vector-stores/vector-stores';

export class Beta extends APIResource {
  vectorStores: VectorStoresAPI.VectorStores = new VectorStoresAPI.VectorStores(this._client);
  assistants: AssistantsAPI.Assistants = new AssistantsAPI.Assistants(this._client);
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this._client);
}

export namespace Beta {
  export import VectorStores = VectorStoresAPI.VectorStores;
  export type AutoFileChunkingStrategyParam = VectorStoresAPI.AutoFileChunkingStrategyParam;
  export type FileChunkingStrategy = VectorStoresAPI.FileChunkingStrategy;
  export type FileChunkingStrategyParam = VectorStoresAPI.FileChunkingStrategyParam;
  export type OtherFileChunkingStrategyObject = VectorStoresAPI.OtherFileChunkingStrategyObject;
  export type StaticFileChunkingStrategy = VectorStoresAPI.StaticFileChunkingStrategy;
  export type StaticFileChunkingStrategyObject = VectorStoresAPI.StaticFileChunkingStrategyObject;
  export type StaticFileChunkingStrategyParam = VectorStoresAPI.StaticFileChunkingStrategyParam;
  export type VectorStore = VectorStoresAPI.VectorStore;
  export type VectorStoreDeleted = VectorStoresAPI.VectorStoreDeleted;
  export import VectorStoresPage = VectorStoresAPI.VectorStoresPage;
  export type VectorStoreCreateParams = VectorStoresAPI.VectorStoreCreateParams;
  export type VectorStoreUpdateParams = VectorStoresAPI.VectorStoreUpdateParams;
  export type VectorStoreListParams = VectorStoresAPI.VectorStoreListParams;
  export import Assistants = AssistantsAPI.Assistants;
  export type Assistant = AssistantsAPI.Assistant;
  export type AssistantDeleted = AssistantsAPI.AssistantDeleted;
  export type AssistantStreamEvent = AssistantsAPI.AssistantStreamEvent;
  export type AssistantTool = AssistantsAPI.AssistantTool;
  export type CodeInterpreterTool = AssistantsAPI.CodeInterpreterTool;
  export type FileSearchTool = AssistantsAPI.FileSearchTool;
  export type FunctionTool = AssistantsAPI.FunctionTool;
  export type MessageStreamEvent = AssistantsAPI.MessageStreamEvent;
  export type RunStepStreamEvent = AssistantsAPI.RunStepStreamEvent;
  export type RunStreamEvent = AssistantsAPI.RunStreamEvent;
  export type ThreadStreamEvent = AssistantsAPI.ThreadStreamEvent;
  export import AssistantsPage = AssistantsAPI.AssistantsPage;
  export type AssistantCreateParams = AssistantsAPI.AssistantCreateParams;
  export type AssistantUpdateParams = AssistantsAPI.AssistantUpdateParams;
  export type AssistantListParams = AssistantsAPI.AssistantListParams;
  export import Threads = ThreadsAPI.Threads;
  export type AssistantResponseFormatOption = ThreadsAPI.AssistantResponseFormatOption;
  export type AssistantToolChoice = ThreadsAPI.AssistantToolChoice;
  export type AssistantToolChoiceFunction = ThreadsAPI.AssistantToolChoiceFunction;
  export type AssistantToolChoiceOption = ThreadsAPI.AssistantToolChoiceOption;
  export type Thread = ThreadsAPI.Thread;
  export type ThreadDeleted = ThreadsAPI.ThreadDeleted;
  export type ThreadCreateParams = ThreadsAPI.ThreadCreateParams;
  export type ThreadUpdateParams = ThreadsAPI.ThreadUpdateParams;
  export type ThreadCreateAndRunParams = ThreadsAPI.ThreadCreateAndRunParams;
  export type ThreadCreateAndRunParamsNonStreaming = ThreadsAPI.ThreadCreateAndRunParamsNonStreaming;
  export type ThreadCreateAndRunParamsStreaming = ThreadsAPI.ThreadCreateAndRunParamsStreaming;
}
