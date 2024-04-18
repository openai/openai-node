# Shared

Types:

- <code><a href="./src/resources/shared.ts">ErrorObject</a></code>
- <code><a href="./src/resources/shared.ts">FunctionDefinition</a></code>
- <code><a href="./src/resources/shared.ts">FunctionParameters</a></code>

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

- <code><a href="./src/resources/chat/completions.ts">ChatCompletion</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionAssistantMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionChunk</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionContentPart</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionContentPartImage</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionContentPartText</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionFunctionCallOption</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionFunctionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionMessage</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionMessageToolCall</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionNamedToolChoice</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionRole</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionSystemMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionTokenLogprob</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionTool</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionToolChoiceOption</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionToolMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionUserMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">CreateChatCompletionRequestMessage</a></code>

Methods:

- <code title="post /chat/completions">client.chat.completions.<a href="./src/resources/chat/completions.ts">create</a>({ ...params }) -> ChatCompletion</code>

# Embeddings

Types:

- <code><a href="./src/resources/embeddings.ts">CreateEmbeddingResponse</a></code>
- <code><a href="./src/resources/embeddings.ts">Embedding</a></code>

Methods:

- <code title="post /embeddings">client.embeddings.<a href="./src/resources/embeddings.ts">create</a>({ ...params }) -> CreateEmbeddingResponse</code>

# Files

Types:

- <code><a href="./src/resources/files.ts">FileContent</a></code>
- <code><a href="./src/resources/files.ts">FileDeleted</a></code>
- <code><a href="./src/resources/files.ts">FileObject</a></code>

Methods:

- <code title="post /files">client.files.<a href="./src/resources/files.ts">create</a>({ ...params }) -> FileObject</code>
- <code title="get /files/{file_id}">client.files.<a href="./src/resources/files.ts">retrieve</a>(fileId) -> FileObject</code>
- <code title="get /files">client.files.<a href="./src/resources/files.ts">list</a>({ ...params }) -> FileObjectsPage</code>
- <code title="delete /files/{file_id}">client.files.<a href="./src/resources/files.ts">del</a>(fileId) -> FileDeleted</code>
- <code title="get /files/{file_id}/content">client.files.<a href="./src/resources/files.ts">content</a>(fileId) -> Response</code>
- <code title="get /files/{file_id}/content">client.files.<a href="./src/resources/files.ts">retrieveContent</a>(fileId) -> string</code>
- <code>client.files.<a href="./src/resources/files.ts">waitForProcessing</a>(id, { pollInterval = 5000, maxWait = 30 _ 60 _ 1000 }) -> Promise&lt;FileObject&gt;</code>

# Images

Types:

- <code><a href="./src/resources/images.ts">Image</a></code>
- <code><a href="./src/resources/images.ts">ImagesResponse</a></code>

Methods:

- <code title="post /images/variations">client.images.<a href="./src/resources/images.ts">createVariation</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/edits">client.images.<a href="./src/resources/images.ts">edit</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/generations">client.images.<a href="./src/resources/images.ts">generate</a>({ ...params }) -> ImagesResponse</code>

# Audio

## Transcriptions

Types:

- <code><a href="./src/resources/audio/transcriptions.ts">Transcription</a></code>

Methods:

- <code title="post /audio/transcriptions">client.audio.transcriptions.<a href="./src/resources/audio/transcriptions.ts">create</a>({ ...params }) -> Transcription</code>

## Translations

Types:

- <code><a href="./src/resources/audio/translations.ts">Translation</a></code>

Methods:

- <code title="post /audio/translations">client.audio.translations.<a href="./src/resources/audio/translations.ts">create</a>({ ...params }) -> Translation</code>

## Speech

Methods:

- <code title="post /audio/speech">client.audio.speech.<a href="./src/resources/audio/speech.ts">create</a>({ ...params }) -> Response</code>

# Moderations

Types:

- <code><a href="./src/resources/moderations.ts">Moderation</a></code>
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
- <code title="delete /models/{model}">client.models.<a href="./src/resources/models.ts">del</a>(model) -> ModelDeleted</code>

# FineTuning

## Jobs

Types:

- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJob</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobEvent</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobIntegration</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobWandbIntegration</a></code>
- <code><a href="./src/resources/fine-tuning/jobs/jobs.ts">FineTuningJobWandbIntegrationObject</a></code>

Methods:

- <code title="post /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">create</a>({ ...params }) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">retrieve</a>(fineTuningJobId) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">list</a>({ ...params }) -> FineTuningJobsPage</code>
- <code title="post /fine_tuning/jobs/{fine_tuning_job_id}/cancel">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">cancel</a>(fineTuningJobId) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/events">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs/jobs.ts">listEvents</a>(fineTuningJobId, { ...params }) -> FineTuningJobEventsPage</code>

### Checkpoints

Types:

- <code><a href="./src/resources/fine-tuning/jobs/checkpoints.ts">FineTuningJobCheckpoint</a></code>

Methods:

- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/checkpoints">client.fineTuning.jobs.checkpoints.<a href="./src/resources/fine-tuning/jobs/checkpoints.ts">list</a>(fineTuningJobId, { ...params }) -> FineTuningJobCheckpointsPage</code>

# Beta

## VectorStores

Types:

- <code><a href="./src/resources/beta/vector-stores/vector-stores.ts">VectorStore</a></code>
- <code><a href="./src/resources/beta/vector-stores/vector-stores.ts">VectorStoreDeleted</a></code>

Methods:

- <code title="post /vector_stores">client.beta.vectorStores.<a href="./src/resources/beta/vector-stores/vector-stores.ts">create</a>({ ...params }) -> VectorStore</code>
- <code title="get /vector_stores/{vector_store_id}">client.beta.vectorStores.<a href="./src/resources/beta/vector-stores/vector-stores.ts">retrieve</a>(vectorStoreId) -> VectorStore</code>
- <code title="post /vector_stores/{vector_store_id}">client.beta.vectorStores.<a href="./src/resources/beta/vector-stores/vector-stores.ts">update</a>(vectorStoreId, { ...params }) -> VectorStore</code>
- <code title="get /vector_stores">client.beta.vectorStores.<a href="./src/resources/beta/vector-stores/vector-stores.ts">list</a>({ ...params }) -> VectorStoresPage</code>
- <code title="delete /vector_stores/{vector_store_id}">client.beta.vectorStores.<a href="./src/resources/beta/vector-stores/vector-stores.ts">del</a>(vectorStoreId) -> VectorStoreDeleted</code>

### Files

Types:

- <code><a href="./src/resources/beta/vector-stores/files.ts">VectorStoreFile</a></code>
- <code><a href="./src/resources/beta/vector-stores/files.ts">VectorStoreFileDeleted</a></code>

Methods:

- <code title="post /vector_stores/{vector_store_id}/files">client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">create</a>(vectorStoreId, { ...params }) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files/{file_id}">client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">retrieve</a>(vectorStoreId, fileId) -> VectorStoreFile</code>
- <code title="get /vector_stores/{vector_store_id}/files">client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">list</a>(vectorStoreId, { ...params }) -> VectorStoreFilesPage</code>
- <code title="delete /vector_stores/{vector_store_id}/files/{file_id}">client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">del</a>(vectorStoreId, fileId) -> VectorStoreFileDeleted</code>
- <code>client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">createAndPoll</a>(vectorStoreId, body, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">poll</a>(vectorStoreId, fileId, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">upload</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>
- <code>client.beta.vectorStores.files.<a href="./src/resources/beta/vector-stores/files.ts">uploadAndPoll</a>(vectorStoreId, file, options?) -> Promise&lt;VectorStoreFile&gt;</code>

### FileBatches

Types:

- <code><a href="./src/resources/beta/vector-stores/file-batches.ts">VectorStoreFileBatch</a></code>

Methods:

- <code title="post /vector_stores/{vector_store_id}/file_batches">client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">create</a>(vectorStoreId, { ...params }) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}">client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">retrieve</a>(vectorStoreId, batchId) -> VectorStoreFileBatch</code>
- <code title="post /vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel">client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">cancel</a>(vectorStoreId, batchId) -> VectorStoreFileBatch</code>
- <code title="get /vector_stores/{vector_store_id}/file_batches/{batch_id}/files">client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">listFiles</a>(vectorStoreId, batchId, { ...params }) -> VectorStoreFilesPage</code>
- <code>client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">createAndPoll</a>(vectorStoreId, body, options?) -> Promise&lt;VectorStoreFileBatch&gt;</code>
- <code>client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">poll</a>(vectorStoreId, batchId, options?) -> Promise&lt;VectorStoreFileBatch&gt;</code>
- <code>client.beta.vectorStores.fileBatches.<a href="./src/resources/beta/vector-stores/file-batches.ts">uploadAndPoll</a>(vectorStoreId, { files, fileIds = [] }, options?) -> Promise&lt;VectorStoreFileBatch&gt;</code>

## Chat

### Completions

Methods:

- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">runFunctions</a>(body, options?) -> ChatCompletionRunner | ChatCompletionStreamingRunner</code>
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
- <code title="get /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">retrieve</a>(assistantId) -> Assistant</code>
- <code title="post /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">update</a>(assistantId, { ...params }) -> Assistant</code>
- <code title="get /assistants">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">list</a>({ ...params }) -> AssistantsPage</code>
- <code title="delete /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants.ts">del</a>(assistantId) -> AssistantDeleted</code>

## Threads

Types:

- <code><a href="./src/resources/beta/threads/threads.ts">AssistantResponseFormat</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantResponseFormatOption</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoice</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoiceFunction</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">AssistantToolChoiceOption</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">Thread</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">ThreadDeleted</a></code>

Methods:

- <code title="post /threads">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">create</a>({ ...params }) -> Thread</code>
- <code title="get /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">retrieve</a>(threadId) -> Thread</code>
- <code title="post /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">update</a>(threadId, { ...params }) -> Thread</code>
- <code title="delete /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">del</a>(threadId) -> ThreadDeleted</code>
- <code title="post /threads/runs">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRun</a>({ ...params }) -> Run</code>
- <code>client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRunPoll</a>(body, options?) -> Promise&lt;Threads.Run&gt;</code>
- <code>client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRunStream</a>(body, options?) -> AssistantStream</code>

### Runs

Types:

- <code><a href="./src/resources/beta/threads/runs/runs.ts">RequiredActionFunctionToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/runs.ts">Run</a></code>
- <code><a href="./src/resources/beta/threads/runs/runs.ts">RunStatus</a></code>

Methods:

- <code title="post /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">create</a>(threadId, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">retrieve</a>(threadId, runId) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">update</a>(threadId, runId, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">list</a>(threadId, { ...params }) -> RunsPage</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/cancel">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">cancel</a>(threadId, runId) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/submit_tool_outputs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">submitToolOutputs</a>(threadId, runId, { ...params }) -> Run</code>
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
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallDelta</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallDeltaObject</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallsStepDetails</a></code>

Methods:

- <code title="get /threads/{thread_id}/runs/{run_id}/steps/{step_id}">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">retrieve</a>(threadId, runId, stepId) -> RunStep</code>
- <code title="get /threads/{thread_id}/runs/{run_id}/steps">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">list</a>(threadId, runId, { ...params }) -> RunStepsPage</code>

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
- <code><a href="./src/resources/beta/threads/messages.ts">Message</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageContent</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageContentDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDeleted</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">MessageDeltaEvent</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">Text</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextContentBlock</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextDelta</a></code>
- <code><a href="./src/resources/beta/threads/messages.ts">TextDeltaBlock</a></code>

Methods:

- <code title="post /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">create</a>(threadId, { ...params }) -> Message</code>
- <code title="get /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">retrieve</a>(threadId, messageId) -> Message</code>
- <code title="post /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">update</a>(threadId, messageId, { ...params }) -> Message</code>
- <code title="get /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages.ts">list</a>(threadId, { ...params }) -> MessagesPage</code>

# Batches

Types:

- <code><a href="./src/resources/batches.ts">Batch</a></code>
- <code><a href="./src/resources/batches.ts">BatchError</a></code>
- <code><a href="./src/resources/batches.ts">BatchRequestCounts</a></code>

Methods:

- <code title="post /batches">client.batches.<a href="./src/resources/batches.ts">create</a>({ ...params }) -> Batch</code>
- <code title="get /batches/{batch_id}">client.batches.<a href="./src/resources/batches.ts">retrieve</a>(batchId) -> Batch</code>
- <code title="get /batches">client.batches.<a href="./src/resources/batches.ts">list</a>({ ...params }) -> BatchesPage</code>
- <code title="post /batches/{batch_id}/cancel">client.batches.<a href="./src/resources/batches.ts">cancel</a>(batchId) -> Batch</code>
