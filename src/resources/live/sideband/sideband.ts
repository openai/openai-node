// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as LiveAPI from '../live';

export class Sideband extends APIResource {}

export type SidebandClientEvent = ConnectClientEvent;

export type SidebandServerEvent = ConnectServerEvent;

/**
 * Client events accepted by an attached Live sideband WebSocket. The session has
 * already started. Send input audio over the primary connection.
 */
export type ConnectClientEvent =
  | LiveAPI.SessionUpdateEvent
  | LiveAPI.InputAudioMuteEvent
  | LiveAPI.InputAudioUnmuteEvent
  | LiveAPI.OutputAudioFixturePlayEvent
  | ConnectClientEvent.TransportDtmfSend
  | LiveAPI.InstructionsAppendEvent
  | LiveAPI.ThinkingAppendEvent
  | LiveAPI.CommentaryAppendEvent
  | LiveAPI.DecisionCreateEvent
  | LiveAPI.DecisionItemCreateEvent
  | LiveAPI.DecisionItemDeleteEvent
  | LiveAPI.ResponseItemCreateEvent
  | LiveAPI.ResponseCreateEvent
  | LiveAPI.SessionCloseEvent;

export namespace ConnectClientEvent {
  /**
   * Send one DTMF keypress to the SIP trunk through a Live sideband connection. This
   * command is supported only for SIP calls. A successful send emits
   * `transport.dtmf.sent` on sideband. If you provide `event_id`, the success
   * notification includes it as `client_event_id`; a failure includes it as
   * `error.client_event_id`. Send separate events for multiple keypresses.
   */
  export interface TransportDtmfSend {
    /**
     * The DTMF key to send: one of `0`–`9`, `A`–`D`, `*`, or `#`.
     */
    event: string;

    type: 'transport.dtmf.send';

    /**
     * Optional client identifier for correlating this command with a server event's
     * client_event_id or error.client_event_id.
     */
    event_id?: string | null;
  }
}

/**
 * Server events received by an attached Live sideband WebSocket, including
 * reflected input and output audio and transport notifications.
 */
export type ConnectServerEvent =
  | LiveAPI.SessionStartedEvent
  | LiveAPI.SessionUpdatedEvent
  | LiveAPI.InputAudioMutedEvent
  | LiveAPI.InputAudioUnmutedEvent
  | LiveAPI.OutputAudioFixturePlayingEvent
  | LiveAPI.OutputAudioFixturePlayedEvent
  | LiveAPI.InstructionsAppendedEvent
  | LiveAPI.ThinkingAppendedEvent
  | LiveAPI.CommentaryAppendedEvent
  | LiveAPI.InputTranscriptDeltaEvent
  | LiveAPI.OutputTranscriptDeltaEvent
  | LiveAPI.DelegationCreatedEvent
  | LiveAPI.DecisionEvent
  | LiveAPI.DecisionItemCreatedEvent
  | LiveAPI.DecisionItemDeletedEvent
  | LiveAPI.ResponseEvent
  | LiveAPI.SessionUsageUpdatedEvent
  | LiveAPI.SessionClosedEvent
  | LiveAPI.ErrorEvent
  | LiveAPI.InfoEvent
  | ConnectServerEvent.SessionInputAudioAppend
  | LiveAPI.OutputAudioDeltaEvent
  | ConnectServerEvent.TransportDtmfReceived
  | ConnectServerEvent.TransportDtmfSend
  | ConnectServerEvent.TransportDtmfSent
  | ConnectServerEvent.TransportRinging
  | ConnectServerEvent.TransportAnswered
  | ConnectServerEvent.TransportFailed;

export namespace ConnectServerEvent {
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
   * Legacy SIP DTMF delivery notification retained for SDK compatibility and saved
   * events. Current servers confirm delivery with transport.dtmf.sent;
   * transport.dtmf.send is now the client command.
   */
  export interface TransportDtmfSend {
    event: string;

    event_id: string;

    type: 'transport.dtmf.send';

    /**
     * The event_id of the client command, when supplied.
     */
    client_event_id?: string;
  }

  /**
   * A SIP DTMF keypress successfully sent to the SIP trunk. Delivered only to
   * sideband observers; this is not a client command.
   */
  export interface TransportDtmfSent {
    event: string;

    event_id: string;

    type: 'transport.dtmf.sent';

    /**
     * The event_id of the client command, when supplied.
     */
    client_event_id?: string;
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

export interface SidebandConnectParams {
  /**
   * Opt in to the graceful WebSocket closing handshake when the session ends. The
   * server may also enable this behavior by default.
   */
  graceful_close?: boolean;
}

export declare namespace Sideband {
  export {
    type ConnectClientEvent as ConnectClientEvent,
    type SidebandClientEvent as SidebandClientEvent,
    type ConnectServerEvent as ConnectServerEvent,
    type SidebandServerEvent as SidebandServerEvent,
    type SidebandConnectParams as SidebandConnectParams,
  };
}
