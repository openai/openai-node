import type { WebRTCError } from './errors';

/** A native event source, without requiring DOM declarations in server projects. */
export interface WebRTCEventTarget {
  /** Registers a native event listener. */
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  /** Removes a previously registered native event listener. */
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
}

/** The subset of a native data channel used by the SDK. */
export interface WebRTCDataChannel extends WebRTCEventTarget {
  /** Native channel readiness; sending requires `open`. */
  readonly readyState: string;
  /** Sends one serialized protocol message. */
  send: (data: string) => void;
  /** Closes this channel. Borrowed adapters never call this method. */
  close: () => void;
}

/** The subset of a native peer connection used by negotiation. */
export interface WebRTCPeerConnection extends WebRTCEventTarget {
  /** Native connection state, including transient `disconnected` states. */
  readonly connectionState: string;
  /** The local description after `setLocalDescription`. */
  readonly localDescription: { readonly sdp: string } | null;
  /** Creates the protocol data channel before generating an SDP offer. */
  createDataChannel: (label: string) => WebRTCDataChannel;
  /** Generates the local SDP offer. */
  createOffer: () => Promise<{ type: 'answer' | 'offer' | 'pranswer' | 'rollback'; sdp?: string }>;
  /** Applies the offer to the local peer. */
  setLocalDescription: (description: {
    type?: 'answer' | 'offer' | 'pranswer' | 'rollback';
    sdp?: string;
  }) => Promise<void>;
  /** Applies the application's SDP answer. */
  setRemoteDescription: (description: { type: 'answer'; sdp: string }) => Promise<void>;
  /** Releases the peer connection, without stopping application-owned tracks. */
  close: () => void;
}

/** Native browser peer type when DOM types are available; otherwise the SDK's minimal view. */
export type BrowserPeerConnection = typeof globalThis extends {
  RTCPeerConnection: { prototype: infer Peer };
}
  ? Peer
  : WebRTCPeerConnection;

/** Native browser channel type when DOM types are available. */
export type BrowserDataChannel = typeof globalThis extends {
  RTCDataChannel: { prototype: infer Channel };
}
  ? Channel
  : WebRTCDataChannel;

/** Standard RTCConfiguration in a browser project; no runtime polyfill is installed. */
export type WebRTCConfiguration = typeof globalThis extends {
  RTCPeerConnection: new (configuration?: infer Configuration) => unknown;
}
  ? Configuration
  : object;

/** Exchanges a local SDP offer for an SDP answer using application-owned signaling. */
export type ExchangeSdp = (
  offer: string,
  options: {
    /** Aborted when setup is cancelled, times out, or fails; pass it to fetch. */
    signal: AbortSignal;
  },
) => Promise<string>;

/** Options for one connection attempt. No retries or reconnection are performed. */
export interface WebRTCConnectOptions {
  /** Application callback that submits the offer and returns the SDP answer. */
  exchangeSdp: ExchangeSdp;
  /** Cancels setup only. After connection succeeds, use close() to end the connection. */
  signal?: AbortSignal;
  /** Total setup deadline in milliseconds; defaults to 30,000. Must be positive and finite. */
  timeoutMs?: number;
}

/** SDK connection state. A closed instance cannot be connected again. */
export type WebRTCState = 'new' | 'connecting' | 'connected' | 'closed';

/** Why a connection ended. Setup failures are also returned by connect(). */
export type WebRTCCloseReason = 'local' | 'remote' | 'failed' | 'aborted' | 'timeout';

/** Local lifecycle and diagnostics, separate from server protocol events. */
export type WebRTCConnectionEvent =
  | {
      /** A connection became usable or began setup. */
      type: 'state.changed';
      /** The new state. There is no replay on subscription. */
      state: 'connecting' | 'connected';
    }
  | {
      /** An unsolicited local failure, not an API error event. */
      type: 'error';
      /** The local diagnostic. Messages never contain raw protocol payloads. */
      error: WebRTCError;
      /** Whether the managed helper is ending this connection. */
      fatal: boolean;
    }
  | {
      /** The connection ended; emitted at most once. */
      type: 'closed';
      /** Whether closure was requested, observed, or caused by a setup/transport failure. */
      reason: WebRTCCloseReason;
    };
