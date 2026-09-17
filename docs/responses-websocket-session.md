# Responses WebSocket sessions

Use `ResponsesWS` from `openai/resources/responses/ws` for the Responses API.
Its second argument accepts `headers` for custom upgrade request headers alongside
the SDK's authentication, and `agent` for an application-configured Node transport.
The optional `ws` dependency is required by this adapter.

The handshake also inherits the client's `defaultHeaders`, organization, and
project. Header names are case-insensitive: client defaults override SDK defaults,
and connection headers override client defaults. Setting a client default header
to `null` removes that default. Each reconnect reads the current client and
connection headers again.

`ResponsesWebSocketSession` from `openai/lib/responses/responses-websocket-session`
routes an existing connection's events into independent local consumers. See
the runnable [two-turn example](../examples/responses/websocket-session.ts).

Choose `maxLanes`, `maxBufferedEvents`, and `maxBufferedBytes` for your application
when creating the session. Individual lanes can use smaller queue budgets.
`maxLanes` counts all IDs registered with this session until reconnect, including
the default lane and detached lanes. The buffer budgets limit retained events;
they do not change the underlying transport's message limits. A lane queue overflow fails that lane.
If the session budget is exhausted, the helper fails and drains the largest existing
backlog until capacity is available: by bytes when the byte budget is exceeded,
otherwise by event count, with ties broken by lane registration order. The incoming
event is excluded from that ranking. An event larger than the entire session byte
budget fails only its destination lane. Other consumers and the connection remain usable.

Wait for the socket to open, register `session.lane(streamID)`, then call
`lane.create(request)`. Omit `streamID` for the default lane. The stream ID routes
events; `previous_response_id` explicitly selects response history. The helper
does not infer history or queue requests sent before the connection opens.
`lane.create` always uses its lane's routing ID, ignoring any `stream_id` present
in an untyped request object; the default lane omits that field on the wire.
It also omits the HTTP-only `stream` and `background` fields from untyped requests.

`lane.receive({ signal })` returns the next raw event, including unknown
future events. Its type includes a fallback with a string `type` and unknown fields;
validate fields before using them, even after comparing the event tag.
A raw response may omit `output` and the SDK-enriched `output_text`;
its lane event type reflects this. `lane.finalResponse({ signal, maxResponseBytes })` instead consumes
events, collects finalized output items, and uses the existing Responses snapshot
normalizer to return the completed, failed, or incomplete response. Check
`response.status`. Nested API error events
raise `WebSocketError` with the original event in its non-enumerable `error`
property. An explicit `maxResponseBytes` budget measures cumulative UTF-8 event
bytes. Without it, final-response collection has no cumulative byte limit;
the lane's queue budget only limits events waiting to be consumed. Exceeding the
response limit before a terminal event fails and detaches the lane, so a later
call cannot consume the partial response as a new result.
A terminal event without an object response also fails only its lane.

Only one receive or final-response operation may consume a lane at a time.
Canceling a receive wait leaves queued events available. Canceling a final-response
operation before it consumes any events leaves the lane reusable. Once it has consumed
events, cancellation fails and detaches the lane so a later call cannot return a partial
response as a complete result. Already-consumed events are not put back.
Raw events remain observable on the original connection throughout.

Closing a lane detaches that consumer, without canceling server work or closing
the socket. Its ID remains reserved until reconnect, even after a terminal event,
because steering can create an automatic successor. Continue using the same open
lane for sequential responses. Closing the session releases its listeners and lanes; the caller
still owns and must close the connection. Accepted events remain available if
the transport closes before the consumer reads them. After a physical transport error,
new lanes and sends are rejected until a replacement connection successfully opens.

If the underlying connection reconnects, all old lanes fail. After the connection
is restored, register new lanes and explicitly restore application state before
sending new work. Preserve full prior input/output items when restoring a
`store: false` conversation on a new connection. The helper never replays work.

## Continuation and service state

The [WebSocket mode guide](https://developers.openai.com/api/docs/guides/websocket-mode)
defines the server contract. Every new turn sends `response.create`; omit the
HTTP-only `stream` and `background` fields.

- **Warmup:** set `const request = { model, input, generate: false }` and call
  `lane.create(request)`. This uses the existing extra-field support. Consume
  `lane.finalResponse()`, then pass that response's ID as `previous_response_id`
  on a later create with new input. Warmup prepares state without model output.
- **Tools:** after the response completes, execute the application's tool and
  send its `function_call_output` with the original `call_id`, the completed
  response's ID, and only new input items. See the
  [tool-turn example](../examples/responses/websocket.ts).
- **Forks:** use the source response's ID on a different lane. With `store: false`
  or ZDR, wait for the fork lane's `response.in_progress` before advancing the
  source lane. Use `lane.receive()` to observe this barrier, handling errors and
  premature close while waiting.
- **Automatic compaction:** with `context_management` configured for compaction,
  continue using the latest response ID and only new input items.
- **Standalone compaction:** `client.responses.compact(...)` returns a compacted
  input window, not a response ID for continuation. Send its complete `output`
  as input to a new WebSocket chain, omitting or nulling `previous_response_id`.
  Do not prune items from the compacted output.

The server keeps recent response state in a connection-local cache. With
`store: true`, an older response may be loaded from persisted state. With
`store: false` or ZDR, an uncached ID produces `previous_response_not_found`.
A same-lane continuation returning a 4xx or 5xx evicts its referenced cached
parent; an errored cross-lane fork preserves the shared parent for the source
lane. Do not blindly retry the same parent after a cache miss. Restore full
input and output history as a new chain when needed, including tool and
reasoning items rather than only displayed text. Request
`reasoning.encrypted_content` when retaining reasoning-model output for replay.

## Lanes, limits and connection lifetime

Named stream IDs contain 1–256 ASCII letters, digits, underscores, hyphens or periods;
an empty string is invalid. Omit the ID for the default lane. Reusing an ID does
not select conversation history. The server executes same-lane requests FIFO
without overlap and may interleave different lanes. Named-lane terminals and
request errors echo the ID; default-lane events omit it.

The service allows 16 active responses and queues additional creates. It accepts
32 distinct named IDs per connection; the default lane does not count. These
are separate from local helper budgets. Detaching a lane does not reset the
server's distinct-ID count.

Connections last up to 60 minutes. Plan rotation at completed-turn boundaries;
the new connection loses every lane's connection-local cache. Handle
`previous_response_not_found`, `invalid_stream_id`, `websocket_stream_limit_reached`,
and `websocket_connection_limit_reached` through the original error event. Register
and consume the default lane or observe the connection's raw events for
connection-scoped errors as well as errors on named lanes.

Steering uses the connection's `send` method with only `type: 'response.steer'`,
`previous_response_id` and `input`, without `stream_id`. Accepted input is not
committed until the successor's `response.created`. If `response.steer.pending`
requires tool output or approval, fill its `required_input` stubs and send one
create on the parent's lane with that parent ID. Reuse saved results rather
than rerunning tools or resending already accepted steering input. The existing
connection send/reconnect policy applies to this low-level steering path.

To run the opt-in live smoke test, configure `OPENAI_API_KEY` in the environment
and set `OPENAI_WEBSOCKET_LIVE_TEST=1`. Optionally set
`OPENAI_WEBSOCKET_TEST_MODEL`. The test uses synthetic prompts and does not print
responses or credentials. Its Node agent honors the environment's configured proxy.
