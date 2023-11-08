# Shared

Types:

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
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionTool</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionToolChoiceOption</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionToolMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">ChatCompletionUserMessageParam</a></code>
- <code><a href="./src/resources/chat/completions.ts">CreateChatCompletionRequestMessage</a></code>

Methods:

- <code title="post /chat/completions">client.chat.completions.<a href="./src/resources/chat/completions.ts">create</a>({ ...params }) -> ChatCompletion</code>

# Edits

Types:

- <code><a href="./src/resources/edits.ts">Edit</a></code>

Methods:

- <code title="post /edits">client.edits.<a href="./src/resources/edits.ts">create</a>({ ...params }) -> Edit</code>

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

- <code><a href="./src/resources/fine-tuning/jobs.ts">FineTuningJob</a></code>
- <code><a href="./src/resources/fine-tuning/jobs.ts">FineTuningJobEvent</a></code>

Methods:

- <code title="post /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs.ts">create</a>({ ...params }) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs.ts">retrieve</a>(fineTuningJobId) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs.ts">list</a>({ ...params }) -> FineTuningJobsPage</code>
- <code title="post /fine_tuning/jobs/{fine_tuning_job_id}/cancel">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs.ts">cancel</a>(fineTuningJobId) -> FineTuningJob</code>
- <code title="get /fine_tuning/jobs/{fine_tuning_job_id}/events">client.fineTuning.jobs.<a href="./src/resources/fine-tuning/jobs.ts">listEvents</a>(fineTuningJobId, { ...params }) -> FineTuningJobEventsPage</code>

# FineTunes

Types:

- <code><a href="./src/resources/fine-tunes.ts">FineTune</a></code>
- <code><a href="./src/resources/fine-tunes.ts">FineTuneEvent</a></code>
- <code><a href="./src/resources/fine-tunes.ts">FineTuneEventsListResponse</a></code>

Methods:

- <code title="post /fine-tunes">client.fineTunes.<a href="./src/resources/fine-tunes.ts">create</a>({ ...params }) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}">client.fineTunes.<a href="./src/resources/fine-tunes.ts">retrieve</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes">client.fineTunes.<a href="./src/resources/fine-tunes.ts">list</a>() -> FineTunesPage</code>
- <code title="post /fine-tunes/{fine_tune_id}/cancel">client.fineTunes.<a href="./src/resources/fine-tunes.ts">cancel</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}/events">client.fineTunes.<a href="./src/resources/fine-tunes.ts">listEvents</a>(fineTuneId, { ...params }) -> FineTuneEventsListResponse</code>

# Beta

## Chat

### Completions

Methods:

- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">runFunctions</a>(body, options?) -> ChatCompletionRunner | ChatCompletionStreamingRunner</code>
- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">runTools</a>(body, options?) -> ChatCompletionRunner | ChatCompletionStreamingRunner</code>
- <code>client.beta.chat.completions.<a href="./src/resources/beta/chat/completions.ts">stream</a>(body, options?) -> ChatCompletionStream</code>

## Assistants

Types:

- <code><a href="./src/resources/beta/assistants/assistants.ts">Assistant</a></code>
- <code><a href="./src/resources/beta/assistants/assistants.ts">AssistantDeleted</a></code>

Methods:

- <code title="post /assistants">client.beta.assistants.<a href="./src/resources/beta/assistants/assistants.ts">create</a>({ ...params }) -> Assistant</code>
- <code title="get /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants/assistants.ts">retrieve</a>(assistantId) -> Assistant</code>
- <code title="post /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants/assistants.ts">update</a>(assistantId, { ...params }) -> Assistant</code>
- <code title="get /assistants">client.beta.assistants.<a href="./src/resources/beta/assistants/assistants.ts">list</a>({ ...params }) -> AssistantsPage</code>
- <code title="delete /assistants/{assistant_id}">client.beta.assistants.<a href="./src/resources/beta/assistants/assistants.ts">del</a>(assistantId) -> AssistantDeleted</code>

### Files

Types:

- <code><a href="./src/resources/beta/assistants/files.ts">AssistantFile</a></code>
- <code><a href="./src/resources/beta/assistants/files.ts">FileDeleteResponse</a></code>

Methods:

- <code title="post /assistants/{assistant_id}/files">client.beta.assistants.files.<a href="./src/resources/beta/assistants/files.ts">create</a>(assistantId, { ...params }) -> AssistantFile</code>
- <code title="get /assistants/{assistant_id}/files/{file_id}">client.beta.assistants.files.<a href="./src/resources/beta/assistants/files.ts">retrieve</a>(assistantId, fileId) -> AssistantFile</code>
- <code title="get /assistants/{assistant_id}/files">client.beta.assistants.files.<a href="./src/resources/beta/assistants/files.ts">list</a>(assistantId, { ...params }) -> AssistantFilesPage</code>
- <code title="delete /assistants/{assistant_id}/files/{file_id}">client.beta.assistants.files.<a href="./src/resources/beta/assistants/files.ts">del</a>(assistantId, fileId) -> FileDeleteResponse</code>

## Threads

Types:

- <code><a href="./src/resources/beta/threads/threads.ts">Thread</a></code>
- <code><a href="./src/resources/beta/threads/threads.ts">ThreadDeleted</a></code>

Methods:

- <code title="post /threads">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">create</a>({ ...params }) -> Thread</code>
- <code title="get /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">retrieve</a>(threadId) -> Thread</code>
- <code title="post /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">update</a>(threadId, { ...params }) -> Thread</code>
- <code title="delete /threads/{thread_id}">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">del</a>(threadId) -> ThreadDeleted</code>
- <code title="post /threads/runs">client.beta.threads.<a href="./src/resources/beta/threads/threads.ts">createAndRun</a>({ ...params }) -> Run</code>

### Runs

Types:

- <code><a href="./src/resources/beta/threads/runs/runs.ts">RequiredActionFunctionToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/runs.ts">Run</a></code>

Methods:

- <code title="post /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">create</a>(threadId, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">retrieve</a>(threadId, runId) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">update</a>(threadId, runId, { ...params }) -> Run</code>
- <code title="get /threads/{thread_id}/runs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">list</a>(threadId, { ...params }) -> RunsPage</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/cancel">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">cancel</a>(threadId, runId) -> Run</code>
- <code title="post /threads/{thread_id}/runs/{run_id}/submit_tool_outputs">client.beta.threads.runs.<a href="./src/resources/beta/threads/runs/runs.ts">submitToolOutputs</a>(threadId, runId, { ...params }) -> Run</code>

#### Steps

Types:

- <code><a href="./src/resources/beta/threads/runs/steps.ts">CodeToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">FunctionToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">MessageCreationStepDetails</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RetrievalToolCall</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">RunStep</a></code>
- <code><a href="./src/resources/beta/threads/runs/steps.ts">ToolCallsStepDetails</a></code>

Methods:

- <code title="get /threads/{thread_id}/runs/{run_id}/steps/{step_id}">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">retrieve</a>(threadId, runId, stepId) -> RunStep</code>
- <code title="get /threads/{thread_id}/runs/{run_id}/steps">client.beta.threads.runs.steps.<a href="./src/resources/beta/threads/runs/steps.ts">list</a>(threadId, runId, { ...params }) -> RunStepsPage</code>

### Messages

Types:

- <code><a href="./src/resources/beta/threads/messages/messages.ts">MessageContentImageFile</a></code>
- <code><a href="./src/resources/beta/threads/messages/messages.ts">MessageContentText</a></code>
- <code><a href="./src/resources/beta/threads/messages/messages.ts">ThreadMessage</a></code>
- <code><a href="./src/resources/beta/threads/messages/messages.ts">ThreadMessageDeleted</a></code>

Methods:

- <code title="post /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages/messages.ts">create</a>(threadId, { ...params }) -> ThreadMessage</code>
- <code title="get /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages/messages.ts">retrieve</a>(threadId, messageId) -> ThreadMessage</code>
- <code title="post /threads/{thread_id}/messages/{message_id}">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages/messages.ts">update</a>(threadId, messageId, { ...params }) -> ThreadMessage</code>
- <code title="get /threads/{thread_id}/messages">client.beta.threads.messages.<a href="./src/resources/beta/threads/messages/messages.ts">list</a>(threadId, { ...params }) -> ThreadMessagesPage</code>

#### Files

Types:

- <code><a href="./src/resources/beta/threads/messages/files.ts">MessageFile</a></code>

Methods:

- <code title="get /threads/{thread_id}/messages/{message_id}/files/{file_id}">client.beta.threads.messages.files.<a href="./src/resources/beta/threads/messages/files.ts">retrieve</a>(threadId, messageId, fileId) -> MessageFile</code>
- <code title="get /threads/{thread_id}/messages/{message_id}/files">client.beta.threads.messages.files.<a href="./src/resources/beta/threads/messages/files.ts">list</a>(threadId, messageId, { ...params }) -> MessageFilesPage</code>
