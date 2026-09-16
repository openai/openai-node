# Responses API

The Responses API is the recommended interface for generating model responses. It accepts text, images, and other input
items, supports built-in and custom tools, and returns a response containing ordered output items.

```ts
import OpenAI from 'openai';

const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5.5',
  instructions: 'Answer clearly and briefly.',
  input: 'What makes a promise settle?',
});

console.log(response.output_text);
```

`response.output_text` combines the response's text output. Use `response.output` when you need the underlying message,
reasoning, or tool-call items. See the [API reference](../api.md) for the complete request and response types.

## Continue a conversation

Pass `previous_response_id` when the API should use a previous response as context:

```ts
const first = await client.responses.create({
  model: 'gpt-5.5',
  instructions: 'Answer clearly and briefly.',
  input: 'What is a JavaScript promise?',
});

const next = await client.responses.create({
  model: 'gpt-5.5',
  instructions: 'Answer clearly and briefly.',
  previous_response_id: first.id,
  input: 'How does that differ from an async function?',
});

console.log(next.output_text);
```

Previous `instructions` are not automatically carried forward when using `previous_response_id`; provide them again when
they should apply to the next response. `previous_response_id` cannot be combined with the `conversation` parameter.

### Manage conversation history yourself

When you provide the full history to each request, preserve the complete ordered output from prior responses. Filtering
the output down to assistant messages can discard reasoning and tool-call items that later turns require.

```ts
import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

const client = new OpenAI();
const input: ResponseInputItem[] = [{ role: 'user', content: 'Write a short Python prime checker.' }];

const first = await client.responses.create({ model: 'gpt-5.5', input });

input.push(...toResponseInputItems(first.output));
input.push({ role: 'user', content: 'Add type hints.' });

const next = await client.responses.create({ model: 'gpt-5.5', input });
console.log(next.output_text);
```

`toResponseInputItems()` normalizes replayable response output into valid input items while preserving their order. See
the [manual conversation state example](../examples/responses/manual-conversation-state.ts).

## Background responses

Set `background: true` for a response that should continue running after the initial request returns. Save its ID to
check its status or retrieve its output later:

```ts
const started = await client.responses.create({
  model: 'gpt-5.5',
  input: 'Analyze the supplied requirements and propose an implementation.',
  background: true,
});

const latest = await client.responses.retrieve(started.id);
console.log(latest.status);

if (latest.status === 'completed') {
  console.log(latest.output_text);
}
```

Cancel an in-progress background response with its ID:

```ts
const cancelled = await client.responses.cancel(started.id);
console.log(cancelled.status);
```

Only responses created with `background: true` can be cancelled. Background responses can also be streamed and resumed;
see [Streaming responses](streaming.md#resume-a-background-response).

## Responses over WebSocket

The Responses API also supports a persistent WebSocket connection for sending `response.create` events and receiving the
same response lifecycle and output events. This is a different API from the [Realtime API](realtime.md), which has its own
client, session model, and event protocol.

The Node.js WebSocket helper requires the optional `ws` peer dependency:

```sh
npm install ws
npm install --save-dev @types/ws
```

```ts
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';

const client = new OpenAI();
const socket = new ResponsesWS(client);

socket.on('error', (error) => {
  console.error('Responses WebSocket error:', error);
});

socket.on('response.output_text.delta', (event) => {
  process.stdout.write(event.delta);
});

socket.on('event', (event) => {
  if (
    event.type !== 'response.completed' &&
    event.type !== 'response.failed' &&
    event.type !== 'response.incomplete'
  ) {
    return;
  }

  if (event.type === 'response.completed') {
    console.log('\nResponse ID:', event.response.id);
  } else {
    const details = event.response.error ?? event.response.incomplete_details;
    console.error(`\n${event.type}:`, details ?? 'No additional details.');
  }

  socket.close();
});

socket.send({
  type: 'response.create',
  model: 'gpt-5.5',
  input: 'Explain the difference between SSE and WebSockets.',
  stream: true,
});
```

The connection inherits endpoint configuration from the `OpenAI` client and automatically adds authentication only
when the client has a static `apiKey` string. It does not resolve async `apiKey` functions or workload identity; for
those clients, pass a resolved `Authorization` header in the WebSocket options. A function-backed client can also
reuse a key already resolved by a previous request. For function-backed clients without a resolved key or
caller-supplied credential, the Node constructor throws before opening a socket. Compatible endpoints can use
custom credential headers or the Node `ws` transport's `auth` option. Custom `ResponsesWSBase` transports are
responsible for supplying or validating their final authentication in `_createSocket`; the base cannot inspect
transport-managed credentials.

Attach an `error` listener; unhandled WebSocket errors otherwise become unhandled promise rejections. You can also
iterate over `socket` or `socket.stream()` to receive connection lifecycle events and server messages.

Each iterator buffers incoming records independently. To limit an iterator's backlog, pass a positive safe integer
to `socket.stream({ maxBufferedEvents: 256 })`; choose the count for your application's processing capacity.
Omitting the option leaves buffering unlimited, including when iterating over `socket` directly. This option is
also available on the beta Responses and Live WebSocket streams.

The count includes messages, raw data, errors, and lifecycle records such as the initial connection state,
reconnecting, and close. If the next record would exceed the limit, the iterator discards its backlog, removes
its listeners, and rejects its `next()` calls with a `WebSocketError`. A close record can overflow a full queue.
The socket and other iterators remain active; close the socket yourself when you no longer need it. The limit
continues across reconnects and does not restart a failed iterator. It limits event count, not payload bytes
or total memory: one large message still counts as one record.

For additional headers, including feature-specific beta headers when required, pass WebSocket options to the constructor:

```ts
const socket = new ResponsesWS(client, {
  headers: { 'OpenAI-Beta': 'responses_websockets=2026-02-06' },
});
```

See the [complete Responses WebSocket example](../examples/responses/websocket.ts) for multi-turn conversations, tool
calls, and connection handling.

## Related guides

- [Streaming responses](streaming.md)
- [Structured outputs](structured-outputs.md)
- [Function calling and tools](tools.md)
- [Realtime API](realtime.md)
