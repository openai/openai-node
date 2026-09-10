/* oxlint-disable max-classes-per-file -- Both thin facades belong to the same public Realtime WebRTC entrypoint. */
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/realtime/realtime';
import { WebRTCConnection } from '../webrtc/connection';
import { DataChannel } from '../webrtc/data-channel';

export { WebRTCError } from '../webrtc/errors';
export type { WebRTCErrorCode, WebRTCErrorPhase } from '../webrtc/errors';
export type {
  ExchangeSdp,
  WebRTCConnectOptions,
  WebRTCConnectionEvent,
  WebRTCConfiguration,
  WebRTCState,
} from '../webrtc/types';

/** Browser Realtime connection with application-owned SDP exchange and typed server-event subscriptions. */
export class OpenAIRealtimeWebRTC extends WebRTCConnection<RealtimeClientEvent, RealtimeServerEvent> {}

/** Typed Realtime events on a borrowed data channel; dispose() never closes application resources. */
export class RealtimeDataChannel extends DataChannel<RealtimeClientEvent, RealtimeServerEvent> {}
