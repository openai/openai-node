# Shared

Types:

- <code><a href="./src/resources/shared.ts">AllModels</a></code>
- <code><a href="./src/resources/shared.ts">ChatModel</a></code>
- <code><a href="./src/resources/shared.ts">ComparisonFilter</a></code>
- <code><a href="./src/resources/shared.ts">CompoundFilter</a></code>
- <code><a href="./src/resources/shared.ts">ErrorObject</a></code>
- <code><a href="./src/resources/shared.ts">FunctionDefinition</a></code>
- <code><a href="./src/resources/shared.ts">FunctionParameters</a></code>
- <code><a href="./src/resources/shared.ts">Metadata</a></code>
- <code><a href="./src/resources/shared.ts">Reasoning</a></code>
- <code><a href="./src/resources/shared.ts">ReasoningEffort</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatJSONObject</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatJSONSchema</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatText</a></code>
- <code><a href="./src/resources/shared.ts">ResponsesModel</a></code>

# Completions

Types:

- <code><a href="./src/resources/completions.ts">Completion</a></code>
- <code><a href="./src/resources/completions.ts">CompletionChoice</a></code>
- <code><a href="./src/resources/completions.ts">CompletionUsage</a></code>

Methods:

- <code title="post /completions">client.completions.<a href="./src/resources/completions.ts">create</a>({ ...params }) -> Completion</code>

# Chat

Types:

- <code><a href="./src/resources/chat/chat.ts">ChatModel</a></code>

## Completions

Types:

- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletion</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAssistantMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAudio</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAudioParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionChunk</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPart</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartImage</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartInputAudio</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartRefusal</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartText</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionDeleted</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionDeveloperMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionFunctionCallOption</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionFunctionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessage</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageToolCall</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionModality</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionNamedToolChoice</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionPredictionContent</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionRole</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionStoreMessage</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionStreamOptions</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionSystemMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionTokenLogprob</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionTool</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionToolChoiceOption</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionToolMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionUserMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionReasoningEffort</a></code>

Methods:

- <code title="post /chat/completions">client.chat.completions.<a href="./src/resources/chat/completions/completions.ts">create</a>({ ...params }) -> ChatCompletion</code>
- <code title="get /chat/completions/{completion_id}">client.chat.completions.<a href="./src/resources/chat/completions/completions.ts">retrieve</a>(completionID) -> ChatCompletion</code>
- <code title="post /chat/completions/{completion_id}">client.chat.completions.<a href="./src/resources/chat/completions/completions.ts">update</a>(completionID, { ...params }) -> ChatCompletion</code>
- <code title="get /chat/completions">client.chat.completions.<a href="./src/resources/chat/completions/completions.ts">list</a>({ ...params }) -> ChatCompletionsPage</code>
- <code title="delete /chat/completions/{completion_id}">client.chat.completions.<a href="./src/resources/chat/completions/completions.ts">delete</a>(completionID) -> ChatCompletionDeleted</code>

### Messages

Methods:

- <code title="get /chat/completions/{completion_id}/messages">client.chat.completions.messages.<a href="./src/resources/chat/completions/messages.ts">list</a>(completionID, { ...params }) -> ChatCompletionStoreMessagesPage</code>

# Embeddings

Types:

- <code><a href="./src/resources/embeddings.ts">CreateEmbeddingResponse</a></code>
- <code><a href="./src/resources/embeddings.ts">Embedding</a></code>
- <code><a href="./src/resources/embeddings.ts">EmbeddingModel</a></code>

Methods:

- <code title="post /embeddings">client.embeddings.<a href="./src/resources/embeddings.ts">create</a>({ ...params }) -> CreateEmbeddingResponse</code>

# Files

Types:

- <code><a href="./src/resources/files.ts">FileContent</a></code>
- <code><a href="./src/resources/files.ts">FileDeleted</a></code>
- <code><a href="./src/resources/files.ts">FileObject</a></code>
- <code><a href="./src/resources/files.ts">FilePurpose</a></code>

Methods:

- <code title="post /files">client.files.<a href="./src/resources/files.ts">create</a>({ ...params }) -> FileObject</code>
- <code title="get /files/{file_id}">client.files.<a href="./src/resources/files.ts">retrieve</a>(fileID) -> FileObject</code>
- <code title="get /files">client.files.<a href="./src/resources/files.ts">list</a>({ ...params }) -> FileObjectsPage</code>
- <code title="delete /files/{file_id}">client.files.<a href="./src/resources/files.ts">delete</a>(fileID) -> FileDeleted</code>
- <code title="get /files/{file_id}/content">client.files.<a href="./src/resources/files.ts">content</a>(fileID) -> Response</code>
- <code>client.files.<a href="./src/resources/files.ts">waitForProcessing</a>(id, { pollInterval = 5000, maxWait = 30 _ 60 _ 1000 }) -> Promise&lt;FileObject&gt;</code>

# Images

Types:

- <code><a href="./src/resources/images.ts">Image</a></code>
- <code><a href="./src/resources/images.ts">ImageModel</a></code>
- <code><a href="./src/resources/images.ts">ImagesResponse</a></code>

Methods:

- <code title="post /images/variations">client.images.<a href="./src/resources/images.ts">createVariation</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/edits">client.images.<a href="./src/resources/images.ts">edit</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/generations">client.images.<a href="./src/resources/images.ts">generate</a>({ ...params }) -> ImagesResponse</code>

# Audio

Types:

- <code><a href="./src/resources/audio/audio.ts">AudioModel</a></code>
- <code><a href="./src/resources/audio/audio.ts">AudioResponseFormat</a></code>

## Transcriptions

Types:

- <code><a href="./src/resources/audio/transcriptions.ts">Transcription</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionInclude</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionSegment</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionStreamEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionTextDeltaEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionTextDoneEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionVerbose</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionWord</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionCreateResponse</a></code>

Methods:

- <code title="post /audio/transcriptions">client.audio.transcriptions.<a href="./src/resources/audio/transcriptions.ts">create</a>({ ...params }) -> TranscriptionCreateResponse</code>

## Translations

Types:

- <code><a href="./src/resources/audio/translations.ts">Translation</a></code>
- <code><a href="./src/resources/audio/translations.ts">TranslationVerbose</a></code>
- <code><a href="./src/resources/audio/translations.ts">TranslationCreateResponse</a></code>

Methods:

- <code title="post /audio/translations">client.audio.translations.<a href="./src/resources/audio/translations.ts">create</a>({ ...params }) -> TranslationCreateResponse</code>

## Speech

Types:

- <code><a href="./src/resources/audio/speech.ts">SpeechModel</a></code>

Methods:

- <code title="post /audio/speech">client.audio.speech.<a href="./src/resources/audio/speech.ts">create</a>({ ...params }) -> Response</code>

# Moderations

Types:

- <code><a href="./src/resources/moderations.ts">Moderation</a></code>
- <code><a href="./src/resources/moderations.ts">ModerationImageURLInput</a></code>
- <code><a href="./src/resources/moderations.ts">ModerationModel</a></code>
- <code><a href="./src/resources/moderations.ts">ModerationMultiModalInput</a></code>
- <code><a href="./src/resources/moderations.ts">ModerationTextInput</a></code>
- <code><a href="./src/resources/moderations.ts">ModerationCreateResponse</a></code>

Methods:

- <code title="post /moderations">client.moderations.<a href="./src/resources/moderations.ts">create</a>({ ...params }) -> ModerationCreateResponse</code>

# Models

Types:

- <code><a href="./src/resources/models.ts">Model</a></code>
- <code><a href="./src/resources/models.ts">ModelDeleted</a></code>

Methods:

- <code title="get /models/{model}">client.models.<a href="./src/resources/models.ts">retrieve</a>(model) -> Model</code>
- <code title="get /models">client.models.<a href="./src/resources/models.ts">list</a>() -> ModelsPage</code>
- <code title="delete /models/{model}">client.models.<a href="./src/resources/models.ts">delete</a>(model) -> ModelDeleted</code>

# FineTuning

## Jobs

Types:

- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJob</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobEvent</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobWandbIntegration</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobWandbIntegrationObject</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobIntegration</a></code>

Methods:

- <code title="post /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">create</a>({ ...params }) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">retrieve</a>(fineTuningJobID) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">list</a>({ ...params }) -> FineTuningJobsPage</code>
- <code title="post /fine_tuning/jobs/{fine_tuning_job_id}/cancel">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">cancel</a>(fineTuningJobID) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/events">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">listEvents</a>(fineTuningJobID, { ...params }) -> FineTuningJobEventsPage</code>

### Checkpoints

Types:

- <code><a href="./src/resources/fine-tuning/jobs/checkpoints.ts">FineTuningJobCheckpoint</a></code>

Methods:

- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/checkpoints">client.fineTuning.jobs.checkpoints.<a href="./src/resources/fine-tuning/jobs/checkpoints.ts">list</a>(fineTuningJobID, { ...params }) -> FineTuningJobCheckpointsPage</code>

# VectorStores

Types:

- <code><a href="./src/resources/vector-stores/vector-stores.ts">AutoFileChunkingStrategyParam</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">FileChunkingStrategy</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">FileChunkingStrategyParam</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">OtherFileChunkingStrategyObject</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">StaticFileChunkingStrategy</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">StaticFileChunkingStrategyObject</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">StaticFileChunkingStrategyObjectParam</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">VectorStore</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">VectorStoreDeleted</a></code>
- <code><a href="./src/resources/vector-stores/vector-stores.ts">VectorStoreSearchResponse</a></code>

Methods:

- <code title="post /vector_stores">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">create</a>({ ...params }) -> VectorStore</code>
- <code title="get /vector_stores/{vector_store_id}">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">retrieve</a>(vectorStoreID) -> VectorStore</code>
- <code title="post /vector_stores/{vector_store_id}">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">update</a>(vectorStoreID, { ...params }) -> VectorStore</code>
- <code title="get /vector_stores">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">list</a>({ ...params }) -> VectorStoresPage</code>
- <code title="delete /vector_stores/{vector_store_id}">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">delete</a>(vectorStoreID) -> VectorStoreDeleted</code>
- <code title="post /vector_stores/{vector_store_id}/search">client.vectorStores.<a href="./src/resources/vector-stores/vector-stores.ts">search</a>(vectorStoreID, { ...params }) -> VectorStoreSearchResponsesPage</code>

## Files

Types:

- <code><a href="./src/resources/vector-stores/files.ts">VectorStoreFile</a></code>
- <code><a href="./src/resources/vector-stores/files.ts">VectorStoreFileDeleted</a></code>
- <code><a href="./src/resources/vector-stores/files.ts">FileContentResponse</a></code>

Methods:

- <code title="post /vector_stores/{vector_store_id}/files">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">create</a>(vectorStoreID, { ...params }) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">retrieve</a>(fileID, { ...params }) -> VectorStoreFile</code>
- <code title="post /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">update</a>(fileID, { ...params }) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">list</a>(vectorStoreID, { ...params }) -> VectorStoreFilesPage</code>
- <code title="delete /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">delete</a>(fileID, { ...params }) -> VectorStoreFileDeleted</code>
- <code title="get /vector_stores/{vector_store_id}/files/{file_id}/content">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">content</a>(fileID, { ...params }) -> FileContentResponsesPage</code>

## FileBatches

Types:

- <code><a href="./src/resources/vector-stores/file-batches.ts">VectorStoreFileBatch</a></code>

Methods:

- <code title="post /vector_stores/{vector_store_id}/file_batches">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">create</a>(vectorStoreID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">retrieve</a>(batchID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="post /vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">cancel</a>(batchID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}/files">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">listFiles</a>(batchID, { ...params }) -> VectorStoreFilesPage</code>

# Beta

## Realtime

Types:

- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationCreatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItem</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemContent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemCreateEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemCreatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemDeleteEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemDeletedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemInputAudioTranscriptionCompletedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemInputAudioTranscriptionDeltaEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemInputAudioTranscriptionFailedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemRetrieveEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemTruncateEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemTruncatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ConversationItemWithReference</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ErrorEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferAppendEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferClearEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferClearedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferCommitEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferCommittedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferSpeechStartedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">InputAudioBufferSpeechStoppedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RateLimitsUpdatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RealtimeClientEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RealtimeResponse</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RealtimeResponseStatus</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RealtimeResponseUsage</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">RealtimeServerEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseAudioDeltaEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseAudioDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseAudioTranscriptDeltaEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseAudioTranscriptDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseCancelEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseContentPartAddedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseContentPartDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseCreateEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseCreatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseFunctionCallArgumentsDeltaEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseFunctionCallArgumentsDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseOutputItemAddedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseOutputItemDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseTextDeltaEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">ResponseTextDoneEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">SessionCreatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">SessionUpdateEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">SessionUpdatedEvent</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">TranscriptionSessionUpdate</a></code>
- <code><a href="./src/resources/beta/realtime/realtime.ts">TranscriptionSessionUpdatedEvent</a></code>

### Sessions

Types:

- <code><a href="./src/resources/beta/realtime/sessions.ts">Session</a></code>
- <code><a href="./src/resources/beta/realtime/sessions.ts">SessionCreateResponse</a></code>

Methods:

- <code title="post /realtime/sessions">client.beta.realtime.sessions.<a href="./src/resources/beta/realtime/sessions.ts">create</a>({ ...params }) -> SessionCreateResponse</code>

### TranscriptionSessions

Types:

- <code><a href="./src/resources/beta/realtime/transcription-sessions.ts">TranscriptionSession</a></code>

Methods:

- <code title="post /realtime/transcription_sessions">client.beta.realtime.transcriptionSessions.<a href="./src/resources/beta/realtime/transcription-sessions.ts">create</a>({ ...params }) -> TranscriptionSession</code>

## Chat

### Completions

Methods:

- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">runTools</a>(body, options?) -> ChatCompletionRunner | ChatCompletionStreamingRunner</code>
- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">stream</a>(body, options?) -> ChatCompletionStream</code>

## Assistants

Types:

- <code><a href="./src/resources/beta/assistants.ts">Assistant</a></code>
- <code><a href="./src/resources/beta/assistants.ts">AssistantDeleted</a></code>
- <code><a href="./src/resources/beta/assistants.ts">AssistantStreamEvent</a></code>
- <code><a href="./src/resources/beta/assistants.ts">AssistantTool</a></code>
- <code><a href="./src/resources/beta/assistants.ts">CodeInterpreterTool</a></code>
- <code><a href="./src/resources/beta/assistants.ts">FileSearchTool</a></code>
- <code><a href="./src/resources/beta/assistants.ts">FunctionTool</a></code>
- <code><a href="./src/resources/beta/assistants.ts">MessageStreamEvent</a></code>
- <code><a href="./src/resources/beta/assistants.ts">RunStepStreamEvent</a></code>
- <code><a href="./src/resources/beta/assistants.ts">RunStreamEvent</a></code>
- <code><a href="./src/resources/beta/assistants.ts">ThreadStreamEvent</a></code>

Methods:

- <code title="post /assistants">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">create</a>({ ...params }) -> Assistant</code>
- <code title="get /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">retrieve</a>(assistantID) -> Assistant</code>
- <code title="post /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">update</a>(assistantID, { ...params }) -> Assistant</code>
- <code title="get /assistants">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">list</a>({ ...params }) -> AssistantsPage</code>
- <code title="delete /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">delete</a>(assistantID) -> AssistantDeleted</code>

## Threads

Types:

- <code><a href="./src/resources/beta/threads/threads.ts">AssistantResponseFormatOption</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoice</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoiceFunction</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoiceOption</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">Thread</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">ThreadDeleted</a></code>

Methods:

- <code title="post /threads">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">create</a>({ ...params }) -> Thread</code>
- <code title="get /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">retrieve</a>(threadID) -> Thread</code>
- <code title="post /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">update</a>(threadID, { ...params }) -> Thread</code>
- <code title="delete /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">delete</a>(threadID) -> ThreadDeleted</code>
- <code title="post /threads/runs">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRun</a>({ ...params }) -> Run</code>
- <code>client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRunPoll</a>(body, options?) -> Promise&lt;Threads.Run&gt;</code>
- <code>client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRunStream</a>(body, options?) -> AssistantStream</code>

### Runs

Types:

- <code><a href="./src/resources/beta/threads/runs/runs.ts">RequiredActionFunctionToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/runs.ts">Run</a></code>
- <code><a href="./src/resources/beta/threads/runs/runs.ts">RunStatus</a></code>

Methods:

- <code title="post /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">create</a>(threadID, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">retrieve</a>(runID, { ...params }) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">update</a>(runID, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">list</a>(threadID, { ...params }) -> RunsPage</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/cancel">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">cancel</a>(runID, { ...params }) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/submit_tool_outputs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">submitToolOutputs</a>(runID, { ...params }) -> Run</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">createAndPoll</a>(threadId, body, options?) -> Promise&lt;Run&gt;</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">createAndStream</a>(threadId, body, options?) -> AssistantStream</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">poll</a>(threadId, runId, options?) -> Promise&lt;Run&gt;</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">stream</a>(threadId, body, options?) -> AssistantStream</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">submitToolOutputsAndPoll</a>(threadId, runId, body, options?) -> Promise&lt;Run&gt;</code>
- <code>client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">submitToolOutputsStream</a>(threadId, runId, body, options?) -> AssistantStream</code>

#### Steps

Types:

- <code><a href="./src/resources/beta/threads/runs/steps.ts">CodeInterpreterLogs</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">CodeInterpreterOutputImage</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">CodeInterpreterToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">CodeInterpreterToolCallDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">FileSearchToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">FileSearchToolCallDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">FunctionToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">FunctionToolCallDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">MessageCreationStepDetails</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStep</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStepDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStepDeltaEvent</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStepDeltaMessageDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStepInclude</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallDeltaObject</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallsStepDetails</a></code>

Methods:

- <code title="get /threads/{thread_id}/runs/{run_id}/steps/{step_id}">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">retrieve</a>(stepID, { ...params }) -> RunStep</code>
- <code title="get /threads/{thread_id}/runs/{run_id}/steps">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">list</a>(runID, { ...params }) -> RunStepsPage</code>

### Messages

Types:

- <code><a href="./src/resources/beta/threads/messages.ts">Annotation</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">AnnotationDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">FileCitationAnnotation</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">FileCitationDeltaAnnotation</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">FilePathAnnotation</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">FilePathDeltaAnnotation</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageFile</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageFileContentBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageFileDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageFileDeltaBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageURL</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageURLContentBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageURLDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">ImageURLDeltaBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">Message</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageContent</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageContentDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageContentPartParam</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDeleted</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDeltaEvent</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">RefusalContentBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">RefusalDeltaBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">Text</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextContentBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextContentBlockParam</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextDeltaBlock</a></code>

Methods:

- <code title="post /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">create</a>(threadID, { ...params }) -> Message</code>
- <code title="get /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">retrieve</a>(messageID, { ...params }) -> Message</code>
- <code title="post /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">update</a>(messageID, { ...params }) -> Message</code>
- <code title="get /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">list</a>(threadID, { ...params }) -> MessagesPage</code>
- <code title="delete /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">delete</a>(messageID, { ...params }) -> MessageDeleted</code>

# Batches

Types:

- <code><a href="./src/resources/batches.ts">Batch</a></code>
- <code><a href="./src/resources/batches.ts">BatchError</a></code>
- <code><a href="./src/resources/batches.ts">BatchRequestCounts</a></code>

Methods:

- <code title="post /batches">client.batches.<a href="./src/resources/batches.ts">create</a>({ ...params }) -> Batch</code>
- <code title="get /batches/{batch_id}">client.batches.<a href="./src/resources/batches.ts">retrieve</a>(batchID) -> Batch</code>
- <code title="get /batches">client.batches.<a href="./src/resources/batches.ts">list</a>({ ...params }) -> BatchesPage</code>
- <code title="post /batches/{batch_id}/cancel">client.batches.<a href="./src/resources/batches.ts">cancel</a>(batchID) -> Batch</code>

# Uploads

Types:

- <code><a href="./src/resources/uploads/uploads.ts">Upload</a></code>

Methods:

- <code title="post /uploads">client.uploads.<a href="./src/resources/uploads/uploads.ts">create</a>({ ...params }) -> Upload</code>
- <code title="post /uploads/{upload_id}/cancel">client.uploads.<a href="./src/resources/uploads/uploads.ts">cancel</a>(uploadID) -> Upload</code>
- <code title="post /uploads/{upload_id}/complete">client.uploads.<a href="./src/resources/uploads/uploads.ts">complete</a>(uploadID, { ...params }) -> Upload</code>

## Parts

Types:

- <code><a href="./src/resources/uploads/parts.ts">UploadPart</a></code>

Methods:

- <code title="post /uploads/{upload_id}/parts">client.uploads.parts.<a href="./src/resources/uploads/parts.ts">create</a>(uploadID, { ...params }) -> UploadPart</code>

# Responses

Types:

- <code><a href="./src/resources/responses/responses.ts">ComputerTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">EasyInputMessage</a></code>
- <code><a href="./src/resources/responses/responses.ts">FileSearchTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">FunctionTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">Response</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseAudioDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseAudioDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseAudioTranscriptDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseAudioTranscriptDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterCallCodeDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterCallCodeDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterCallInterpretingEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCodeInterpreterToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseComputerToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseComputerToolCallOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseComputerToolCallOutputScreenshot</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseContentPartAddedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseContentPartDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCreatedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseError</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseErrorEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFailedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFileSearchCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFileSearchCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFileSearchCallSearchingEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFileSearchToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFormatTextConfig</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFormatTextJSONSchemaConfig</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionCallArgumentsDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionCallArgumentsDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCallItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCallOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionWebSearch</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseIncludable</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseIncompleteEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInput</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputAudio</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputFile</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputImage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputMessageContentList</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputMessageItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputText</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputAudio</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItemAddedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItemDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputMessage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputRefusal</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputText</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseRefusalDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseRefusalDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseStatus</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseStreamEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextAnnotationDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextConfig</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseUsage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallSearchingEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">Tool</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceFunction</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceOptions</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceTypes</a></code>
- <code><a href="./src/resources/responses/responses.ts">WebSearchTool</a></code>

Methods:

- <code title="post /responses">client.responses.<a href="./src/resources/responses/responses.ts">create</a>({ ...params }) -> Response</code>
- <code title="get /responses/{response_id}">client.responses.<a href="./src/resources/responses/responses.ts">retrieve</a>(responseID, { ...params }) -> Response</code>
- <code title="delete /responses/{response_id}">client.responses.<a href="./src/resources/responses/responses.ts">delete</a>(responseID) -> void</code>

## InputItems

Types:

- <code><a href="./src/resources/responses/input-items.ts">ResponseItemList</a></code>

Methods:

- <code title="get /responses/{response_id}/input_items">client.responses.inputItems.<a href="./src/resources/responses/input-items.ts">list</a>(responseID, { ...params }) -> ResponseItemsPage</code>
