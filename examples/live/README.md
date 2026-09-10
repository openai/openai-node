# Turn a Live transcript into chat bubbles

Live conversations don't have fixed turns: the user and assistant can speak at
the same time and interrupt each other. A chat UI still needs readable user and
assistant bubbles. `TranscriptGrouper` groups the incoming transcript fragments
into those display segments and updates them as text arrives.

```ts
import { TranscriptGrouper } from 'openai/helpers/live';

const transcript = new TranscriptGrouper();
transcript.on('segment.updated', (segment) => {
  // Replace the bubble's text; this event carries the complete immutable snapshot.
  renderBubble(segment.id, segment.speaker, segment.text);
});
transcript.on('segment.closed', ({ segment, reason }) => {
  finalizeBubble(segment.id, reason);
});
```

Feed incoming Live events to `transcript.push(event)`. For example, with the
[WebRTC helper](../../docs/webrtc.md):

```ts
const unsubscribe = live.onEvent((event) => transcript.push(event));

// When the session ends:
unsubscribe();
transcript.close();
```

With a Live WebSocket, forward events from `live.on('event', ...)` instead.
Create one grouper per session and call `close()` on disconnect to finalize
pending bubbles.

For individual WebRTC events, use named subscriptions such as
`live.on('session.delegation.created', ({ delegation }) => handleDelegation(delegation))`. The
grouper intentionally uses `onEvent` to receive the complete Live event stream.

Each segment has a stable ID for updating its bubble. `segment.closed` means
the bubble's text is final; it does not mean audio playback has finished.

By default, brief overlapping acknowledgments such as “mhm” may be omitted to
keep the conversation readable. Set `backchannelMaxDurationMs: 0` when creating
the grouper to keep them. Retain the raw events separately if you need a full
transcript.

## Try the example

The example plays a conversation with an interruption and prints the grouped
bubbles. It makes paid API calls, uses AI-generated voices, and requires access
to the Live model. From this SDK checkout, with `OPENAI_API_KEY` set:

```sh
pnpm tsn -T examples/live/transcript-grouper.ts
```

Audio playback requires `ffplay` on your `PATH`. To run without playback, add
`--no-audio`.

## WebRTC with a backend sideband

See [webrtc-browser.mjs](webrtc-browser.mjs) for browser media, data-channel events,
and transcript grouping. Your backend accepts the SDP offer and calls
`client.live.create({ session, transport: { type: 'webrtc', sdp } }, { maxRetries: 0 })`.
Use `result.session.id` to attach a trusted `SidebandWS` before returning
`result.transport.sdp` to the browser as `application/sdp`. Keep the API key on the
backend and protect signaling with your app's authentication and usage controls.
See the [WebRTC guide](../../docs/webrtc.md) for the connection contract.

Configure `session.client.data_channel` to limit commands and server events
visible to the frontend. Primary WebSockets instead send `session.start` with
`session.model` and wait for `session.started`; WebRTC creation already starts
the session. Neither flow requires an alpha header in the GA SDK.
