# Realtime API

The Realtime API enables you to build low-latency, multi-modal conversational experiences. It currently supports text and audio as both input and output, as well as [function calling](https://platform.openai.com/docs/guides/function-calling) through a `WebSocket` connection.

The Realtime API works through a combination of client-sent events and server-sent events. Clients can send events to do things like update session configuration or send text and audio inputs. Server events confirm when audio responses have completed, or when a text response from the model has been received. A full event reference can be found [here](https://platform.openai.com/docs/api-reference/realtime-client-events) and a guide can be found [here](https://platform.openai.com/docs/guides/realtime).

This SDK supports accessing the Realtime API through the [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) or with [ws](https://github.com/websockets/ws).

Basic text based example with `ws`:

```ts
// requires `yarn add ws @types/ws`
import { OpenAIRealtimeWS } from 'openai/realtime/ws';

const rt = new OpenAIRealtimeWS({ model: 'gpt-realtime' });

// access the underlying `ws.WebSocket` instance
rt.socket.on('open', () => {
  console.log('Connection opened!');
  rt.send({
    type: 'session.update',
    session: {
      output_modalities: ['text'],
      type: 'realtime',
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
  console.error('Realtime error:', err);
});

rt.on('session.created', (event) => {
  console.log('session created!', event.session);
  console.log();
});

rt.on('response.output_text.delta', (event) => process.stdout.write(event.delta));
rt.on('response.output_text.done', () => console.log());

rt.on('response.done', () => rt.close());

rt.socket.on('close', () => console.log('\nConnection closed!'));
```

To use the web API `WebSocket` implementation, replace `OpenAIRealtimeWS` with `OpenAIRealtimeWebSocket` and adjust any `rt.socket` access:

```ts
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';

const rt = new OpenAIRealtimeWebSocket({ model: 'gpt-realtime' });
// ...
rt.socket.addEventListener('open', () => {
  // ...
});
```

To attach to an in-progress WebRTC or SIP call over a sideband control connection, pass `callID` instead of `model`:

```ts
import { OpenAIRealtimeWS } from 'openai/realtime/ws';

const rt = new OpenAIRealtimeWS({ callID: 'rtc_123456' });
```

To start a transcription-only session, pass `intent: 'transcription'` instead of a model:

```ts
const rt = new OpenAIRealtimeWS({ intent: 'transcription' });
```

Azure transcription sessions also use transcription intent. Do not pass a deployment in the connection options; configure the transcription deployment in a `session.update` event after the socket opens:

```ts
const rt = await OpenAIRealtimeWS.azure(azureClient, { intent: 'transcription' });

rt.socket.on('open', () => {
  rt.send({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription: { model: 'your-transcription-deployment' },
        },
      },
    },
  });
});
```

`model`, `callID`, and transcription `intent` are mutually exclusive. Azure transcription sessions must not include a `deploymentName`. The web `WebSocket` helper supports the same connection options.

For an Azure Realtime GA call, pass `callID` to the Azure factory instead:

```ts
const rt = await OpenAIRealtimeWS.azure(azureClient, { callID: 'rtc_123456' });
```

To connect to a deployment that requires an exact WebSocket URL, such as SAP AI Core, provide a `buildRealtimeURL` callback. Both `OpenAIRealtimeWS` and `OpenAIRealtimeWebSocket` accept this option in their constructors, `create()` factories, and Azure factories:

```ts
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';

const client = new OpenAI();
const rt = await OpenAIRealtimeWS.create(client, {
  model: 'gpt-realtime',
  buildRealtimeURL: () =>
    new URL('wss://sap-ai-core.example.com/v2/inference/deployments/my-deployment/realtime'),
});
```

The callback receives the client and validated connection target and returns the final `wss:` URL. Exactly one of `model`, `callID`, or transcription `intent` is still required, but the SDK does not add routing parameters such as `model` to the returned URL. Use only a trusted endpoint because connection credentials are sent to it. For native Azure WebSocket connections, the required authentication query parameter is still added before connecting and redacted from the exposed URL afterward.

A full example can be found in [`examples/realtime/websocket.ts`](../examples/realtime/websocket.ts).

### Realtime error handling

When an error is encountered, either on the client side or returned from the server through the [`error` event](https://platform.openai.com/docs/guides/realtime-model-capabilities#error-handling), the `error` event listener will be fired. However, if you haven't registered an `error` event listener then an `unhandled Promise rejection` error will be thrown.

It is **highly recommended** that you register an `error` event listener and handle errors appropriately as typically the underlying connection is still usable.

```ts
const rt = new OpenAIRealtimeWS({ model: 'gpt-realtime' });
rt.on('error', (err) => {
  console.error('Realtime error:', err);
});
```
