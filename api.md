# Completions

Types:

- <code><a href="./resources/completions.ts">Completion</a></code>
- <code><a href="./resources/completions.ts">CompletionChoice</a></code>

Methods:

- <code title="post /completions">client.completions.<a href="./resources/completions.ts">create</a>({ ...params }) -> Completion</code>

# Chat

## Completions

Types:

- <code><a href="./resources/chat/completions.ts">ChatCompletion</a></code>
- <code><a href="./resources/chat/completions.ts">ChatCompletionChunk</a></code>

Methods:

- <code title="post /chat/completions">client.chat.completions.<a href="./resources/chat/completions.ts">create</a>({ ...params }) -> ChatCompletion</code>

# Edits

Types:

- <code><a href="./resources/edits.ts">Edit</a></code>

Methods:

- <code title="post /edits">client.edits.<a href="./resources/edits.ts">create</a>({ ...params }) -> Edit</code>

# Embeddings

Types:

- <code><a href="./resources/embeddings.ts">Embedding</a></code>

Methods:

- <code title="post /embeddings">client.embeddings.<a href="./resources/embeddings.ts">create</a>({ ...params }) -> Embedding</code>

# Files

Types:

- <code><a href="./resources/files.ts">FileContent</a></code>
- <code><a href="./resources/files.ts">FileDeleted</a></code>
- <code><a href="./resources/files.ts">FileObject</a></code>

Methods:

- <code title="post /files">client.files.<a href="./resources/files.ts">create</a>({ ...params }) -> FileObject</code>
- <code title="get /files/{file_id}">client.files.<a href="./resources/files.ts">retrieve</a>(fileId) -> FileObject</code>
- <code title="get /files">client.files.<a href="./resources/files.ts">list</a>() -> FileObjectsPage</code>
- <code title="delete /files/{file_id}">client.files.<a href="./resources/files.ts">del</a>(fileId) -> FileDeleted</code>
- <code title="get /files/{file_id}/content">client.files.<a href="./resources/files.ts">retrieveFileContent</a>(fileId) -> string</code>

# Images

Types:

- <code><a href="./resources/images.ts">Image</a></code>
- <code><a href="./resources/images.ts">ImagesResponse</a></code>

Methods:

- <code title="post /images/variations">client.images.<a href="./resources/images.ts">createVariation</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/edits">client.images.<a href="./resources/images.ts">edit</a>({ ...params }) -> ImagesResponse</code>
- <code title="post /images/generations">client.images.<a href="./resources/images.ts">generate</a>({ ...params }) -> ImagesResponse</code>

# Audio

## Transcriptions

Types:

- <code><a href="./resources/audio/transcriptions.ts">Transcription</a></code>

Methods:

- <code title="post /audio/transcriptions">client.audio.transcriptions.<a href="./resources/audio/transcriptions.ts">create</a>({ ...params }) -> Transcription</code>

## Translations

Types:

- <code><a href="./resources/audio/translations.ts">Translation</a></code>

Methods:

- <code title="post /audio/translations">client.audio.translations.<a href="./resources/audio/translations.ts">create</a>({ ...params }) -> Translation</code>

# Moderations

Types:

- <code><a href="./resources/moderations.ts">Moderation</a></code>
- <code><a href="./resources/moderations.ts">ModerationCreateResponse</a></code>

Methods:

- <code title="post /moderations">client.moderations.<a href="./resources/moderations.ts">create</a>({ ...params }) -> ModerationCreateResponse</code>

# Models

Types:

- <code><a href="./resources/models.ts">Model</a></code>
- <code><a href="./resources/models.ts">ModelDeleted</a></code>

Methods:

- <code title="get /models/{model}">client.models.<a href="./resources/models.ts">retrieve</a>(model) -> Model</code>
- <code title="get /models">client.models.<a href="./resources/models.ts">list</a>() -> ModelsPage</code>
- <code title="delete /models/{model}">client.models.<a href="./resources/models.ts">del</a>(model) -> ModelDeleted</code>

# FineTunes

Types:

- <code><a href="./resources/fine-tunes.ts">FineTune</a></code>
- <code><a href="./resources/fine-tunes.ts">FineTuneEvent</a></code>
- <code><a href="./resources/fine-tunes.ts">FineTuneEventsListResponse</a></code>

Methods:

- <code title="post /fine-tunes">client.fineTunes.<a href="./resources/fine-tunes.ts">create</a>({ ...params }) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}">client.fineTunes.<a href="./resources/fine-tunes.ts">retrieve</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes">client.fineTunes.<a href="./resources/fine-tunes.ts">list</a>() -> FineTunesPage</code>
- <code title="post /fine-tunes/{fine_tune_id}/cancel">client.fineTunes.<a href="./resources/fine-tunes.ts">cancel</a>(fineTuneId) -> FineTune</code>
- <code title="get /fine-tunes/{fine_tune_id}/events">client.fineTunes.<a href="./resources/fine-tunes.ts">listEvents</a>(fineTuneId, { ...params }) -> FineTuneEventsListResponse</code>
