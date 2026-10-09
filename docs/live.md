# Live WebSocket lifecycle

Primary (`openai/resources/live/ws`) and fork
(`openai/resources/live/forks/ws`) connections require the caller to send
`session.start`. Use the resulting `session.started` to confirm startup.
Sideband (`openai/resources/live/sideband/ws`) attaches to an existing session;
it does not send startup or require a new `session.started`. Any replay on
attachment is a short event history, not a full session snapshot.

Connections do not automatically reopen unless you supplied `reconnect` with
an `onReconnecting` handler. Existing opt-in reconnect uses bounded exponential
backoff: `maxRetries` defaults to 5, `initialDelay` to 500 ms and `maxDelay`
to 8 s. Set `maxRetries: 0` to disable it, or return `{ abort: true }` from
the handler to stop. Normal and nonrecoverable protocol closes stop retries.
Opening another socket does not establish that the server restored session
state. Your handler owns updated connection parameters; it cannot infer a
safe new startup or restoration for an existing Live session.

Commands accepted by the pre-open/reconnecting queue are snapshotted and
subject to the existing `maxQueueSize` limit. After a send fails, the SDK
emits `error` and retains only commands not yet attempted. It never puts the
failing command into the next connection's queue: delivery may already have
happened. On permanent close, `unsent` contains only the still-queued,
never-attempted commands; the application decides what to do with them.

Register an `error` listener or consume `stream()`. A server
`session_storage_failed` error remains an error even when
`session.closed` and socket close follow. A close alone is not proof that a
stored recording is ready for a fork or that sideband authorization is valid.
