// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as LiveAPI from './live';
import * as SessionsAPI from './sessions';
import {
  SessionAcceptParams,
  SessionForkParams,
  SessionForkResponse,
  SessionReferParams,
  SessionRejectParams,
  Sessions,
} from './sessions';
import * as ResponsesAPI from '../responses/responses';
import * as ForksAPI from './forks/forks';
import { ForkClientEvent, ForkServerEvent, Forks } from './forks/forks';
import * as SidebandAPI from './sideband/sideband';
import { ConnectClientEvent, ConnectServerEvent, Sideband, SidebandConnectParams } from './sideband/sideband';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';

export class Live extends APIResource {
  sideband: SidebandAPI.Sideband = new SidebandAPI.Sideband(this._client);
  forks: ForksAPI.Forks = new ForksAPI.Forks(this._client);
  sessions: SessionsAPI.Sessions = new SessionsAPI.Sessions(this._client);

  /**
   * Create a Live WebRTC session. Start with the
   * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting).
   *
   * @example
   * ```ts
   * const live = await client.live.create({
   *   session: { model: 'gpt-live-1' },
   *   transport: { sdp: 'x', type: 'webrtc' },
   * });
   * ```
   */
  create(body: LiveCreateParams, options?: RequestOptions): APIPromise<LiveCreateResponse> {
    return this._client.post('/live/sessions', { body, ...options, __security: { bearerAuth: true } });
  }
}

/**
 * Audio encoding and sample rate for audio sent and received over a Live WebSocket
 * connection. WebRTC and SIP negotiate their media format separately.
 */
export type AudioFormat = AudioFormat.AudioPCM | AudioFormat.AudioPCMU | AudioFormat.AudioPCMA;

export namespace AudioFormat {
  /**
   * Raw, mono 16-bit little-endian PCM audio for a Live WebSocket connection.
   */
  export interface AudioPCM {
    /**
     * Audio sample rate in hertz. Live WebSocket PCM audio supports 16000 or 24000 Hz.
     */
    rate: 16000 | 24000;

    /**
     * The audio encoding. Always `audio/pcm`.
     */
    type: 'audio/pcm';
  }

  /**
   * Raw, mono G.711 μ-law audio for a Live WebSocket connection.
   */
  export interface AudioPCMU {
    /**
     * Audio sample rate in hertz. G.711 audio uses 8000 Hz.
     */
    rate: number;

    /**
     * The audio encoding. Always `audio/pcmu`.
     */
    type: 'audio/pcmu';
  }

  /**
   * Raw, mono G.711 A-law audio for a Live WebSocket connection.
   */
  export interface AudioPCMA {
    /**
     * Audio sample rate in hertz. G.711 audio uses 8000 Hz.
     */
    rate: number;

    /**
     * The audio encoding. Always `audio/pcma`.
     */
    type: 'audio/pcma';
  }
}

/**
 * A built-in voice available for Live speech.
 */
export type BuiltInVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'beacon'
  | 'bossa'
  | 'cedar'
  | 'cinder'
  | 'coral'
  | 'delta'
  | 'echo'
  | 'gleam'
  | 'marin'
  | 'meridian'
  | 'quartz'
  | 'ripple'
  | 'sage'
  | 'shimmer'
  | 'stone'
  | 'tempo'
  | 'verse'
  | 'vesper'
  | 'willow';

/**
 * Startup-only capabilities for an untrusted frontend attached to a unified WebRTC
 * session. Trusted sideband connections are unaffected.
 */
export interface ClientConfig {
  /**
   * Client and server event permissions for the WebRTC frontend data channel.
   */
  data_channel: DataChannelConfig;
}

/**
 * Delegate tasks to your application. The Live session emits delegation events
 * that your backend handles.
 */
export interface ClientDelegation {
  /**
   * The delegation owner. Always `client` for tasks handled by your application.
   */
  type: 'client';
}

/**
 * Client events for Live. Initialize a primary WebSocket with session.start and
 * wait for session.started. WebRTC creation already starts the session. Audio
 * append is primary WebSocket-only. See the
 * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
 * before writing frontend instructions and delegation policies.
 */
export type ClientEvent =
  | SessionStartEvent
  | SessionUpdateEvent
  | InputAudioAppendEvent
  | InputAudioMuteEvent
  | InputAudioUnmuteEvent
  | InstructionsAppendEvent
  | ThinkingAppendEvent
  | CommentaryAppendEvent
  | ResponseItemCreateEvent
  | ResponseCreateEvent
  | SessionCloseEvent;

/**
 * Provide context the Live model can communicate to the user, optionally for an
 * existing client delegation.
 */
export interface CommentaryAppendEvent {
  /**
   * Speakable context for the Live model, limited to 500 tokens. Use this for a
   * result the model should communicate; use session.thinking.append for silent
   * context.
   */
  content: string;

  /**
   * Required, nullable. Set null for general session context, or use the ID from
   * session.delegation.created for an existing client delegation. Non-null IDs are
   * not accepted with Responses delegation.
   */
  delegation_id: string | null;

  /**
   * The Live client event type. Always `session.commentary.append`.
   */
  type: 'session.commentary.append';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a session.commentary.append command is accepted into the Live
 * session timeline. Acknowledges the added commentary without guaranteeing exact
 * wording or completed audio playback.
 */
export interface CommentaryAppendedEvent {
  /**
   * The end of this event on the Live session timeline, in milliseconds from the
   * beginning of the session. For appended context, this can equal start_ms.
   */
  end_ms: number;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The start of this event on the Live session timeline, in milliseconds from the
   * beginning of the session.
   */
  start_ms: number;

  /**
   * The event type, always `session.commentary.appended`.
   */
  type: 'session.commentary.appended';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

export interface CustomVoice {
  id: string;
}

/**
 * Control which Live events an untrusted WebRTC frontend can send and receive over
 * its data channel. These restrictions do not apply to trusted sideband
 * connections.
 */
export interface DataChannelConfig {
  /**
   * Client event types that the frontend data channel may send. Use 'all' to allow
   * every client event; an empty array allows none. Omission preserves the existing
   * allow-all behavior.
   */
  allowed_client_events?: 'all' | Array<string>;

  /**
   * Server events that may be sent to the frontend data channel. Use 'all' to allow
   * every server event; an empty array allows none. Omission preserves the existing
   * allow-all behavior. Responses events use an object with type 'response.event'
   * and a response_event selector.
   */
  allowed_server_events?: 'all' | Array<ServerEventSelector>;
}

/**
 * Returned when the Live model delegates work to your application or a Responses
 * backend. Contains delegation metadata and the position on the session timeline
 * where the work was delegated.
 */
export interface DelegationCreatedEvent {
  /**
   * The delegated work identifier and destination. This object contains metadata,
   * not the task text.
   */
  delegation: DelegationCreatedEvent.Delegation;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The position on the Live session timeline where the delegation was created, in
   * milliseconds from the beginning of the session.
   */
  offset_ms: number;

  /**
   * The event type, always `session.delegation.created`.
   */
  type: 'session.delegation.created';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

export namespace DelegationCreatedEvent {
  /**
   * The delegated work identifier and destination. This object contains metadata,
   * not the task text.
   */
  export interface Delegation {
    /**
     * The unique ID of the delegation. Use this as delegation_id when replying to
     * client-owned work or correlating Responses events.
     */
    id: string;

    /**
     * Where the Live model delegated the work: `client` for your application, or
     * `responses` for the configured Responses backend.
     */
    target: 'client' | 'responses';

    /**
     * The object type, always `delegation`.
     */
    type: 'delegation';

    /**
     * The ID of the Responses API response associated with a Responses delegation.
     * Omitted for client delegations.
     */
    response_id?: string;
  }
}

/**
 * Details of an error encountered by the Live session, including the affected
 * parameter or client command when available.
 */
export interface Error {
  /**
   * A machine-readable code identifying the Live error, such as `unknown_parameter`.
   */
  code: string;

  /**
   * A human-readable explanation of the Live error.
   */
  message: string;

  /**
   * The category of error, such as `invalid_request_error` for an invalid Live
   * client command.
   */
  type: string;

  /**
   * The event_id of the client command that caused the error, when supplied.
   */
  client_event_id?: string;

  /**
   * The parameter that caused the error, when applicable, such as `session.voice`.
   */
  param?: string;
}

/**
 * Reports an error in the Live session, such as an invalid client command. Use
 * error.client_event_id, when present, to identify the command that caused the
 * error.
 */
export interface ErrorEvent {
  /**
   * Details of the Live error and the client command that caused it, when known.
   */
  error: Error;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The event type, always `error`.
   */
  type: 'error';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Overrides for a stored session after connecting to the fork WebSocket. An empty
 * object inherits the stored configuration; do not supply a new model.
 * audio.format applies only to the new WebSocket connection. client overrides are
 * only supported for WebRTC forks.
 */
export interface ForkSessionConfig {
  /**
   * Audio format for a WebSocket fork. WebRTC forks negotiate their audio format and
   * must omit this field.
   */
  audio?: ForkSessionConfig.Audio;

  /**
   * Frontend data-channel permissions for a WebRTC fork. Omitted permissions inherit
   * the stored values. Not supported for WebSocket forks.
   */
  client?: ClientConfig;

  /**
   * Overrides for the stored session’s Responses backend. Only supported when the
   * stored session already uses Responses delegation; the delegation type cannot
   * change.
   */
  delegation?: ForkSessionConfig.Delegation;

  /**
   * Whether to store the forked session. Omission inherits the stored session's
   * setting.
   */
  store?: boolean;
}

export namespace ForkSessionConfig {
  /**
   * Audio format for a WebSocket fork. WebRTC forks negotiate their audio format and
   * must omit this field.
   */
  export interface Audio {
    /**
     * Audio encoding and sample rate for audio sent and received over a Live WebSocket
     * connection. WebRTC and SIP negotiate their media format separately.
     */
    format?: LiveAPI.AudioFormat;
  }

  /**
   * Overrides for the stored session’s Responses backend. Only supported when the
   * stored session already uses Responses delegation; the delegation type cannot
   * change.
   */
  export interface Delegation {
    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';

    /**
     * Responses backend settings to update. Omitted settings keep their existing
     * values.
     */
    responses?: LiveAPI.ResponsesDelegationUpdateConfig;
  }
}

/**
 * Start a Live session after connecting to a stored session’s fork WebSocket. Send
 * an empty `session` object to use the stored configuration.
 */
export interface ForkSessionStartEvent {
  /**
   * Overrides for a stored session after connecting to the fork WebSocket. An empty
   * object inherits the stored configuration; do not supply a new model.
   * audio.format applies only to the new WebSocket connection. client overrides are
   * only supported for WebRTC forks.
   */
  session: ForkSessionConfig;

  /**
   * The Live client event type. Always `session.start`.
   */
  type: 'session.start';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * A function tool available to the Responses backend when the Live model delegates
 * a task.
 */
export interface FunctionTool {
  /**
   * The name the delegated Responses model uses when calling this function.
   */
  name: string;

  /**
   * The tool type. Always `function`.
   */
  type: 'function';

  /**
   * What the function does and when the delegated Responses model should call it.
   */
  description?: string | null;

  /**
   * A JSON Schema object describing the arguments accepted by the function.
   */
  parameters?: { [key: string]: unknown } | null;

  /**
   * Whether the delegated Responses model must follow the function’s parameter
   * schema exactly.
   */
  strict?: boolean | null;
}

/**
 * An informational notice about the Live session, such as the event permissions
 * applied to a frontend data channel.
 */
export interface InfoEvent {
  /**
   * A machine-readable code for the notice, such as `data_channel_permissions`.
   */
  code: string;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * A human-readable explanation of the Live session notice.
   */
  message: string;

  /**
   * The event type, always `info`.
   */
  type: 'info';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * A developer, user, or assistant message supplied as text history before the Live
 * session starts.
 */
export type InitialItem = InitialItem.Developer | InitialItem.User | InitialItem.Assistant;

export namespace InitialItem {
  /**
   * A developer message included in the initial text history of a Live session.
   */
  export interface Developer {
    /**
     * The message content. Supply exactly one text part for the initial Live
     * conversation history.
     */
    content: Array<Developer.Content>;

    /**
     * The author of this history message. Always `developer`.
     */
    role: 'developer';

    /**
     * An optional identifier for the supplied history message. Live uses the message’s
     * role and text to initialize the conversation.
     */
    id?: string | null;

    /**
     * The supplied message’s status. Live uses its text as history and does not resume
     * an incomplete message.
     */
    status?: 'incomplete' | 'completed' | null;

    /**
     * The history item type. Always `message`.
     */
    type?: 'message';
  }

  export namespace Developer {
    /**
     * Text supplied in a developer or user message when starting a Live session.
     */
    export interface Content {
      /**
       * The message text to include in the Live session’s initial conversation history.
       */
      text: string;

      /**
       * The text content type. Always `input_text`.
       */
      type?: 'input_text';
    }
  }

  /**
   * A user message included in the initial text history of a Live session.
   */
  export interface User {
    /**
     * The message content. Supply exactly one text part for the initial Live
     * conversation history.
     */
    content: Array<User.Content>;

    /**
     * The author of this history message. Always `user`.
     */
    role: 'user';

    /**
     * An optional identifier for the supplied history message. Live uses the message’s
     * role and text to initialize the conversation.
     */
    id?: string | null;

    /**
     * The supplied message’s status. Live uses its text as history and does not resume
     * an incomplete message.
     */
    status?: 'incomplete' | 'completed' | null;

    /**
     * The history item type. Always `message`.
     */
    type?: 'message';
  }

  export namespace User {
    /**
     * Text supplied in a developer or user message when starting a Live session.
     */
    export interface Content {
      /**
       * The message text to include in the Live session’s initial conversation history.
       */
      text: string;

      /**
       * The text content type. Always `input_text`.
       */
      type?: 'input_text';
    }
  }

  /**
   * An assistant message included in the initial text history of a Live session.
   */
  export interface Assistant {
    /**
     * The message content. Supply exactly one text part for the initial Live
     * conversation history.
     */
    content: Array<Assistant.Text | Assistant.OutputText>;

    /**
     * The author of this history message. Always `assistant`.
     */
    role: 'assistant';

    /**
     * An optional identifier for the supplied history message. Live uses the message’s
     * role and text to initialize the conversation.
     */
    id?: string | null;

    /**
     * The supplied message’s status. Live uses its text as history and does not resume
     * an incomplete message.
     */
    status?: 'incomplete' | 'completed' | null;

    /**
     * The history item type. Always `message`.
     */
    type?: 'message';
  }

  export namespace Assistant {
    /**
     * Assistant text supplied as conversation history when starting a Live session.
     */
    export interface Text {
      /**
       * The message text to include in the Live session’s initial conversation history.
       */
      text: string;

      /**
       * The text content type. Always `text`.
       */
      type?: 'text';
    }

    /**
     * Assistant output text supplied as conversation history when starting a Live
     * session.
     */
    export interface OutputText {
      /**
       * The message text to include in the Live session’s initial conversation history.
       */
      text: string;

      /**
       * The text content type. Always `output_text`.
       */
      type: 'output_text';
    }
  }
}

/**
 * Send audio to a Live session over its primary WebSocket. WebRTC and SIP sessions
 * send audio over their media transport.
 */
export interface InputAudioAppendEvent {
  /**
   * Base64-encoded raw audio in the startup-selected format, without a WAV or other
   * container header. Primary WebSocket only; media transports use their audio
   * track. Audio appends have no acknowledgment. Reflected sideband server events
   * reuse this event type and audio key, with no timestamps or event_id; their audio
   * is always mono PCM16LE at 24 kHz.
   */
  audio: string;

  /**
   * The Live client event type. Always `session.input_audio.append`.
   */
  type: 'session.input_audio.append';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Mute audio input to the Live model without closing the session. The server
 * acknowledges with `session.input_audio.muted`.
 */
export interface InputAudioMuteEvent {
  /**
   * The Live client event type. Always `session.input_audio.mute`.
   */
  type: 'session.input_audio.mute';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a session.input_audio.mute command is accepted. Input audio is no
 * longer sent to the model; sideband audio reflection continues.
 */
export interface InputAudioMutedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The event type, always `session.input_audio.muted`.
   */
  type: 'session.input_audio.muted';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Resume audio input to a Live model after muting it. The server acknowledges with
 * `session.input_audio.unmuted`.
 */
export interface InputAudioUnmuteEvent {
  /**
   * The Live client event type. Always `session.input_audio.unmute`.
   */
  type: 'session.input_audio.unmute';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a session.input_audio.unmute command is accepted. Input audio is
 * sent to the model again.
 */
export interface InputAudioUnmutedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The event type, always `session.input_audio.unmuted`.
   */
  type: 'session.input_audio.unmuted';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * A transcript fragment for user input audio in the Live session. Accumulate
 * fragments in delivery order; these events do not define complete turns or
 * include a transcript-done event.
 */
export interface InputTranscriptDeltaEvent {
  /**
   * The transcript text fragment for the audio in this time range. Append fragments
   * in delivery order to build the transcript.
   */
  delta: string;

  /**
   * The end of this event on the Live session timeline, in milliseconds from the
   * beginning of the session. For appended context, this can equal start_ms.
   */
  end_ms: number;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The start of this event on the Live session timeline, in milliseconds from the
   * beginning of the session.
   */
  start_ms: number;

  /**
   * The event type, always `session.input_transcript.delta`.
   */
  type: 'session.input_transcript.delta';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Append instructions to the Live conversation while it is running, optionally
 * associating them with an existing client delegation.
 */
export interface InstructionsAppendEvent {
  /**
   * Instruction text to append, limited to 500 tokens. This is a plain string, not
   * an array of content parts.
   */
  content: string;

  /**
   * Required, nullable. Set null for general session context, or use the ID from
   * session.delegation.created for an existing client delegation. Non-null IDs are
   * not accepted with Responses delegation.
   */
  delegation_id: string | null;

  /**
   * The Live client event type. Always `session.instructions.append`.
   */
  type: 'session.instructions.append';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a session.instructions.append command is accepted into the Live
 * session timeline. Acknowledges the appended instructions without guaranteeing
 * that the model has acted on them.
 */
export interface InstructionsAppendedEvent {
  /**
   * The end of this event on the Live session timeline, in milliseconds from the
   * beginning of the session. For appended context, this can equal start_ms.
   */
  end_ms: number;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The start of this event on the Live session timeline, in milliseconds from the
   * beginning of the session.
   */
  start_ms: number;

  /**
   * The event type, always `session.instructions.appended`.
   */
  type: 'session.instructions.appended';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Startup configuration for a Live media session. Follow the
 * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
 * when writing frontend instructions and the backend prompt under
 * delegation.responses.instructions.
 */
export interface MediaSessionConfig {
  /**
   * The Live model. Required in the session configuration for every transport; do
   * not pass it as a URL query parameter.
   */
  model: (string & {}) | 'gpt-live-1';

  /**
   * Startup audio configuration. WebRTC and SIP negotiate their audio format on the
   * media transport.
   */
  audio?: MediaSessionConfig.Audio;

  /**
   * Startup-only capabilities for an untrusted frontend attached to a unified WebRTC
   * session. Trusted sideband connections are unaffected.
   */
  client?: ClientConfig;

  /**
   * Who handles tasks delegated by the Live model. Omitted or null selects your
   * application; use `responses` to let the API manage a Responses backend.
   */
  delegation?: ClientDelegation | MediaSessionConfig.Responses | null;

  /**
   * Ordered text-only history supplied before startup. Supports developer, user, and
   * assistant messages with one text part each; at most 128 messages and 8,192
   * rendered tokens in total.
   */
  input?: Array<InitialItem>;

  /**
   * Frontend instructions for voice, conversation, interruptions, and when to
   * delegate. Start with the
   * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting);
   * put business rules and tool workflows in a separate
   * [backend prompt](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
   * Limited to 16,384 client-supplied tokens. Omitted or blank instructions use
   * server defaults. Immutable after startup.
   */
  instructions?: string | null;

  /**
   * Whether to store the session for later forking and recording download. Defaults
   * to false for new sessions.
   */
  store?: boolean;
}

export namespace MediaSessionConfig {
  /**
   * Startup audio configuration. WebRTC and SIP negotiate their audio format on the
   * media transport.
   */
  export interface Audio {
    /**
     * Settings for speech generated by the Live model. Choose the voice before
     * starting the session.
     */
    output?: Audio.Output;
  }

  export namespace Audio {
    /**
     * Settings for speech generated by the Live model. Choose the voice before
     * starting the session.
     */
    export interface Output {
      /**
       * The voice used for Live speech, as a built-in voice name or a custom voice
       * object containing its ID. Defaults to `marin` and cannot change after startup.
       */
      voice?: string | LiveAPI.BuiltInVoice | LiveAPI.CustomVoice;
    }
  }

  /**
   * Delegate tasks to a Responses model managed by the Live session.
   */
  export interface Responses {
    /**
     * Backend model, prompt, and tools used when the Live session delegates a task to
     * Responses.
     */
    responses: LiveAPI.ResponsesDelegationConfig;

    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';
  }
}

/**
 * Optional overrides for a stored Live session. Omitted settings are inherited.
 * The model, voice, frontend instructions, and prior conversation come from the
 * stored session. WebRTC negotiates its audio format; audio.format is only
 * supported on WebSocket forks.
 */
export interface MediaSessionForkConfig {
  /**
   * Startup-only capabilities for an untrusted frontend attached to a unified WebRTC
   * session. Trusted sideband connections are unaffected.
   */
  client?: ClientConfig;

  /**
   * Update the Responses backend for an existing Live session without changing
   * delegation ownership.
   */
  delegation?: MediaSessionForkConfig.Delegation;

  /**
   * Whether to store the forked session. Omission inherits the stored session's
   * setting.
   */
  store?: boolean;
}

export namespace MediaSessionForkConfig {
  /**
   * Update the Responses backend for an existing Live session without changing
   * delegation ownership.
   */
  export interface Delegation {
    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';

    /**
     * Responses backend settings to update. Omitted settings keep their existing
     * values.
     */
    responses?: LiveAPI.ResponsesDelegationUpdateConfig;
  }
}

/**
 * An audio chunk generated by the Live model. Decode and play primary WebSocket
 * chunks in delivery order using the configured session audio format. Sideband
 * connections receive reflected output audio with timestamps.
 */
export interface OutputAudioDeltaEvent {
  /**
   * Base64-encoded raw audio. Primary WebSocket events use the session's configured
   * format; reflected sideband events use mono PCM16LE at 24 kHz.
   */
  delta: string;

  /**
   * The event type, always `session.output_audio.delta`.
   */
  type: 'session.output_audio.delta';

  /**
   * Exclusive session-relative end in milliseconds. Required on reflected sideband
   * events; omitted on the primary WebSocket. Dropped output frames leave gaps
   * between reflected ranges.
   */
  end_ms?: number;

  /**
   * Inclusive session-relative start in milliseconds. Required on reflected sideband
   * events; omitted on the primary WebSocket.
   */
  start_ms?: number;
}

/**
 * A transcript fragment for assistant output audio in the Live session. Accumulate
 * fragments in delivery order; these events do not define complete turns or
 * include a transcript-done event.
 */
export interface OutputTranscriptDeltaEvent {
  /**
   * The transcript text fragment for the audio in this time range. Append fragments
   * in delivery order to build the transcript.
   */
  delta: string;

  /**
   * The end of this event on the Live session timeline, in milliseconds from the
   * beginning of the session. For appended context, this can equal start_ms.
   */
  end_ms: number;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The start of this event on the Live session timeline, in milliseconds from the
   * beginning of the session.
   */
  start_ms: number;

  /**
   * The event type, always `session.output_transcript.delta`.
   */
  type: 'session.output_transcript.delta';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Request a response from the Live session’s Responses backend, or continue a
 * delegated response waiting for tool results. Requires Responses delegation.
 */
export interface ResponseCreateEvent {
  /**
   * The Live client event type. Always `response.create`.
   */
  type: 'response.create';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * A streaming Responses API event from a backend delegated to by the Live session.
 * Use the outer delegation_id to associate the nested stream with its Live
 * delegation.
 */
export interface ResponseEvent {
  /**
   * The nested Responses streaming event. Dispatch on its type field. Response
   * lifecycle snapshots omit input and clear instructions, tools, and output to keep
   * messages small; consume granular output events for the generated content.
   */
  event: { [key: string]: unknown };

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The event type, always `response.event`.
   */
  type: 'response.event';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;

  /**
   * The Live delegation associated with the nested Responses event. May be null or
   * omitted when the event cannot be correlated with a delegation.
   */
  delegation_id?: string | null;
}

/**
 * Add an input item to the Live session’s Responses backend. Requires Responses
 * delegation; use `response.create` to request a response.
 */
export interface ResponseItemCreateEvent {
  /**
   * An input item to append to the Responses backend conversation, such as a user
   * message or a function tool result.
   */
  item: ResponsesAPI.ResponseInputItem;

  /**
   * The Live client event type. Always `response.item.create`.
   */
  type: 'response.item.create';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Model, prompt, and tool settings for tasks delegated by the Live session to a
 * Responses backend.
 */
export interface ResponsesDelegationConfig {
  /**
   * The model used for server-owned Responses delegations.
   */
  model: string;

  /**
   * Instructions for the delegated Responses model, separate from Live instructions.
   * See
   * [backend prompting](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
   */
  instructions?: string | null;

  /**
   * Maximum number of output tokens for each delegated response.
   */
  max_output_tokens?: number | null;

  /**
   * Whether the delegated Responses model may request multiple tool calls in a
   * single response.
   */
  parallel_tool_calls?: boolean | null;

  /**
   * Reasoning settings passed to each delegated Responses request.
   */
  reasoning?: ResponsesDelegationConfig.Reasoning | null;

  /**
   * Service tier for delegated Responses requests.
   */
  service_tier?: 'auto' | 'default' | 'fast_tier_temp_pilot' | 'flex' | 'priority' | 'ultrafast' | null;

  /**
   * Text generation settings passed to each delegated Responses request.
   */
  text?: ResponsesDelegationConfig.Text | null;

  /**
   * Controls which tool the Responses backend uses when handling a task delegated by
   * the Live model.
   */
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | ResponsesDelegationConfig.LiveFunctionToolChoiceParam
    | ResponsesDelegationConfig.LiveMCPToolChoiceParam;

  /**
   * Tools available to the Responses backend while it handles tasks delegated by the
   * Live model.
   */
  tools?: Array<FunctionTool | ResponsesDelegationConfig.WebSearch>;
}

export namespace ResponsesDelegationConfig {
  /**
   * Reasoning settings passed to each delegated Responses request.
   */
  export interface Reasoning {
    /**
     * How much reasoning effort the delegated Responses model should use. Supported
     * values depend on the backend model.
     */
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;

    /**
     * The reasoning summary to request from the delegated Responses model, when
     * supported.
     */
    summary?: 'concise' | 'detailed' | 'auto' | null;
  }

  /**
   * Text generation settings passed to each delegated Responses request.
   */
  export interface Text {
    /**
     * The amount of detail in text generated by the Responses backend. This does not
     * configure the Live model’s spoken delivery.
     */
    verbosity?: 'low' | 'medium' | 'high' | null;
  }

  export interface LiveFunctionToolChoiceParam {
    name: string;

    type: 'function';
  }

  export interface LiveMCPToolChoiceParam {
    name: string;

    server_label: string;

    type: 'mcp';
  }

  /**
   * A web search tool available to the Live session’s Responses backend.
   */
  export interface WebSearch {
    /**
     * The tool type. Always `web_search`.
     */
    type: 'web_search';
  }
}

/**
 * Updates to the Responses backend of an existing Live session. Omitted settings
 * retain their current values.
 */
export interface ResponsesDelegationUpdateConfig {
  /**
   * Instructions for the delegated Responses model, separate from Live instructions.
   * See
   * [backend prompting](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
   */
  instructions?: string | null;

  /**
   * Maximum number of output tokens for each delegated response.
   */
  max_output_tokens?: number | null;

  /**
   * The Responses backend model to use for subsequent delegated requests. Omit to
   * keep the current backend model.
   */
  model?: string;

  /**
   * Whether the delegated Responses model may request multiple tool calls in a
   * single response.
   */
  parallel_tool_calls?: boolean | null;

  /**
   * Reasoning settings passed to each delegated Responses request.
   */
  reasoning?: ResponsesDelegationUpdateConfig.Reasoning | null;

  /**
   * Service tier for delegated Responses requests.
   */
  service_tier?: 'auto' | 'default' | 'fast_tier_temp_pilot' | 'flex' | 'priority' | 'ultrafast' | null;

  /**
   * Text generation settings passed to each delegated Responses request.
   */
  text?: ResponsesDelegationUpdateConfig.Text | null;

  /**
   * Controls which tool the Responses backend uses when handling a task delegated by
   * the Live model.
   */
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | ResponsesDelegationUpdateConfig.LiveFunctionToolChoiceParam
    | ResponsesDelegationUpdateConfig.LiveMCPToolChoiceParam;

  /**
   * Tools available to the Responses backend while it handles tasks delegated by the
   * Live model.
   */
  tools?: Array<FunctionTool | ResponsesDelegationUpdateConfig.WebSearch>;
}

export namespace ResponsesDelegationUpdateConfig {
  /**
   * Reasoning settings passed to each delegated Responses request.
   */
  export interface Reasoning {
    /**
     * How much reasoning effort the delegated Responses model should use. Supported
     * values depend on the backend model.
     */
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;

    /**
     * The reasoning summary to request from the delegated Responses model, when
     * supported.
     */
    summary?: 'concise' | 'detailed' | 'auto' | null;
  }

  /**
   * Text generation settings passed to each delegated Responses request.
   */
  export interface Text {
    /**
     * The amount of detail in text generated by the Responses backend. This does not
     * configure the Live model’s spoken delivery.
     */
    verbosity?: 'low' | 'medium' | 'high' | null;
  }

  export interface LiveFunctionToolChoiceParam {
    name: string;

    type: 'function';
  }

  export interface LiveMCPToolChoiceParam {
    name: string;

    server_label: string;

    type: 'mcp';
  }

  /**
   * A web search tool available to the Live session’s Responses backend.
   */
  export interface WebSearch {
    /**
     * The tool type. Always `web_search`.
     */
    type: 'web_search';
  }
}

/**
 * Server events for Live. Response lifecycle events are wrapped inside
 * response.event; dispatch the nested event by its full type and tolerate new
 * response event types. Follow the
 * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
 * when designing the conversation and delegation policy.
 */
export type ServerEvent =
  | SessionStartedEvent
  | SessionUpdatedEvent
  | InputAudioMutedEvent
  | InputAudioUnmutedEvent
  | InstructionsAppendedEvent
  | ThinkingAppendedEvent
  | CommentaryAppendedEvent
  | ServerEvent.SessionInputAudioAppend
  | OutputAudioDeltaEvent
  | InputTranscriptDeltaEvent
  | OutputTranscriptDeltaEvent
  | DelegationCreatedEvent
  | ResponseEvent
  | SessionUsageUpdatedEvent
  | SessionClosedEvent
  | ErrorEvent
  | InfoEvent
  | ServerEvent.TransportDtmfReceived
  | ServerEvent.TransportDtmfSend
  | ServerEvent.TransportRinging
  | ServerEvent.TransportAnswered
  | ServerEvent.TransportFailed;

export namespace ServerEvent {
  /**
   * Input audio received from the primary transport and reflected to a Live sideband
   * connection before model-input muting.
   */
  export interface SessionInputAudioAppend {
    /**
     * Base64-encoded raw mono PCM16LE at 24 kHz received from the primary transport,
     * reflected to the sideband before model-input muting. This server event uses the
     * same audio key as the client command, but is not an acknowledgment of it.
     */
    audio: string;

    /**
     * The event type, always `session.input_audio.append`.
     */
    type: 'session.input_audio.append';
  }

  /**
   * A SIP DTMF keypress received from the caller. Delivered only to sideband
   * observers.
   */
  export interface TransportDtmfReceived {
    event: string;

    event_id: string;

    type: 'transport.dtmf.received';
  }

  /**
   * A SIP DTMF keypress successfully sent by the hosted tool. Delivered only to
   * sideband observers; this is not a client command.
   */
  export interface TransportDtmfSend {
    event: string;

    event_id: string;

    type: 'transport.dtmf.send';
  }

  /**
   * The outbound SIP provider leg is ringing or providing early media. Delivered
   * only to sideband observers.
   */
  export interface TransportRinging {
    event_id: string;

    /**
     * The canonical Live session ID.
     */
    session_id: string;

    type: 'transport.ringing';
  }

  /**
   * The outbound SIP provider leg answered and media is established. Delivered only
   * to sideband observers.
   */
  export interface TransportAnswered {
    event_id: string;

    /**
     * The canonical Live session ID.
     */
    session_id: string;

    type: 'transport.answered';
  }

  /**
   * An asynchronous outbound SIP setup failure. Delivered only to sideband
   * observers.
   */
  export interface TransportFailed {
    error: TransportFailed.Error;

    event_id: string;

    /**
     * The canonical Live session ID.
     */
    session_id: string;

    type: 'transport.failed';
  }

  export namespace TransportFailed {
    export interface Error {
      /**
       * The call setup failure code.
       */
      code: string;

      message: string;

      type: 'call_error';

      /**
       * The parameter related to the error, if any. Empty when no parameter applies.
       */
      param?: string;
    }
  }
}

/**
 * A Live server event selector for the WebRTC frontend data channel.
 */
export interface ServerEventSelector {
  /**
   * The outer Live server event type. Use 'response.event' for Responses events.
   */
  type: string;

  /**
   * The nested Responses event type. Required when type is 'response.event';
   * forbidden for other event types.
   */
  response_event?: string;
}

/**
 * Request that the Live session close. The terminal `session.closed` event
 * contains the close reason and final usage.
 */
export interface SessionCloseEvent {
  /**
   * The Live client event type. Always `session.close`.
   */
  type: 'session.close';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned after the Live session finishes finalizing, with the close reason,
 * final session snapshot, and cumulative audio usage. A connection closing without
 * this event does not confirm successful finalization.
 */
export interface SessionClosedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * Why the Live session ended: `close_requested` for an application close or hangup
   * request, `expired` for the session duration limit, `content` for a safety
   * filter, `remote_hangup` for a graceful remote disconnect, or `connection_lost`
   * for an unexpected primary or upstream disconnection.
   */
  reason: 'close_requested' | 'expired' | 'content' | 'remote_hangup' | 'connection_lost';

  /**
   * The resolved Live session configuration and server-assigned session metadata.
   */
  session: SessionResource;

  /**
   * The event type, always `session.closed`.
   */
  type: 'session.closed';

  /**
   * The final cumulative Live audio usage after session finalization.
   */
  usage: SessionUsage;

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Initial configuration for a Live session, including its model, conversation
 * instructions, audio, and delegated task handling.
 */
export interface SessionConfig {
  /**
   * The Live model. Required in the session configuration for every transport; do
   * not pass it as a URL query parameter.
   */
  model: (string & {}) | 'gpt-live-1';

  /**
   * Startup audio configuration. Only primary WebSockets accept audio.format; WebRTC
   * and SIP negotiate their media format. Voice and format are immutable after
   * startup.
   */
  audio?: SessionConfig.Audio;

  /**
   * Startup-only capabilities for an untrusted frontend attached to a unified WebRTC
   * session. Trusted sideband connections are unaffected.
   */
  client?: ClientConfig;

  /**
   * Who handles tasks delegated by the Live model. Omitted or null selects your
   * application; use `responses` to let the API manage a Responses backend.
   */
  delegation?: ClientDelegation | SessionConfig.Responses | null;

  /**
   * Ordered text-only history supplied before startup. Supports developer, user, and
   * assistant messages with one text part each; at most 128 messages and 8,192
   * rendered tokens in total.
   */
  input?: Array<InitialItem>;

  /**
   * Frontend instructions for voice, conversation, interruptions, and when to
   * delegate. Start with the
   * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting);
   * put business rules and tool workflows in a separate
   * [backend prompt](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
   * Limited to 16,384 client-supplied tokens. Omitted or blank instructions use
   * server defaults. Immutable after startup.
   */
  instructions?: string | null;

  /**
   * Whether to store the session for later forking and recording download. Defaults
   * to false for new sessions.
   */
  store?: boolean;
}

export namespace SessionConfig {
  /**
   * Startup audio configuration. Only primary WebSockets accept audio.format; WebRTC
   * and SIP negotiate their media format. Voice and format are immutable after
   * startup.
   */
  export interface Audio {
    /**
     * Audio encoding and sample rate for audio sent and received over a Live WebSocket
     * connection. WebRTC and SIP negotiate their media format separately.
     */
    format?: LiveAPI.AudioFormat;

    /**
     * The voice used for speech generated by the Live model.
     */
    output?: Audio.Output;
  }

  export namespace Audio {
    /**
     * The voice used for speech generated by the Live model.
     */
    export interface Output {
      /**
       * The voice used for Live speech, as a built-in voice name or a custom voice
       * object containing its ID. Defaults to `marin` and cannot change after startup.
       */
      voice?: string | LiveAPI.BuiltInVoice | LiveAPI.CustomVoice;
    }
  }

  /**
   * Delegate tasks to a Responses model managed by the Live session.
   */
  export interface Responses {
    /**
     * Backend model, prompt, and tools used when the Live session delegates a task to
     * Responses.
     */
    responses: LiveAPI.ResponsesDelegationConfig;

    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';
  }
}

/**
 * The resolved Live session configuration and server-assigned session metadata.
 */
export interface SessionResource {
  /**
   * The unique ID of the Live session. Use this ID for sideband connections,
   * forking, and recording download.
   */
  id: string;

  /**
   * The Unix timestamp, in seconds, at which the Live session expires.
   */
  expires_at: number;

  /**
   * The Live model. Required in the session configuration for every transport; do
   * not pass it as a URL query parameter.
   */
  model: (string & {}) | 'gpt-live-1';

  /**
   * The status of the session snapshot. Always `active`, including the final
   * snapshot in session.closed; use the event type to determine that the session has
   * closed.
   */
  status: 'active';

  /**
   * Startup audio configuration. Only primary WebSockets accept audio.format; WebRTC
   * and SIP negotiate their media format. Voice and format are immutable after
   * startup.
   */
  audio?: SessionResource.Audio;

  /**
   * Startup-only capabilities for an untrusted frontend attached to a unified WebRTC
   * session. Trusted sideband connections are unaffected.
   */
  client?: ClientConfig;

  /**
   * Who handles tasks delegated by the Live model. Omitted or null selects your
   * application; use `responses` to let the API manage a Responses backend.
   */
  delegation?: ClientDelegation | SessionResource.Responses | null;

  /**
   * Ordered text-only history supplied before startup. Supports developer, user, and
   * assistant messages with one text part each; at most 128 messages and 8,192
   * rendered tokens in total.
   */
  input?: Array<InitialItem>;

  /**
   * Frontend instructions for voice, conversation, interruptions, and when to
   * delegate. Start with the
   * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting);
   * put business rules and tool workflows in a separate
   * [backend prompt](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
   * Limited to 16,384 client-supplied tokens. Omitted or blank instructions use
   * server defaults. Immutable after startup.
   */
  instructions?: string | null;

  /**
   * Whether to store the session for later forking and recording download. Defaults
   * to false for new sessions.
   */
  store?: boolean;
}

export namespace SessionResource {
  /**
   * Startup audio configuration. Only primary WebSockets accept audio.format; WebRTC
   * and SIP negotiate their media format. Voice and format are immutable after
   * startup.
   */
  export interface Audio {
    /**
     * Audio encoding and sample rate for audio sent and received over a Live WebSocket
     * connection. WebRTC and SIP negotiate their media format separately.
     */
    format?: LiveAPI.AudioFormat;

    /**
     * The voice used for speech generated by the Live model.
     */
    output?: Audio.Output;
  }

  export namespace Audio {
    /**
     * The voice used for speech generated by the Live model.
     */
    export interface Output {
      /**
       * The voice used for Live speech, as a built-in voice name or a custom voice
       * object containing its ID. Defaults to `marin` and cannot change after startup.
       */
      voice?: string | LiveAPI.BuiltInVoice | LiveAPI.CustomVoice;
    }
  }

  /**
   * Delegate tasks to a Responses model managed by the Live session.
   */
  export interface Responses {
    /**
     * Backend model, prompt, and tools used when the Live session delegates a task to
     * Responses.
     */
    responses: LiveAPI.ResponsesDelegationConfig;

    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';
  }
}

/**
 * Start a Live session on a primary WebSocket. Send this event before other
 * commands and wait for `session.started`.
 */
export interface SessionStartEvent {
  /**
   * Initial configuration for a primary WebSocket. Send session.start first and wait
   * for session.started before application commands. WebRTC creation already starts
   * the session; do not send this event again on its data channel.
   */
  session: SessionConfig;

  /**
   * The Live client event type. Always `session.start`.
   */
  type: 'session.start';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a Live session has started. Contains the resolved session
 * configuration, including server defaults.
 */
export interface SessionStartedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The resolved Live session configuration and server-assigned session metadata.
   */
  session: SessionResource;

  /**
   * The event type, always `session.started`.
   */
  type: 'session.started';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Changes to an active Live session. Only delegation backend settings can be
 * updated after startup.
 */
export interface SessionUpdateConfig {
  /**
   * Delegation settings to update. The delegation type must match the current
   * session; omitted settings retain their values.
   */
  delegation?: ClientDelegation | SessionUpdateConfig.Responses | null;
}

export namespace SessionUpdateConfig {
  /**
   * Update the Responses backend for an existing Live session without changing
   * delegation ownership.
   */
  export interface Responses {
    /**
     * The delegation owner. Always `responses` for tasks handled by the Responses API.
     */
    type: 'responses';

    /**
     * Responses backend settings to update. Omitted settings keep their existing
     * values.
     */
    responses?: LiveAPI.ResponsesDelegationUpdateConfig;
  }
}

/**
 * Update the delegation settings of an active Live session. The server
 * acknowledges accepted changes with `session.updated`.
 */
export interface SessionUpdateEvent {
  /**
   * Sparse delegation updates. Omitted settings retain their values. The delegation
   * type cannot change, including resetting Responses delegation to null or client.
   * Model, frontend instructions, audio, and startup input are immutable.
   */
  session: SessionUpdateConfig;

  /**
   * The Live client event type. Always `session.update`.
   */
  type: 'session.update';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a Live session update is accepted. Contains the resolved session
 * configuration after the update.
 */
export interface SessionUpdatedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The resolved Live session configuration and server-assigned session metadata.
   */
  session: SessionResource;

  /**
   * The event type, always `session.updated`.
   */
  type: 'session.updated';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * Cumulative audio duration for a Live session. Values are totals for the session,
 * not increments to sum across usage events.
 */
export interface SessionUsage {
  /**
   * The cumulative Live audio duration in seconds. Do not sum this value across
   * usage events.
   */
  seconds: number;
}

/**
 * Reports cumulative Live audio usage and, when available, the most recent
 * context-window usage. Delegated Responses token usage is reported separately in
 * response.event events.
 */
export interface SessionUsageUpdatedEvent {
  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The event type, always `session.usage.updated`.
   */
  type: 'session.usage.updated';

  /**
   * The cumulative Live audio usage so far.
   */
  usage: SessionUsage;

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;

  /**
   * The latest measured Live context-window usage. Omitted when the context limit is
   * unknown.
   */
  context_window?: SessionUsageUpdatedEvent.ContextWindow;
}

export namespace SessionUsageUpdatedEvent {
  /**
   * The latest measured Live context-window usage. Omitted when the context limit is
   * unknown.
   */
  export interface ContextWindow {
    /**
     * The latest active context token count divided by the Live model context limit.
     * Can decrease after compaction and may lag between measured audio frames.
     */
    usage_ratio: number;
  }
}

/**
 * Provide silent reasoning or progress context to the Live model, optionally for
 * an existing client delegation.
 */
export interface ThinkingAppendEvent {
  /**
   * Silent reasoning or progress context, limited to 500 tokens. It does not
   * directly request speech, but can influence later speech and is not a secrecy
   * boundary.
   */
  content: string;

  /**
   * Required, nullable. Set null for general session context, or use the ID from
   * session.delegation.created for an existing client delegation. Non-null IDs are
   * not accepted with Responses delegation.
   */
  delegation_id: string | null;

  /**
   * The Live client event type. Always `session.thinking.append`.
   */
  type: 'session.thinking.append';

  /**
   * Optional client identifier for correlating this command with a server event's
   * client_event_id or error.client_event_id.
   */
  event_id?: string | null;
}

/**
 * Returned when a session.thinking.append command is accepted into the Live
 * session timeline. Acknowledges the added reasoning context without guaranteeing
 * any spoken output.
 */
export interface ThinkingAppendedEvent {
  /**
   * The end of this event on the Live session timeline, in milliseconds from the
   * beginning of the session. For appended context, this can equal start_ms.
   */
  end_ms: number;

  /**
   * The unique ID of the Live server event.
   */
  event_id: string;

  /**
   * The start of this event on the Live session timeline, in milliseconds from the
   * beginning of the session.
   */
  start_ms: number;

  /**
   * The event type, always `session.thinking.appended`.
   */
  type: 'session.thinking.appended';

  /**
   * The event_id of the client command associated with this server event, when
   * supplied.
   */
  client_event_id?: string;
}

/**
 * The created Live session identifier and WebRTC answer. Apply transport.sdp as
 * the peer's remote answer and wait for session.started on the data channel before
 * sending commands.
 */
export interface LiveCreateResponse {
  /**
   * The newly created Live session. Use its ID for session controls and sideband
   * connections.
   */
  session: LiveCreateResponse.Session;

  /**
   * WebRTC transport with the SDP answer.
   */
  transport: LiveCreateResponse.Transport;
}

export namespace LiveCreateResponse {
  /**
   * The newly created Live session. Use its ID for session controls and sideband
   * connections.
   */
  export interface Session {
    /**
     * Opaque session identifier. Preserve the returned value unchanged, including its
     * prefix.
     */
    id: string;
  }

  /**
   * WebRTC transport with the SDP answer.
   */
  export interface Transport {
    /**
     * Session Description Protocol message for the WebRTC connection.
     */
    sdp: string;

    /**
     * The transport used for the Live session. Always `webrtc`.
     */
    type: 'webrtc';
  }
}

export interface LiveCreateParams {
  /**
   * Startup configuration for the Live session.
   */
  session: MediaSessionConfig;

  /**
   * WebRTC transport with the browser's SDP offer.
   */
  transport: LiveCreateParams.Transport;
}

export namespace LiveCreateParams {
  /**
   * WebRTC transport with the browser's SDP offer.
   */
  export interface Transport {
    /**
     * Session Description Protocol message for the WebRTC connection.
     */
    sdp: string;

    /**
     * The transport used for the Live session. Always `webrtc`.
     */
    type: 'webrtc';
  }
}

Live.Sideband = Sideband;
Live.Forks = Forks;
Live.Sessions = Sessions;

export declare namespace Live {
  export {
    type AudioFormat as AudioFormat,
    type BuiltInVoice as BuiltInVoice,
    type ClientConfig as ClientConfig,
    type ClientDelegation as ClientDelegation,
    type ClientEvent as ClientEvent,
    type CommentaryAppendEvent as CommentaryAppendEvent,
    type CommentaryAppendedEvent as CommentaryAppendedEvent,
    type CustomVoice as CustomVoice,
    type DataChannelConfig as DataChannelConfig,
    type DelegationCreatedEvent as DelegationCreatedEvent,
    type Error as Error,
    type ErrorEvent as ErrorEvent,
    type ForkSessionConfig as ForkSessionConfig,
    type ForkSessionStartEvent as ForkSessionStartEvent,
    type FunctionTool as FunctionTool,
    type InfoEvent as InfoEvent,
    type InitialItem as InitialItem,
    type InputAudioAppendEvent as InputAudioAppendEvent,
    type InputAudioMuteEvent as InputAudioMuteEvent,
    type InputAudioMutedEvent as InputAudioMutedEvent,
    type InputAudioUnmuteEvent as InputAudioUnmuteEvent,
    type InputAudioUnmutedEvent as InputAudioUnmutedEvent,
    type InputTranscriptDeltaEvent as InputTranscriptDeltaEvent,
    type InstructionsAppendEvent as InstructionsAppendEvent,
    type InstructionsAppendedEvent as InstructionsAppendedEvent,
    type MediaSessionConfig as MediaSessionConfig,
    type MediaSessionForkConfig as MediaSessionForkConfig,
    type OutputAudioDeltaEvent as OutputAudioDeltaEvent,
    type OutputTranscriptDeltaEvent as OutputTranscriptDeltaEvent,
    type ResponseCreateEvent as ResponseCreateEvent,
    type ResponseEvent as ResponseEvent,
    type ResponseItemCreateEvent as ResponseItemCreateEvent,
    type ResponsesDelegationConfig as ResponsesDelegationConfig,
    type ResponsesDelegationUpdateConfig as ResponsesDelegationUpdateConfig,
    type ServerEvent as ServerEvent,
    type ServerEventSelector as ServerEventSelector,
    type SessionCloseEvent as SessionCloseEvent,
    type SessionClosedEvent as SessionClosedEvent,
    type SessionConfig as SessionConfig,
    type SessionResource as SessionResource,
    type SessionStartEvent as SessionStartEvent,
    type SessionStartedEvent as SessionStartedEvent,
    type SessionUpdateConfig as SessionUpdateConfig,
    type SessionUpdateEvent as SessionUpdateEvent,
    type SessionUpdatedEvent as SessionUpdatedEvent,
    type SessionUsage as SessionUsage,
    type SessionUsageUpdatedEvent as SessionUsageUpdatedEvent,
    type ThinkingAppendEvent as ThinkingAppendEvent,
    type ThinkingAppendedEvent as ThinkingAppendedEvent,
    type LiveCreateResponse as LiveCreateResponse,
    type LiveCreateParams as LiveCreateParams,
  };

  export {
    Sideband as Sideband,
    type ConnectClientEvent as ConnectClientEvent,
    type ConnectServerEvent as ConnectServerEvent,
    type SidebandConnectParams as SidebandConnectParams,
  };

  export { Forks as Forks, type ForkClientEvent as ForkClientEvent, type ForkServerEvent as ForkServerEvent };

  export {
    Sessions as Sessions,
    type SessionForkResponse as SessionForkResponse,
    type SessionAcceptParams as SessionAcceptParams,
    type SessionForkParams as SessionForkParams,
    type SessionReferParams as SessionReferParams,
    type SessionRejectParams as SessionRejectParams,
  };
}
