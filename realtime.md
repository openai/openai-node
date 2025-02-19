## Realtime API beta

The Realtime API enables you to build low-latency, multi-modal conversational experiences. It currently supports text and audio as both input and output, as well as [function calling](https://platform.openai.com/docs/guides/function-calling) through a `WebSocket` connection.

The Realtime API works through a combination of client-sent events and server-sent events. Clients can send events to do things like update session configuration or send text and audio inputs. Server events confirm when audio responses have completed, or when a text response from the model has been received. A full event reference can be found [here](https://platform.openai.com/docs/api-reference/realtime-client-events) and a guide can be found [here](https://platform.openai.com/docs/guides/realtime).

This SDK supports accessing the Realtime API through the [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) or with [ws](https://github.com/websockets/ws).

Basic text based example with `ws`:

```ts
// requires `yarn add ws @types/ws`
import { OpenAIRealtimeWS } from 'openai/beta/realtime/ws';

const rt = new OpenAIRealtimeWS({ model: 'gpt-4o-realtime-preview-2024-12-17' });

// access the underlying `ws.WebSocket` instance
rt.socket.on('open', () => {
  console.log('Connection opened!');
  rt.send({
    type: 'session.update',
    session: {
      modalities: ['text'],
      model: 'gpt-4o-realtime-preview',
    },
  });

  rt.send({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Say a couple paragraphs!' }],
    },
  });

  rt.send({ type: 'response.create' });
});

rt.on('error', (err) => {
  // in a real world scenario this should be logged somewhere as you
  // likely want to continue procesing events regardless of any errors
  throw err;
});

rt.on('session.created', (event) => {
  console.log('session created!', event.session);
  console.log();
});

rt.on('response.text.delta', (event) => process.stdout.write(event.delta));
rt.on('response.text.done', () => console.log());

rt.on('response.done', () => rt.close());

rt.socket.on('close', () => console.log('\nConnection closed!'));
```

To use the web API `WebSocket` implementation, replace `OpenAIRealtimeWS` with `OpenAIRealtimeWebSocket` and adjust any `rt.socket` access:

```ts
import { OpenAIRealtimeWebSocket } from 'openai/beta/realtime/websocket';

const rt = new OpenAIRealtimeWebSocket({ model: 'gpt-4o-realtime-preview-2024-12-17' });
// ...
rt.socket.addEventListener('open', () => {
 // ...
});
```

A full example can be found [here](https://github.com/openai/openai-node/blob/master/examples/realtime/websocket.ts).

### Realtime error handling

When an error is encountered, either on the client side or returned from the server through the [`error` event](https://platform.openai.com/docs/guides/realtime-model-capabilities#error-handling), the `error` event listener will be fired. However, if you haven't registered an `error` event listener then an `unhandled Promise rejection` error will be thrown.

It is **highly recommended** that you register an `error` event listener and handle errors approriately as typically the underlying connection is still usable.

```ts
const rt = new OpenAIRealtimeWS({ model: 'gpt-4o-realtime-preview-2024-12-17' });
rt.on('error', (err) => {
  // in a real world scenario this should be logged somewhere as you
  // likely want to continue procesing events regardless of any errors
  throw err;
});
```

