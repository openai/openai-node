// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as LiveAPI from '../live';

export class Sideband extends APIResource {}

/**
 * Client events accepted by an attached Live sideband WebSocket. The session is
 * already started; send audio over the primary connection.
 */
export type ConnectClientEvent =
  | LiveAPI.SessionUpdateEvent
  | LiveAPI.InputAudioMuteEvent
  | LiveAPI.InputAudioUnmuteEvent
  | LiveAPI.InstructionsAppendEvent
  | LiveAPI.ThinkingAppendEvent
  | LiveAPI.CommentaryAppendEvent
  | LiveAPI.ResponseItemCreateEvent
  | LiveAPI.ResponseCreateEvent
  | LiveAPI.SessionCloseEvent;

/**
 * Server events received by an attached Live sideband WebSocket. Audio deltas are
 * delivered over the primary connection.
 */
export type ConnectServerEvent =
  | LiveAPI.SessionStartedEvent
  | LiveAPI.SessionUpdatedEvent
  | LiveAPI.InputAudioMutedEvent
  | LiveAPI.InputAudioUnmutedEvent
  | LiveAPI.InstructionsAppendedEvent
  | LiveAPI.ThinkingAppendedEvent
  | LiveAPI.CommentaryAppendedEvent
  | LiveAPI.InputTranscriptDeltaEvent
  | LiveAPI.OutputTranscriptDeltaEvent
  | LiveAPI.DelegationCreatedEvent
  | LiveAPI.ResponseEvent
  | LiveAPI.SessionUsageUpdatedEvent
  | LiveAPI.SessionClosedEvent
  | LiveAPI.ErrorEvent
  | LiveAPI.InfoEvent;

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
    type ConnectServerEvent as ConnectServerEvent,
    type SidebandConnectParams as SidebandConnectParams,
  };
}
