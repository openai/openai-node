# Completions

Models:

- <code><a href="./resources/completions.ts">Completion</a></code>
- <code><a href="./resources/completions.ts">CompletionChoice</a></code>

Methods:

- <code title="post /completions">client.completions.<a href="./resources/completions.ts">create</a>({ ...params }) -> Completion</code>

# Chat

## Completions

Models:

- <code><a href="./resources/chat/completions.ts">ChatCompletion</a></code>
- <code><a href="./resources/chat/completions.ts">ChatCompletionEvent</a></code>

Methods:

- <code title="post /chat/completions">client.chat.completions.<a href="./resources/chat/completions.ts">create</a>({ ...params }) -> ChatCompletion</code>

# Edits

Models:

- <code><a href="./resources/edits.ts">Edit</a></code>

Methods:

- <code title="post /edits">client.edits.<a href="./resources/edits.ts">create</a>({ ...params }) -> Edit</code>

# Embeddings

Models:

- <code><a href="./resources/embeddings.ts">Embedding</a></code>

Methods:

- <code title="post /embeddings">client.embeddings.<a href="./resources/embeddings.ts">create</a>({ ...params }) -> Embedding</code>

# Files

Models:

- <code><a href="./resources/files.ts">File</a></code>
- <code><a href="./resources/files.ts">FileListResponse</a></code>
- <code><a href="./resources/files.ts">FileDeleteResponse</a></code>
- <code><a href="./resources/files.ts">FileRetrieveFileContentResponse</a></code>

Methods:

- <code title="post /files">client.files.<a href="./resources/files.ts">create</a>({ ...params }) -> File</code>
- <code title="get /files/{file_id}">client.files.<a href="./resources/files.ts">retrieve</a>(fileId) -> File</code>
- <code title="get /files">client.files.<a href="./resources/files.ts">list</a>() -> FileListResponse</code>
- <code title="delete /files/{file_id}">client.files.<a href="./resources/files.ts">del</a>(fileId) -> FileDeleteResponse</code>
- <code title="get /files/{file_id}/content">client.files.<a href="./resources/files.ts">retrieveFileContent</a>(fileId) -> Promise<string></code>

# Images

Models:

- <code><a href="./resources/images.ts">Image</a></code>
- <code><a href="./resources/images.ts">ImagesResponse</a></code>

Methods:

- <code title="post /images/variations">client.images.<a href="./resources/images.ts">createVariation</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/edits">client.images.<a href="./resources/images.ts">edit</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/generations">client.images.<a href="./resources/images.ts">generate</a>({ ...params }) -> ImagesResponse</code>

# Audio

## Transcriptions

Models:

- <code><a href="./resources/audio/transcriptions.ts">Transcription</a></code>

Methods:

- <code title="post /audio/transcriptions">client.audio.transcriptions.<a href="./resources/audio/transcriptions.ts">create</a>({ ...params }) -> Transcription</code>

## Translations

Models:

- <code><a href="./resources/audio/translations.ts">Translation</a></code>

Methods:

- <code title="post /audio/translations">client.audio.translations.<a href="./resources/audio/translations.ts">create</a>({ ...params }) -> Translation</code>

# Answers

Models:

- <code><a href="./resources/answers.ts">AnswerCreateResponse</a></code>

Methods:

- <code title="post /answers">client.answers.<a href="./resources/answers.ts">create</a>({ ...params }) -> AnswerCreateResponse</code>

# Classifications

Models:

- <code><a href="./resources/classifications.ts">ClassificationCreateResponse</a></code>

Methods:

- <code title="post /classifications">client.classifications.<a href="./resources/classifications.ts">create</a>({ ...params }) -> ClassificationCreateResponse</code>

# Moderations

Models:

- <code><a href="./resources/moderations.ts">Moderation</a></code>
- <code><a href="./resources/moderations.ts">ModerationCreateResponse</a></code>

Methods:

- <code title="post /moderations">client.moderations.<a href="./resources/moderations.ts">create</a>({ ...params }) -> ModerationCreateResponse</code>

# Models

Models:

- <code><a href="./resources/models.ts">DeleteModelResponse</a></code>
- <code><a href="./resources/models.ts">ListModelsResponse</a></code>
- <code><a href="./resources/models.ts">Model</a></code>

Methods:

- <code title="get /models/{model}">client.models.<a href="./resources/models.ts">retrieve</a>(model) -> Model</code>
- <code title="get /models">client.models.<a href="./resources/models.ts">list</a>() -> ListModelsResponse</code>
- <code title="delete /models/{model}">client.models.<a href="./resources/models.ts">del</a>(model) -> DeleteModelResponse</code>

# FineTunes

Models:

- <code><a href="./resources/fine-tunes.ts">FineTune</a></code>
- <code><a href="./resources/fine-tunes.ts">FineTuneEvent</a></code>
- <code><a href="./resources/fine-tunes.ts">ListFineTuneEventsResponse</a></code>
- <code><a href="./resources/fine-tunes.ts">ListFineTunesResponse</a></code>

Methods:

- <code title="post /fine-tunes">client.fineTunes.<a href="./resources/fine-tunes.ts">create</a>({ ...params }) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}">client.fineTunes.<a href="./resources/fine-tunes.ts">retrieve</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes">client.fineTunes.<a href="./resources/fine-tunes.ts">list</a>() -> ListFineTunesResponse</code>
- <code title="post /fine-tunes/{fine_tune_id}/cancel">client.fineTunes.<a href="./resources/fine-tunes.ts">cancel</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}/events">client.fineTunes.<a href="./resources/fine-tunes.ts">listEvents</a>(fineTuneId, { ...params }) -> ListFineTuneEventsResponse</code>
