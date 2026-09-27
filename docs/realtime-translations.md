# Realtime translation in Node.js

Install the optional `ws` package alongside `openai`. Use an OpenAI client with a
static or function-valued API key and a translation model available to your account:

```ts
import { once } from 'node:events';
import OpenAI from 'openai';
import { OpenAIRealtimeTranslationWS } from 'openai/realtime/translations/ws';

const client = new OpenAI();
const connection = await OpenAIRealtimeTranslationWS.create(client, { model });
connection.on('error', (error) => console.error(error.message));
connection.on('session.output_transcript.delta', (event) => process.stdout.write(event.delta));
await once(connection.socket.platformSocket, 'open');
connection.send({ type: 'session.update', session: { audio: { output: { language: 'fr' } } } });
connection.send({ type: 'session.input_audio_buffer.append', audio: base64Audio });
await connection.finish({ timeoutMs: 30_000 });
```

`model` identifies your translation model; `base64Audio` contains input audio in
its supported format. The [file example](../examples/realtime/translation.ts) reads
`OPENAI_API_KEY`, `OPENAI_TRANSLATION_MODEL`, and an input file path.

`OpenAIRealtimeTranslationWS.create(client, { model, options })` resolves after
starting the connection, before it opens. Attach listeners immediately and await
`open` before sending.

Use typed event listeners for audio and transcript deltas, or `event` to observe
every server envelope, including future event types and API errors. Incomplete
known envelopes remain observable on `event`; only envelopes with the required
fields reach their typed listener. Always attach an `error` listener: an API
error without one is reported as an unhandled promise rejection, as in Realtime.
`send()`
accepts a typed client event, an object with a string `type`, or a raw JSON object
with a string `type`. There is no automatic configuration, input buffering,
reconnection, or replay.

`finish({ timeoutMs, signal? })` stops further input, sends `session.close` once,
and resolves after listeners receive all events through `session.closed` and the
transport closes.
Choose a positive, finite timeout in milliseconds (at most 2,147,483,647).
Repeated calls share the first call's deadline, signal, and result. API error
events can be nonterminal and do not stop draining. A `session.closed` envelope
without a string `event_id` is delivered only to `event`; it does not finish
the session or discard later output. An abort, timeout, or transport
failure rejects. The same deadline includes transport cleanup. A stalled close
handshake is forcibly terminated and rejects even if listeners already received
`session.closed`. Transport listeners are released before `finish()` settles.
An error close status also rejects after terminal delivery; normal closure,
going away, and a close with no status are accepted.

`connection.session.close()` sends only the protocol close. You can subsequently
call `finish()` to await the terminal event. `connection.close()` closes the
transport without waiting for remaining output; use it in cleanup paths.

The connection requires an HTTPS base URL and uses the client's default query,
organization, project, and default headers. Per-connection `options.headers` overrides headers without
regard to case; `undefined` preserves a default and `null` removes it. Other
`options` are Node `ws` options, such as `agent` and `handshakeTimeout`. Redirects
are always disabled. HTTP `fetch` and `fetchOptions` do not apply.

Translation uses a dedicated endpoint. An `intent` in the base URL or default
query is rejected before a connection opens, including an empty `intent`.
Remove it from the client you pass to Translation; Realtime transcription keeps
its existing `intent: 'transcription'` behavior.

This entrypoint supports ordinary API-key clients in Node.js. Azure, Bedrock,
provider-runtime, workload-identity, and browser connections are unsupported.
