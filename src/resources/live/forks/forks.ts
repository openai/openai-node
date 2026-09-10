// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as LiveAPI from '../live';

export class Forks extends APIResource {}

/**
 * Client events for a Live fork WebSocket. First send session.start with an
 * overrides object (which may be empty), then wait for session.started before
 * sending other commands. The model and conversation are inherited from the stored
 * session.
 */
export type ForkClientEvent =
  | LiveAPI.ForkSessionStartEvent
  | LiveAPI.SessionUpdateEvent
  | LiveAPI.InputAudioAppendEvent
  | LiveAPI.InputAudioMuteEvent
  | LiveAPI.InputAudioUnmuteEvent
  | LiveAPI.InstructionsAppendEvent
  | LiveAPI.ThinkingAppendEvent
  | LiveAPI.CommentaryAppendEvent
  | LiveAPI.ResponseItemCreateEvent
  | LiveAPI.ResponseCreateEvent
  | LiveAPI.SessionCloseEvent;

/**
 * Server events for Live. Response lifecycle events are wrapped inside
 * response.event; dispatch the nested event by its full type and tolerate new
 * response event types. Follow the
 * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
 * when designing the conversation and delegation policy.
 */
export type ForkServerEvent =
  | LiveAPI.SessionStartedEvent
  | LiveAPI.SessionUpdatedEvent
  | LiveAPI.InputAudioMutedEvent
  | LiveAPI.InputAudioUnmutedEvent
  | LiveAPI.InstructionsAppendedEvent
  | LiveAPI.ThinkingAppendedEvent
  | LiveAPI.CommentaryAppendedEvent
  | ForkServerEvent.SessionInputAudioAppend
  | LiveAPI.OutputAudioDeltaEvent
  | LiveAPI.InputTranscriptDeltaEvent
  | LiveAPI.OutputTranscriptDeltaEvent
  | LiveAPI.DelegationCreatedEvent
  | LiveAPI.ResponseEvent
  | LiveAPI.SessionUsageUpdatedEvent
  | LiveAPI.SessionClosedEvent
  | LiveAPI.ErrorEvent
  | LiveAPI.InfoEvent
  | ForkServerEvent.TransportDtmfReceived
  | ForkServerEvent.TransportDtmfSend
  | ForkServerEvent.TransportRinging
  | ForkServerEvent.TransportAnswered
  | ForkServerEvent.TransportFailed;

export namespace ForkServerEvent {
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

export declare namespace Forks {
  export { type ForkClientEvent as ForkClientEvent, type ForkServerEvent as ForkServerEvent };
}
