/* oxlint-disable max-classes-per-file -- Both thin facades belong to the same public Live WebRTC entrypoint. */
import type {
  ConnectClientEvent as ClientEvent,
  ConnectServerEvent as ServerEvent,
} from '../../resources/live/sideband/sideband';
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

/** Browser Live connection with application-owned SDP exchange and typed server-event subscriptions. */
export class OpenAILiveWebRTC extends WebRTCConnection<ClientEvent, ServerEvent> {}

/** Typed Live events on a borrowed data channel; dispose() never closes application resources. */
export class LiveDataChannel extends DataChannel<ClientEvent, ServerEvent> {}
