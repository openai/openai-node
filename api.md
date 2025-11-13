# Shared

Types:

- <code><a href="./src/resources/shared.ts">AllModels</a></code>
- <code><a href="./src/resources/shared.ts">ChatModel</a></code>
- <code><a href="./src/resources/shared.ts">ComparisonFilter</a></code>
- <code><a href="./src/resources/shared.ts">CompoundFilter</a></code>
- <code><a href="./src/resources/shared.ts">CustomToolInputFormat</a></code>
- <code><a href="./src/resources/shared.ts">ErrorObject</a></code>
- <code><a href="./src/resources/shared.ts">FunctionDefinition</a></code>
- <code><a href="./src/resources/shared.ts">FunctionParameters</a></code>
- <code><a href="./src/resources/shared.ts">Metadata</a></code>
- <code><a href="./src/resources/shared.ts">Reasoning</a></code>
- <code><a href="./src/resources/shared.ts">ReasoningEffort</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatJSONObject</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatJSONSchema</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatText</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatTextGrammar</a></code>
- <code><a href="./src/resources/shared.ts">ResponseFormatTextPython</a></code>
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
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAllowedToolChoice</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAssistantMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAudio</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAudioParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionChunk</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPart</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartImage</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartInputAudio</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartRefusal</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionContentPartText</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionCustomTool</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionDeleted</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionDeveloperMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionFunctionCallOption</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionFunctionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionFunctionTool</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessage</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageCustomToolCall</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageFunctionToolCall</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionMessageToolCall</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionModality</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionNamedToolChoice</a></code>
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionNamedToolChoiceCustom</a></code>
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
- <code><a href="./src/resources/chat/completions/completions.ts">ChatCompletionAllowedTools</a></code>
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
- <code><a href="./src/resources/images.ts">ImageEditCompletedEvent</a></code>
- <code><a href="./src/resources/images.ts">ImageEditPartialImageEvent</a></code>
- <code><a href="./src/resources/images.ts">ImageEditStreamEvent</a></code>
- <code><a href="./src/resources/images.ts">ImageGenCompletedEvent</a></code>
- <code><a href="./src/resources/images.ts">ImageGenPartialImageEvent</a></code>
- <code><a href="./src/resources/images.ts">ImageGenStreamEvent</a></code>
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
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionDiarized</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionDiarizedSegment</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionInclude</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionSegment</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionStreamEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionTextDeltaEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionTextDoneEvent</a></code>
- <code><a href="./src/resources/audio/transcriptions.ts">TranscriptionTextSegmentEvent</a></code>
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

## Methods

Types:

- <code><a href="./src/resources/fine-tuning/methods.ts">DpoHyperparameters</a></code>
- <code><a href="./src/resources/fine-tuning/methods.ts">DpoMethod</a></code>
- <code><a href="./src/resources/fine-tuning/methods.ts">ReinforcementHyperparameters</a></code>
- <code><a href="./src/resources/fine-tuning/methods.ts">ReinforcementMethod</a></code>
- <code><a href="./src/resources/fine-tuning/methods.ts">SupervisedHyperparameters</a></code>
- <code><a href="./src/resources/fine-tuning/methods.ts">SupervisedMethod</a></code>

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
- <code title="post /fine_tuning/jobs/{fine_tuning_job_id}/pause">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">pause</a>(fineTuningJobID) -> FineTuningJob</code>
- <code title="post /fine_tuning/jobs/{fine_tuning_job_id}/resume">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">resume</a>(fineTuningJobID) -> FineTuningJob</code>

### Checkpoints

Types:

- <code><a href="./src/resources/fine-tuning/jobs/checkpoints.ts">FineTuningJobCheckpoint</a></code>

Methods:

- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/checkpoints">client.fineTuning.jobs.checkpoints.<a href="./src/resources/fine-tuning/jobs/checkpoints.ts">list</a>(fineTuningJobID, { ...params }) -> FineTuningJobCheckpointsPage</code>

## Checkpoints

### Permissions

Types:

- <code><a href="./src/resources/fine-tuning/checkpoints/permissions.ts">PermissionCreateResponse</a></code>
- <code><a href="./src/resources/fine-tuning/checkpoints/permissions.ts">PermissionRetrieveResponse</a></code>
- <code><a href="./src/resources/fine-tuning/checkpoints/permissions.ts">PermissionDeleteResponse</a></code>

Methods:

- <code title="post /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions">client.fineTuning.checkpoints.permissions.<a href="./src/resources/fine-tuning/checkpoints/permissions.ts">create</a>(fineTunedModelCheckpoint, { ...params }) -> PermissionCreateResponsesPage</code>
- <code title="get /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions">client.fineTuning.checkpoints.permissions.<a href="./src/resources/fine-tuning/checkpoints/permissions.ts">retrieve</a>(fineTunedModelCheckpoint, { ...params }) -> PermissionRetrieveResponse</code>
- <code title="delete /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions/{permission_id}">client.fineTuning.checkpoints.permissions.<a href="./src/resources/fine-tuning/checkpoints/permissions.ts">delete</a>(permissionID, { ...params }) -> PermissionDeleteResponse</code>

## Alpha

### Graders

Types:

- <code><a href="./src/resources/fine-tuning/alpha/graders.ts">GraderRunResponse</a></code>
- <code><a href="./src/resources/fine-tuning/alpha/graders.ts">GraderValidateResponse</a></code>

Methods:

- <code title="post /fine_tuning/alpha/graders/run">client.fineTuning.alpha.graders.<a href="./src/resources/fine-tuning/alpha/graders.ts">run</a>({ ...params }) -> GraderRunResponse</code>
- <code title="post /fine_tuning/alpha/graders/validate">client.fineTuning.alpha.graders.<a href="./src/resources/fine-tuning/alpha/graders.ts">validate</a>({ ...params }) -> GraderValidateResponse</code>

# Graders

## GraderModels

Types:

- <code><a href="./src/resources/graders/grader-models.ts">LabelModelGrader</a></code>
- <code><a href="./src/resources/graders/grader-models.ts">MultiGrader</a></code>
- <code><a href="./src/resources/graders/grader-models.ts">PythonGrader</a></code>
- <code><a href="./src/resources/graders/grader-models.ts">ScoreModelGrader</a></code>
- <code><a href="./src/resources/graders/grader-models.ts">StringCheckGrader</a></code>
- <code><a href="./src/resources/graders/grader-models.ts">TextSimilarityGrader</a></code>

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

- <code title="post /vector_stores/{vector_store_id}/files">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">create</a>(vectorStoreId, { ...params }) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">retrieve</a>(vectorStoreId, fileId) -> VectorStoreFile</code>
- <code title="post /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">update</a>(vectorStoreId, fileId, { ...params }) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">list</a>(vectorStoreId, { ...params }) -> VectorStoreFilesPage</code>
- <code title="delete /vector_stores/{vector_store_id}/files/{file_id}">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">del</a>(vectorStoreId, fileId) -> VectorStoreFileDeleted</code>
- <code title="get /vector_stores/{vector_store_id}/files/{file_id}/content">client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">content</a>(vectorStoreId, fileId) -> FileContentResponsesPage</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">createAndPoll</a>(vectorStoreId, body, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">poll</a>(vectorStoreId, fileId, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">upload</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">uploadAndPoll</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>

## FileBatches

Types:

- <code><a href="./src/resources/vector-stores/file-batches.ts">VectorStoreFileBatch</a></code>

Methods:

- <code title="post /vector_stores/{vector_store_id}/file_batches">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">create</a>(vectorStoreID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">retrieve</a>(batchID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="post /vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">cancel</a>(batchID, { ...params }) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}/files">client.vectorStores.fileBatches.<a href="./src/resources/vector-stores/file-batches.ts">listFiles</a>(batchID, { ...params }) -> VectorStoreFilesPage</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">createAndPoll</a>(vectorStoreId, body, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">poll</a>(vectorStoreId, fileId, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">upload</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.vectorStores.files.<a href="./src/resources/vector-stores/files.ts">uploadAndPoll</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>

# Webhooks

Types:

- <code><a href="./src/resources/webhooks.ts">BatchCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">BatchCompletedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">BatchExpiredWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">BatchFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">EvalRunCanceledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">EvalRunFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">EvalRunSucceededWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">FineTuningJobCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">FineTuningJobFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">FineTuningJobSucceededWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">RealtimeCallIncomingWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">ResponseCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">ResponseCompletedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">ResponseFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">ResponseIncompleteWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks.ts">UnwrapWebhookEvent</a></code>

Methods:

- <code>client.webhooks.<a href="./src/resources/webhooks.ts">unwrap</a>(payload, headers, secret?, tolerance?) -> UnwrapWebhookEvent</code>
- <code>client.webhooks.<a href="./src/resources/webhooks.ts">verifySignature</a>(payload, headers, secret?, tolerance?) -> void</code>

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
## ChatKit

Types:

- <code><a href="./src/resources/beta/chatkit/chatkit.ts">ChatKitWorkflow</a></code>

### Sessions

Methods:

- <code title="post /chatkit/sessions">client.beta.chatkit.sessions.<a href="./src/resources/beta/chatkit/sessions.ts">create</a>({ ...params }) -> ChatSession</code>
- <code title="post /chatkit/sessions/{session_id}/cancel">client.beta.chatkit.sessions.<a href="./src/resources/beta/chatkit/sessions.ts">cancel</a>(sessionID) -> ChatSession</code>

### Threads

Types:

- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSession</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionAutomaticThreadTitling</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionChatKitConfiguration</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionChatKitConfigurationParam</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionExpiresAfterParam</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionFileUpload</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionHistory</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionRateLimits</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionRateLimitsParam</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionStatus</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatSessionWorkflowParam</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitAttachment</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitResponseOutputText</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitThread</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitThreadAssistantMessageItem</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitThreadItemList</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitThreadUserMessageItem</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ChatKitWidgetItem</a></code>
- <code><a href="./src/resources/beta/chatkit/threads.ts">ThreadDeleteResponse</a></code>

Methods:

- <code title="get /chatkit/threads/{thread_id}">client.beta.chatkit.threads.<a href="./src/resources/beta/chatkit/threads.ts">retrieve</a>(threadID) -> ChatKitThread</code>
- <code title="get /chatkit/threads">client.beta.chatkit.threads.<a href="./src/resources/beta/chatkit/threads.ts">list</a>({ ...params }) -> ChatKitThreadsPage</code>
- <code title="delete /chatkit/threads/{thread_id}">client.beta.chatkit.threads.<a href="./src/resources/beta/chatkit/threads.ts">delete</a>(threadID) -> ThreadDeleteResponse</code>
- <code title="get /chatkit/threads/{thread_id}/items">client.beta.chatkit.threads.<a href="./src/resources/beta/chatkit/threads.ts">listItems</a>(threadID, { ...params }) -> ChatKitThreadItemListDataPage</code>

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
- <code><a href="./src/resources/batches.ts">BatchUsage</a></code>

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

- <code><a href="./src/resources/responses/responses.ts">ApplyPatchTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">ComputerTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">CustomTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">EasyInputMessage</a></code>
- <code><a href="./src/resources/responses/responses.ts">FileSearchTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">FunctionShellTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">FunctionTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">Response</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseApplyPatchToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseApplyPatchToolCallOutput</a></code>
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
- <code><a href="./src/resources/responses/responses.ts">ResponseConversationParam</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCreatedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCustomToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCustomToolCallInputDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCustomToolCallInputDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseCustomToolCallOutput</a></code>
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
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionCallOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionCallOutputItemList</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionShellCallOutputContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionShellToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionShellToolCallOutput</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCall</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCallItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionToolCallOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseFunctionWebSearch</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseImageGenCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseImageGenCallGeneratingEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseImageGenCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseImageGenCallPartialImageEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseIncludable</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseIncompleteEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInput</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputAudio</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputFile</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputFileContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputImage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputImageContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputMessageContentList</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputMessageItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputText</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseInputTextContent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpCallArgumentsDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpCallArgumentsDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpCallFailedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpListToolsCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpListToolsFailedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseMcpListToolsInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputAudio</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItemAddedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputItemDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputMessage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputRefusal</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputText</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseOutputTextAnnotationAddedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponsePrompt</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseQueuedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningItem</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningSummaryPartAddedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningSummaryPartDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningSummaryTextDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningSummaryTextDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningTextDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseReasoningTextDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseRefusalDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseRefusalDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseStatus</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseStreamEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextConfig</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextDeltaEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseTextDoneEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseUsage</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallCompletedEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallInProgressEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">ResponseWebSearchCallSearchingEvent</a></code>
- <code><a href="./src/resources/responses/responses.ts">Tool</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceAllowed</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceApplyPatch</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceCustom</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceFunction</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceMcp</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceOptions</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceShell</a></code>
- <code><a href="./src/resources/responses/responses.ts">ToolChoiceTypes</a></code>
- <code><a href="./src/resources/responses/responses.ts">WebSearchPreviewTool</a></code>
- <code><a href="./src/resources/responses/responses.ts">WebSearchTool</a></code>

Methods:

- <code title="post /responses">client.responses.<a href="./src/resources/responses/responses.ts">create</a>({ ...params }) -> Response</code>
- <code title="get /responses/{response_id}">client.responses.<a href="./src/resources/responses/responses.ts">retrieve</a>(responseID, { ...params }) -> Response</code>
- <code title="delete /responses/{response_id}">client.responses.<a href="./src/resources/responses/responses.ts">delete</a>(responseID) -> void</code>
- <code title="post /responses/{response_id}/cancel">client.responses.<a href="./src/resources/responses/responses.ts">cancel</a>(responseID) -> Response</code>

## InputItems

Types:

- <code><a href="./src/resources/responses/input-items.ts">ResponseItemList</a></code>

Methods:

- <code title="get /responses/{response_id}/input_items">client.responses.inputItems.<a href="./src/resources/responses/input-items.ts">list</a>(responseID, { ...params }) -> ResponseItemsPage</code>

## InputTokens

Types:

- <code><a href="./src/resources/responses/input-tokens.ts">InputTokenCountResponse</a></code>

Methods:

- <code title="post /responses/input_tokens">client.responses.inputTokens.<a href="./src/resources/responses/input-tokens.ts">count</a>({ ...params }) -> InputTokenCountResponse</code>

# Realtime

Types:

- <code><a href="./src/resources/realtime/realtime.ts">AudioTranscription</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationCreatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItem</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemAdded</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemCreateEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemCreatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemDeleteEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemDeletedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemDone</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemInputAudioTranscriptionCompletedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemInputAudioTranscriptionDeltaEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemInputAudioTranscriptionFailedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemInputAudioTranscriptionSegment</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemRetrieveEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemTruncateEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemTruncatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ConversationItemWithReference</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferAppendEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferClearEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferClearedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferCommitEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferCommittedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferSpeechStartedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferSpeechStoppedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">InputAudioBufferTimeoutTriggered</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">LogProbProperties</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">McpListToolsCompleted</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">McpListToolsFailed</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">McpListToolsInProgress</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">NoiseReductionType</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">OutputAudioBufferClearEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RateLimitsUpdatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeAudioConfig</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeAudioConfigInput</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeAudioConfigOutput</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeAudioFormats</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeAudioInputTurnDetection</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeClientEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeConversationItemAssistantMessage</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeConversationItemFunctionCall</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeConversationItemFunctionCallOutput</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeConversationItemSystemMessage</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeConversationItemUserMessage</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeError</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeErrorEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeFunctionTool</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpApprovalRequest</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpApprovalResponse</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpListTools</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpProtocolError</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpToolCall</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcpToolExecutionError</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeMcphttpError</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponse</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseCreateAudioOutput</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseCreateMcpTool</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseCreateParams</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseStatus</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseUsage</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseUsageInputTokenDetails</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeResponseUsageOutputTokenDetails</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeServerEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeSession</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeSessionCreateRequest</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeToolChoiceConfig</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeToolsConfig</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeToolsConfigUnion</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTracingConfig</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTranscriptionSessionAudio</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTranscriptionSessionAudioInput</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTranscriptionSessionAudioInputTurnDetection</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTranscriptionSessionCreateRequest</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTruncation</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">RealtimeTruncationRetentionRatio</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseAudioDeltaEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseAudioDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseAudioTranscriptDeltaEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseAudioTranscriptDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseCancelEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseContentPartAddedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseContentPartDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseCreateEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseCreatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseFunctionCallArgumentsDeltaEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseFunctionCallArgumentsDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseMcpCallArgumentsDelta</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseMcpCallArgumentsDone</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseMcpCallCompleted</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseMcpCallFailed</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseMcpCallInProgress</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseOutputItemAddedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseOutputItemDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseTextDeltaEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">ResponseTextDoneEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">SessionCreatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">SessionUpdateEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">SessionUpdatedEvent</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">TranscriptionSessionUpdate</a></code>
- <code><a href="./src/resources/realtime/realtime.ts">TranscriptionSessionUpdatedEvent</a></code>

## ClientSecrets

Types:

- <code><a href="./src/resources/realtime/client-secrets.ts">RealtimeSessionClientSecret</a></code>
- <code><a href="./src/resources/realtime/client-secrets.ts">RealtimeSessionCreateResponse</a></code>
- <code><a href="./src/resources/realtime/client-secrets.ts">RealtimeTranscriptionSessionCreateResponse</a></code>
- <code><a href="./src/resources/realtime/client-secrets.ts">RealtimeTranscriptionSessionTurnDetection</a></code>
- <code><a href="./src/resources/realtime/client-secrets.ts">ClientSecretCreateResponse</a></code>

Methods:

- <code title="post /realtime/client_secrets">client.realtime.clientSecrets.<a href="./src/resources/realtime/client-secrets.ts">create</a>({ ...params }) -> ClientSecretCreateResponse</code>

## Calls

Methods:

- <code title="post /realtime/calls/{call_id}/accept">client.realtime.calls.<a href="./src/resources/realtime/calls.ts">accept</a>(callID, { ...params }) -> void</code>
- <code title="post /realtime/calls/{call_id}/hangup">client.realtime.calls.<a href="./src/resources/realtime/calls.ts">hangup</a>(callID) -> void</code>
- <code title="post /realtime/calls/{call_id}/refer">client.realtime.calls.<a href="./src/resources/realtime/calls.ts">refer</a>(callID, { ...params }) -> void</code>
- <code title="post /realtime/calls/{call_id}/reject">client.realtime.calls.<a href="./src/resources/realtime/calls.ts">reject</a>(callID, { ...params }) -> void</code>

# Conversations

Types:

- <code><a href="./src/resources/conversations/conversations.ts">ComputerScreenshotContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">Conversation</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">ConversationDeleted</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">ConversationDeletedResource</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">Message</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">SummaryTextContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">TextContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">InputTextContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">OutputTextContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">RefusalContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">InputImageContent</a></code>
- <code><a href="./src/resources/conversations/conversations.ts">InputFileContent</a></code>

Methods:

- <code title="post /conversations">client.conversations.<a href="./src/resources/conversations/conversations.ts">create</a>({ ...params }) -> Conversation</code>
- <code title="get /conversations/{conversation_id}">client.conversations.<a href="./src/resources/conversations/conversations.ts">retrieve</a>(conversationID) -> Conversation</code>
- <code title="post /conversations/{conversation_id}">client.conversations.<a href="./src/resources/conversations/conversations.ts">update</a>(conversationID, { ...params }) -> Conversation</code>
- <code title="delete /conversations/{conversation_id}">client.conversations.<a href="./src/resources/conversations/conversations.ts">delete</a>(conversationID) -> ConversationDeletedResource</code>

## Items

Types:

- <code><a href="./src/resources/conversations/items.ts">ConversationItem</a></code>
- <code><a href="./src/resources/conversations/items.ts">ConversationItemList</a></code>

Methods:

- <code title="post /conversations/{conversation_id}/items">client.conversations.items.<a href="./src/resources/conversations/items.ts">create</a>(conversationID, { ...params }) -> ConversationItemList</code>
- <code title="get /conversations/{conversation_id}/items/{item_id}">client.conversations.items.<a href="./src/resources/conversations/items.ts">retrieve</a>(itemID, { ...params }) -> ConversationItem</code>
- <code title="get /conversations/{conversation_id}/items">client.conversations.items.<a href="./src/resources/conversations/items.ts">list</a>(conversationID, { ...params }) -> ConversationItemsPage</code>
- <code title="delete /conversations/{conversation_id}/items/{item_id}">client.conversations.items.<a href="./src/resources/conversations/items.ts">delete</a>(itemID, { ...params }) -> Conversation</code>

# Evals

Types:

- <code><a href="./src/resources/evals/evals.ts">EvalCustomDataSourceConfig</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalStoredCompletionsDataSourceConfig</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalCreateResponse</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalRetrieveResponse</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalUpdateResponse</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalListResponse</a></code>
- <code><a href="./src/resources/evals/evals.ts">EvalDeleteResponse</a></code>

Methods:

- <code title="post /evals">client.evals.<a href="./src/resources/evals/evals.ts">create</a>({ ...params }) -> EvalCreateResponse</code>
- <code title="get /evals/{eval_id}">client.evals.<a href="./src/resources/evals/evals.ts">retrieve</a>(evalID) -> EvalRetrieveResponse</code>
- <code title="post /evals/{eval_id}">client.evals.<a href="./src/resources/evals/evals.ts">update</a>(evalID, { ...params }) -> EvalUpdateResponse</code>
- <code title="get /evals">client.evals.<a href="./src/resources/evals/evals.ts">list</a>({ ...params }) -> EvalListResponsesPage</code>
- <code title="delete /evals/{eval_id}">client.evals.<a href="./src/resources/evals/evals.ts">delete</a>(evalID) -> EvalDeleteResponse</code>

## Runs

Types:

- <code><a href="./src/resources/evals/runs/runs.ts">CreateEvalCompletionsRunDataSource</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">CreateEvalJSONLRunDataSource</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">EvalAPIError</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">RunCreateResponse</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">RunRetrieveResponse</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">RunListResponse</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">RunDeleteResponse</a></code>
- <code><a href="./src/resources/evals/runs/runs.ts">RunCancelResponse</a></code>

Methods:

- <code title="post /evals/{eval_id}/runs">client.evals.runs.<a href="./src/resources/evals/runs/runs.ts">create</a>(evalID, { ...params }) -> RunCreateResponse</code>
- <code title="get /evals/{eval_id}/runs/{run_id}">client.evals.runs.<a href="./src/resources/evals/runs/runs.ts">retrieve</a>(runID, { ...params }) -> RunRetrieveResponse</code>
- <code title="get /evals/{eval_id}/runs">client.evals.runs.<a href="./src/resources/evals/runs/runs.ts">list</a>(evalID, { ...params }) -> RunListResponsesPage</code>
- <code title="delete /evals/{eval_id}/runs/{run_id}">client.evals.runs.<a href="./src/resources/evals/runs/runs.ts">delete</a>(runID, { ...params }) -> RunDeleteResponse</code>
- <code title="post /evals/{eval_id}/runs/{run_id}">client.evals.runs.<a href="./src/resources/evals/runs/runs.ts">cancel</a>(runID, { ...params }) -> RunCancelResponse</code>

### OutputItems

Types:

- <code><a href="./src/resources/evals/runs/output-items.ts">OutputItemRetrieveResponse</a></code>
- <code><a href="./src/resources/evals/runs/output-items.ts">OutputItemListResponse</a></code>

Methods:

- <code title="get /evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}">client.evals.runs.outputItems.<a href="./src/resources/evals/runs/output-items.ts">retrieve</a>(outputItemID, { ...params }) -> OutputItemRetrieveResponse</code>
- <code title="get /evals/{eval_id}/runs/{run_id}/output_items">client.evals.runs.outputItems.<a href="./src/resources/evals/runs/output-items.ts">list</a>(runID, { ...params }) -> OutputItemListResponsesPage</code>

# Containers

Types:

- <code><a href="./src/resources/containers/containers.ts">ContainerCreateResponse</a></code>
- <code><a href="./src/resources/containers/containers.ts">ContainerRetrieveResponse</a></code>
- <code><a href="./src/resources/containers/containers.ts">ContainerListResponse</a></code>

Methods:

- <code title="post /containers">client.containers.<a href="./src/resources/containers/containers.ts">create</a>({ ...params }) -> ContainerCreateResponse</code>
- <code title="get /containers/{container_id}">client.containers.<a href="./src/resources/containers/containers.ts">retrieve</a>(containerID) -> ContainerRetrieveResponse</code>
- <code title="get /containers">client.containers.<a href="./src/resources/containers/containers.ts">list</a>({ ...params }) -> ContainerListResponsesPage</code>
- <code title="delete /containers/{container_id}">client.containers.<a href="./src/resources/containers/containers.ts">delete</a>(containerID) -> void</code>

## Files

Types:

- <code><a href="./src/resources/containers/files/files.ts">FileCreateResponse</a></code>
- <code><a href="./src/resources/containers/files/files.ts">FileRetrieveResponse</a></code>
- <code><a href="./src/resources/containers/files/files.ts">FileListResponse</a></code>

Methods:

- <code title="post /containers/{container_id}/files">client.containers.files.<a href="./src/resources/containers/files/files.ts">create</a>(containerID, { ...params }) -> FileCreateResponse</code>
- <code title="get /containers/{container_id}/files/{file_id}">client.containers.files.<a href="./src/resources/containers/files/files.ts">retrieve</a>(fileID, { ...params }) -> FileRetrieveResponse</code>
- <code title="get /containers/{container_id}/files">client.containers.files.<a href="./src/resources/containers/files/files.ts">list</a>(containerID, { ...params }) -> FileListResponsesPage</code>
- <code title="delete /containers/{container_id}/files/{file_id}">client.containers.files.<a href="./src/resources/containers/files/files.ts">delete</a>(fileID, { ...params }) -> void</code>

### Content

Methods:

- <code title="get /containers/{container_id}/files/{file_id}/content">client.containers.files.content.<a href="./src/resources/containers/files/content.ts">retrieve</a>(fileID, { ...params }) -> Response</code>

# Videos

Types:

- <code><a href="./src/resources/videos.ts">Video</a></code>
- <code><a href="./src/resources/videos.ts">VideoCreateError</a></code>
- <code><a href="./src/resources/videos.ts">VideoModel</a></code>
- <code><a href="./src/resources/videos.ts">VideoSeconds</a></code>
- <code><a href="./src/resources/videos.ts">VideoSize</a></code>
- <code><a href="./src/resources/videos.ts">VideoDeleteResponse</a></code>

Methods:

- <code title="post /videos">client.videos.<a href="./src/resources/videos.ts">create</a>({ ...params }) -> Video</code>
- <code title="get /videos/{video_id}">client.videos.<a href="./src/resources/videos.ts">retrieve</a>(videoID) -> Video</code>
- <code title="get /videos">client.videos.<a href="./src/resources/videos.ts">list</a>({ ...params }) -> VideosPage</code>
- <code title="delete /videos/{video_id}">client.videos.<a href="./src/resources/videos.ts">delete</a>(videoID) -> VideoDeleteResponse</code>
- <code title="get /videos/{video_id}/content">client.videos.<a href="./src/resources/videos.ts">downloadContent</a>(videoID, { ...params }) -> Response</code>
- <code title="post /videos/{video_id}/remix">client.videos.<a href="./src/resources/videos.ts">remix</a>(videoID, { ...params }) -> Video</code>
