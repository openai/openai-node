# Browser WebRTC helpers

Use `OpenAILiveWebRTC` or `OpenAIRealtimeWebRTC` to connect browser audio and
receive typed API events. The helper handles connection setup; your app supplies
the microphone, audio playback, and a backend endpoint for exchanging SDP.

## Connect

This example assumes you have a `microphoneStream`, a `playRemoteAudio` handler
that attaches incoming audio to your player, and an `appendTranscript` function
that displays the speaker and text.

```ts
import { OpenAILiveWebRTC } from 'openai/live/webrtc';

const live = new OpenAILiveWebRTC();
for (const track of microphoneStream.getTracks()) {
  live.peerConnection.addTrack(track, microphoneStream);
}
live.peerConnection.addEventListener('track', playRemoteAudio);
live.on('session.input_transcript.delta', ({ delta }) => {
  appendTranscript('user', delta);
});
live.on('session.output_transcript.delta', ({ delta }) => {
  appendTranscript('assistant', delta);
});

await live.connect({
  exchangeSdp: async (offer, { signal }) => {
    const response = await fetch('/session/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer,
      signal,
    });
    if (!response.ok) throw new Error(`Signaling failed: ${response.status}`);
    return response.text();
  },
});
```

Keep your API key on the backend. Your `/session/live` endpoint calls
`client.live.create({ transport: { type: 'webrtc', sdp: offer }, session }, { maxRetries: 0 })`
and returns `result.transport.sdp`. Use `result.session.id` to attach a backend
`SidebandWS` connection before returning the answer. Configure the session's
`client.data_channel` permissions for the untrusted browser; keep application
commands and Responses delegation on the trusted sideband. Protect that endpoint with your app's authentication and
usage controls.

For Realtime, import `OpenAIRealtimeWebRTC` from `openai/realtime/webrtc` and have
your backend use `client.realtime.calls.create`. The connection pattern is the same.

## Receive events

Use `on(eventName, handler)` to subscribe to one server event. The event name
determines the handler's payload type, so no type checks or casts are needed:

```ts
const unsubscribe = live.on('session.delegation.created', ({ delegation }) => {
  void handleDelegation(delegation).catch(handleApplicationError);
});

live.on('error', ({ error }) => {
  showAPIError(error.code ?? error.type);
});

// Stop just this subscription when it is no longer needed.
unsubscribe();
```

Event names and payloads come from the generated API types. New server events
become available when those types are updated; there is no separate event list
to maintain. An SDK built before a new event was introduced cannot infer that
event's payload yet.

Keep `onEvent(handler)` when you need every server event, including unknown
future event names. For chat bubbles, feed that stream into
[`TranscriptGrouper`](../examples/live/README.md). Named and catch-all handlers
run synchronously in registration order and are not awaited. A thrown exception
or rejected handler promise is reported through the host's uncaught-error
mechanism without blocking other handlers or closing the connection.

Each subscription returns an independent, idempotent unsubscribe function.
Closing the helper releases all subscriptions. Events are not replayed.
Use `send(event)` to send typed client events after connecting.

`connect()` rejects if setup fails. Use `onConnectionEvent` to update your UI
when the connection closes or encounters a local transport error. These
notifications are separate from the raw API events received by `on('error', ...)`.

## Disconnect

Close the connection and stop the microphone when the user leaves the session:

```ts
live.close();
microphoneStream.getTracks().forEach((track) => track.stop());
```

Create a new helper for each connection. The helper does not reconnect automatically.

## Use an existing data channel

If your app already handles WebRTC negotiation, wrap its data channel to get
typed Live events:

```ts
import { LiveDataChannel } from 'openai/live/webrtc';

const live = new LiveDataChannel(peer.createDataChannel('oai-events'));
live.on('session.input_transcript.delta', ({ delta }) => {
  appendTranscript('user', delta);
});
// Once the channel is open, use live.send(event) to send client events.
```

Use `RealtimeDataChannel` from `openai/realtime/webrtc` for Realtime.
Call `dispose()` to remove the adapter's listeners; your app still closes the
channel and peer connection.
