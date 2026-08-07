# Streaming responses

The Responses API streams server-sent events (SSE) as the model produces output. Use `responses.create({ stream: true })`
when you want the raw event iterator, or `responses.stream()` when you also want typed event listeners, accumulated
snapshots, and the completed response.

## Iterate over raw events

Passing `stream: true` returns an async iterable of response events:

```ts
import OpenAI from 'openai';

const client = new OpenAI();

const stream = await client.responses.create({
  model: 'gpt-5.5',
  input: 'Explain how HTTP streaming works.',
  stream: true,
});

for await (const event of stream) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  }

  if (event.type === 'response.completed') {
    console.log('\nResponse ID:', event.response.id);
  }
}
```

Raw streams can only be consumed once. Use `stream.tee()` when two independent consumers must receive the same events.

## Use the accumulated streaming helper

`responses.stream()` returns immediately and begins the request asynchronously. Register listeners or iterate over its
events, then call `finalResponse()` to access the complete accumulated response:

```ts
const stream = client.responses
  .stream({
    model: 'gpt-5.5',
    input: 'List three reasons to use TypeScript.',
  })
  .on('response.output_text.delta', (event) => {
    process.stdout.write(event.delta);
  })
  .on('response.completed', (event) => {
    console.log('\nCompleted:', event.response.id);
  });

const response = await stream.finalResponse();
console.log(response.output_text);
```

Text delta listeners also receive `event.snapshot`, containing all text accumulated for that output content part. Tool
argument delta listeners receive the same additional snapshot field:

```ts
stream.on('response.output_text.delta', (event) => {
  console.log('Latest delta:', event.delta);
  console.log('Text so far:', event.snapshot);
});

stream.on('response.function_call_arguments.delta', (event) => {
  console.log('Arguments so far:', event.snapshot);
});
```

Use `.on('event', listener)` to observe every server event, or `for await (const event of stream)` to process events
sequentially. `finalResponse()` waits for stream consumption to finish and returns the latest accumulated response
snapshot. Check the returned response's `status` before treating it as complete: network, request, and abort errors
reject, but a clean EOF can resolve with a partial response whose status is not `completed`.

See the [Responses streaming example](../examples/responses/stream.ts) and the
[streamed tools example](../examples/responses/streaming-tools.ts).

## Handle errors and cancellation

Wrap stream iteration or `finalResponse()` in `try`/`catch` to handle request and stream errors:

```ts
const stream = client.responses.stream({
  model: 'gpt-5.5',
  input: 'Describe cooperative cancellation.',
});

try {
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      process.stdout.write(event.delta);
    }
  }

  await stream.finalResponse();
} catch (error) {
  if (error instanceof OpenAI.APIUserAbortError) {
    console.log('The stream was cancelled.');
  } else {
    throw error;
  }
}
```

Call `stream.abort()` to stop the helper, or pass an `AbortSignal` as a request option:

```ts
const controller = new AbortController();

const stream = client.responses.stream(
  { model: 'gpt-5.5', input: 'Write a detailed implementation plan.' },
  { signal: controller.signal },
);

controller.abort();
```

Breaking out of a `for await` loop also aborts the in-progress request. For a raw `responses.create()` stream, use
`stream.controller.abort()`.

## Resume a background response

Create the original response with `background: true` so it can continue if the first stream disconnects. Track its
response ID and the latest event sequence number:

```ts
const initial = client.responses.stream({
  model: 'gpt-5.5',
  input: 'Produce a comprehensive migration plan.',
  background: true,
});

let responseId: string | undefined;
let lastSequenceNumber = -1;

for await (const event of initial) {
  lastSequenceNumber = event.sequence_number;

  if (event.type === 'response.created') {
    responseId = event.response.id;
  }

  if (event.sequence_number === 10) {
    break;
  }
}

if (!responseId) {
  throw new Error('The response ID was not received.');
}

const resumed = client.responses.stream({
  response_id: responseId,
  starting_after: lastSequenceNumber,
});

for await (const event of resumed) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  }
}

const completed = await resumed.finalResponse();
console.log(completed.output_text);
```

`starting_after` suppresses events that the application has already handled. The helper still replays earlier events
internally so snapshots and `finalResponse()` include the entire response. When resuming a response that used parsed
tools or structured output, provide the same `tools` or `text` configuration to the resumed helper.

For raw events without accumulation, stream a stored response directly:

```ts
const stream = await client.responses.retrieve(responseId, {
  stream: true,
  starting_after: lastSequenceNumber,
});
```

See the [background streaming example](../examples/responses/stream_background.ts).

## Forward events to a browser

Keep your API key on the server and proxy the response stream to the browser. Raw response streams expose
`toReadableStream()`, which encodes events as newline-separated JSON:

```ts
export async function POST(request: Request) {
  const { input } = await request.json();

  const stream = await client.responses.create({
    model: 'gpt-5.5',
    input,
    stream: true,
  });

  return new Response(stream.toReadableStream(), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
```

Reconstruct an accumulated Responses stream from the HTTP response body:

```ts
import { ResponseStream } from 'openai/lib/responses/ResponseStream';

const response = await fetch('/api/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: 'Explain streaming in one sentence.' }),
});

if (!response.ok || !response.body) {
  throw new Error(`Streaming request failed: ${response.status}`);
}

const stream = ResponseStream.fromReadableStream(response.body);

stream.on('response.output_text.delta', (event) => {
  console.log(event.delta);
});

const final = await stream.finalResponse();
console.log(final.output_text);
```

`ResponseStream.fromReadableStream()` expects newline-separated JSON, not the API's original SSE wire format. For an
Express server, write each text delta directly or forward the encoded readable stream; see the
[raw proxy example](../examples/chat-completions/stream-to-client-raw.ts) and
[Express proxy example](../examples/chat-completions/stream-to-client-express.ts).

## Related guides

- [Responses API](responses.md)
- [Structured outputs](structured-outputs.md)
- [Function calling and tools](tools.md)
- [Client configuration and error handling](configuration.md)
