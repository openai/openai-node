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

socket.on('response.completed', (event) => {
  console.log('\nResponse ID:', event.response.id);
  socket.close();
});

socket.send({
  type: 'response.create',
  model: 'gpt-5.5',
  input: 'Explain the difference between SSE and WebSockets.',
  stream: true,
});
```

The connection inherits authentication and endpoint configuration from the `OpenAI` client. Attach an `error` listener;
unhandled WebSocket errors otherwise become unhandled promise rejections. You can also iterate over `socket` or
`socket.stream()` to receive connection lifecycle events and server messages.

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
