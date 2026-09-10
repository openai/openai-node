# Live

Types:

- <code><a href="./src/resources/live/live.ts">AudioFormat</a></code>
- <code><a href="./src/resources/live/live.ts">BuiltInVoice</a></code>
- <code><a href="./src/resources/live/live.ts">ClientConfig</a></code>
- <code><a href="./src/resources/live/live.ts">ClientDelegation</a></code>
- <code><a href="./src/resources/live/live.ts">ClientEvent</a></code>
- <code><a href="./src/resources/live/live.ts">CommentaryAppendEvent</a></code>
- <code><a href="./src/resources/live/live.ts">CommentaryAppendedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">CustomVoice</a></code>
- <code><a href="./src/resources/live/live.ts">DataChannelConfig</a></code>
- <code><a href="./src/resources/live/live.ts">DelegationCreatedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">Error</a></code>
- <code><a href="./src/resources/live/live.ts">ErrorEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ForkSessionConfig</a></code>
- <code><a href="./src/resources/live/live.ts">ForkSessionStartEvent</a></code>
- <code><a href="./src/resources/live/live.ts">FunctionTool</a></code>
- <code><a href="./src/resources/live/live.ts">InfoEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InitialItem</a></code>
- <code><a href="./src/resources/live/live.ts">InputAudioAppendEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InputAudioMuteEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InputAudioMutedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InputAudioUnmuteEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InputAudioUnmutedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InputTranscriptDeltaEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InstructionsAppendEvent</a></code>
- <code><a href="./src/resources/live/live.ts">InstructionsAppendedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">MediaSessionConfig</a></code>
- <code><a href="./src/resources/live/live.ts">MediaSessionForkConfig</a></code>
- <code><a href="./src/resources/live/live.ts">OutputAudioDeltaEvent</a></code>
- <code><a href="./src/resources/live/live.ts">OutputTranscriptDeltaEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ResponseCreateEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ResponseEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ResponseItemCreateEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ResponsesDelegationConfig</a></code>
- <code><a href="./src/resources/live/live.ts">ResponsesDelegationUpdateConfig</a></code>
- <code><a href="./src/resources/live/live.ts">ServerEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ServerEventSelector</a></code>
- <code><a href="./src/resources/live/live.ts">SessionCloseEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionClosedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionConfig</a></code>
- <code><a href="./src/resources/live/live.ts">SessionResource</a></code>
- <code><a href="./src/resources/live/live.ts">SessionStartEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionStartedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionUpdateConfig</a></code>
- <code><a href="./src/resources/live/live.ts">SessionUpdateEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionUpdatedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">SessionUsage</a></code>
- <code><a href="./src/resources/live/live.ts">SessionUsageUpdatedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ThinkingAppendEvent</a></code>
- <code><a href="./src/resources/live/live.ts">ThinkingAppendedEvent</a></code>
- <code><a href="./src/resources/live/live.ts">LiveCreateResponse</a></code>

Methods:

- <code title="post /live/sessions">client.live.<a href="./src/resources/live/live.ts">create</a>({ ...params }) -> LiveCreateResponse</code>

## Sideband

Types:

- <code><a href="./src/resources/live/sideband.ts">ConnectClientEvent</a></code>
- <code><a href="./src/resources/live/sideband.ts">ConnectServerEvent</a></code>

## Forks

Types:

- <code><a href="./src/resources/live/forks.ts">ForkClientEvent</a></code>
- <code><a href="./src/resources/live/forks.ts">ForkServerEvent</a></code>

## Sessions

Types:

- <code><a href="./src/resources/live/sessions.ts">SessionForkResponse</a></code>

Methods:

- <code title="post /live/sessions/{session_id}/accept">client.live.sessions.<a href="./src/resources/live/sessions.ts">accept</a>(sessionID, { ...params }) -> void</code>
- <code title="get /live/sessions/{session_id}/content">client.live.sessions.<a href="./src/resources/live/sessions.ts">downloadRecording</a>(sessionID) -> Response</code>
- <code title="post /live/sessions/{session_id}/fork">client.live.sessions.<a href="./src/resources/live/sessions.ts">fork</a>(sessionID, { ...params }) -> SessionForkResponse</code>
- <code title="post /live/sessions/{session_id}/hangup">client.live.sessions.<a href="./src/resources/live/sessions.ts">hangup</a>(sessionID) -> void</code>
- <code title="post /live/sessions/{session_id}/refer">client.live.sessions.<a href="./src/resources/live/sessions.ts">refer</a>(sessionID, { ...params }) -> void</code>
- <code title="post /live/sessions/{session_id}/reject">client.live.sessions.<a href="./src/resources/live/sessions.ts">reject</a>(sessionID, { ...params }) -> void</code>
