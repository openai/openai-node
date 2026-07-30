# File uploads

Upload methods accept several file representations, including standard web
`File` objects, `fetch` responses, Node.js file streams, and the SDK's `toFile`
and `toStreamingFile` helpers.

## Upload a local file

In Node.js, pass an `fs.ReadStream` directly. The SDK derives the filename from
the stream's path:

```ts
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';

const client = new OpenAI();

const file = await client.files.create({
  file: createReadStream('training.jsonl'),
  purpose: 'fine-tune',
});

console.log(file.id);
```

The `purpose` must match the intended API workflow. Available values include
`fine-tune`, `batch`, `assistants`, `vision`, `user_data`, and `evals`.

For a complete runnable workflow, see the
[fine-tuning example](../examples/fine-tuning.ts).

## Upload a web File or fetch Response

Standard `File` objects work across runtimes that implement the web File API:

```ts
const file = new File(['{"messages": []}\n'], 'training.jsonl', {
  type: 'application/jsonl',
});

await client.files.create({ file, purpose: 'fine-tune' });
```

You can also pass a `fetch` response directly:

```ts
const response = await fetch('https://example.com/training.jsonl');
if (!response.ok) throw new Error(`Download failed: ${response.status}`);

await client.files.create({
  file: response,
  purpose: 'fine-tune',
});
```

A directly supplied response is read into a `File` before the upload is sent.
For a large remote file, wrap `response.body` with `toStreamingFile` instead to
avoid buffering the entire response in memory.

## Create a File with `toFile`

Use `toFile` for in-memory bytes, blobs, responses, or async iterables when you
need a standard, replayable `File`:

```ts
import OpenAI, { toFile } from 'openai';

const client = new OpenAI();
const bytes = new TextEncoder().encode('{"messages": []}\n');

const file = await toFile(bytes, 'training.jsonl', {
  type: 'application/jsonl',
});

await client.files.create({ file, purpose: 'fine-tune' });
```

`toFile` can infer a filename from an existing `File`, a response URL, or a
Node.js stream path. For anonymous byte arrays and streams, pass an explicit
filename. Set `type` when the API or downstream tooling depends on a particular
MIME type.

Creating a `File` consumes stream inputs completely, so `toFile` buffers their
contents in memory. Existing `File` instances are returned without copying.

See the [audio example](../examples/audio.ts) for uploads constructed from
in-memory audio data.

## Stream a file with `toStreamingFile`

Use `toStreamingFile` when a web `ReadableStream`, Node.js readable stream, or
async iterable should be uploaded without first collecting its contents:

```ts
import { createReadStream } from 'node:fs';
import OpenAI, { toStreamingFile } from 'openai';

const client = new OpenAI();

await client.files.create({
  file: toStreamingFile(createReadStream('large.jsonl'), 'large.jsonl', {
    type: 'application/jsonl',
  }),
  purpose: 'batch',
});
```

To forward a remote response without buffering it:

```ts
const response = await fetch('https://example.com/large.jsonl');
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status}`);
}

await client.files.create({
  file: toStreamingFile(response.body, 'large.jsonl', {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  }),
  purpose: 'batch',
});
```

`toStreamingFile` requires a nonempty filename. Its optional `type` controls the
multipart part's `Content-Type` and defaults to `application/octet-stream`.

### Streaming and retries

Streaming multipart request bodies are consumed as they are sent and cannot be
replayed. The SDK therefore does not automatically retry streamed uploads,
including requests created with `toStreamingFile` or an `fs.ReadStream`. This
also prevents workload-identity authentication from repeating a streamed upload
after a `401`.

If automatic retries matter more than memory usage, buffer the data first with
`toFile` or provide an existing `File`. Otherwise, implement retries by opening
a new stream and starting a new upload attempt.

## Wait for file processing

Some uploaded files require additional processing before they can be used. Poll
an existing file with `files.waitForProcessing`:

```ts
const processed = await client.files.waitForProcessing('file_123', {
  pollInterval: 1_000,
  maxWait: 10 * 60 * 1_000,
});

if (processed.status !== 'processed') {
  throw new Error(`File processing ${processed.status}`);
}
```

The default interval is five seconds and the default maximum wait is 30 minutes.
The helper returns for terminal `processed` or `error` states; check the returned
status before using the file.

## Vector-store uploads

To upload a file, attach it to a vector store, and wait until processing reaches
a terminal state, use `vectorStores.files.uploadAndPoll`:

```ts
import { createReadStream } from 'node:fs';

const file = await client.vectorStores.files.uploadAndPoll('vs_123', createReadStream('handbook.pdf'), {
  pollIntervalMs: 1_000,
});

if (file.status !== 'completed') {
  throw new Error(file.last_error?.message ?? `File processing ${file.status}`);
}
```

Polling returns files in terminal states, including failures; inspect `status`
and `last_error` before assuming ingestion succeeded. Vector-store polling uses
the interval suggested by the API, or five seconds when none is provided;
`pollIntervalMs` overrides that interval.

### Upload multiple files

`vectorStores.fileBatches.uploadAndPoll` uploads files concurrently, attaches
them to a vector store, and waits for the batch to finish. Upload concurrency
defaults to five and can be customized:

```ts
const batch = await client.vectorStores.fileBatches.uploadAndPoll(
  'vs_123',
  {
    files: [createReadStream('handbook.pdf'), createReadStream('policies.pdf')],
    fileIds: ['file_already_uploaded'],
  },
  { maxConcurrency: 2 },
);

if (batch.file_counts.failed > 0) {
  throw new Error(`${batch.file_counts.failed} files failed processing`);
}
```

Use `vectorStores.files.createAndPoll` or
`vectorStores.fileBatches.createAndPoll` when files have already been uploaded
and you only need to attach and process their IDs. These polling helpers accept
`pollIntervalMs` in their request options:

```ts
const batch = await client.vectorStores.fileBatches.createAndPoll(
  'vs_123',
  { file_ids: ['file_123', 'file_456'] },
  { pollIntervalMs: 1_000 },
);

console.log(batch.status, batch.file_counts);
```

See [Polling Helpers](helpers.md#polling-helpers) for related SDK helpers and
[Amazon Bedrock](bedrock.md#aws-credentials-and-sigv4) for restrictions on
SigV4-signed request bodies.
