import { DataChannel } from './data-channel';
import { WebRTCError } from './errors';
import type { WebRTCErrorPhase } from './errors';
import { Subscriptions } from './subscriptions';
import type {
  BrowserDataChannel,
  BrowserPeerConnection,
  WebRTCConfiguration,
  WebRTCConnectOptions,
  WebRTCConnectionEvent,
  WebRTCCloseReason,
  WebRTCPeerConnection,
  WebRTCState,
} from './types';

interface Attempt {
  controller: AbortController;
  phase: WebRTCErrorPhase;
  answered: boolean;
  resolve: () => void;
  reject: (error: WebRTCError) => void;
  cleanup: () => void;
}

/** Browser-native WebRTC negotiation with application-owned SDP signaling. */
export class WebRTCConnection<ClientEvent, ServerEvent extends { type: string }> {
  /** Native peer connection; configure application-owned media before connect(). */
  readonly peerConnection: BrowserPeerConnection;
  /** Native ordered, reliable channel carrying protocol events. */
  readonly dataChannel: BrowserDataChannel;
  private readonly peer: WebRTCPeerConnection;
  private readonly adapter: DataChannel<ClientEvent, ServerEvent>;
  private readonly connectionEvents = new Subscriptions<WebRTCConnectionEvent>();
  private currentState: WebRTCState = 'new';
  private attempt: Attempt | undefined;

  /** Creates native resources, but does not request media, contact a server, or begin negotiation. */
  constructor(configuration?: WebRTCConfiguration) {
    const host = globalThis as typeof globalThis & {
      RTCPeerConnection?: new (configuration?: WebRTCConfiguration) => WebRTCPeerConnection;
    };
    if (!host.RTCPeerConnection) {
      throw new WebRTCError(
        'unsupported_environment',
        'transport',
        'WebRTC requires a browser with RTCPeerConnection.',
      );
    }
    const peer = new host.RTCPeerConnection(configuration);
    try {
      this.adapter = new DataChannel(peer.createDataChannel('oai-events'));
    } catch (error) {
      peer.close();
      throw new WebRTCError(
        'negotiation_failed',
        'transport',
        'Could not create the WebRTC data channel.',
        error,
      );
    }
    this.peer = peer;
    this.peerConnection = peer as BrowserPeerConnection;
    this.dataChannel = this.adapter.dataChannel;
    peer.addEventListener('connectionstatechange', this.onPeerState);
    this.adapter.onConnectionEvent(this.onChannelEvent);
  }

  /** Current state, including before subscriptions are registered; notifications are not replayed. */
  get state(): WebRTCState {
    return this.currentState;
  }

  /** Subscribes to one server event type with its generated payload; returns an independent unsubscribe function. */
  on<Type extends ServerEvent['type']>(
    type: Type,
    handler: (event: Extract<ServerEvent, { type: Type }>) => unknown,
  ): () => void {
    return this.adapter.on(type, handler);
  }

  /** Subscribes before connecting so initial server events are observable. API errors remain protocol data. */
  onEvent(handler: (event: ServerEvent) => unknown): () => void {
    return this.adapter.onEvent(handler);
  }

  /** Subscribes to local diagnostics and lifecycle. Setup failures reject connect() instead of emitting errors here. */
  onConnectionEvent(handler: (event: WebRTCConnectionEvent) => unknown): () => void {
    if (this.currentState === 'closed') {
      throw new WebRTCError('invalid_state', 'transport', 'The WebRTC connection is closed.');
    }
    return this.connectionEvents.add(handler);
  }

  /** Sends without buffering; returning means local submission, not server acceptance. */
  send(event: ClientEvent): void {
    this.adapter.send(event);
  }

  /** Negotiates once and waits for both native connection and data-channel readiness. Defaults to a 30-second deadline. */
  connect(options: WebRTCConnectOptions): Promise<void> {
    if (this.currentState !== 'new') {
      return Promise.reject(
        new WebRTCError('invalid_state', 'transport', 'connect() may only be called once per connection.'),
      );
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      return Promise.reject(
        new WebRTCError('invalid_state', 'transport', 'timeoutMs must be a positive finite timer duration.'),
      );
    }
    const controller = new AbortController();
    // oxlint-disable-next-line promise/avoid-new -- Native readiness, timeout, and abort events settle one connection attempt.
    const result = new Promise<void>((resolve, reject) => {
      const onAbort = () =>
        this.failSetup(
          new WebRTCError(
            'aborted',
            this.attempt?.phase ?? 'offer',
            'WebRTC setup was cancelled.',
            options.signal?.reason,
          ),
          'aborted',
        );
      const timer = setTimeout(
        () =>
          this.failSetup(
            new WebRTCError('timeout', this.attempt?.phase ?? 'offer', 'WebRTC setup timed out.'),
            'timeout',
          ),
        timeoutMs,
      );
      this.attempt = {
        controller,
        phase: 'offer',
        answered: false,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
        },
      };
      this.currentState = 'connecting';
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      this.connectionEvents.emit({ type: 'state.changed', state: 'connecting' });
    });
    const { attempt } = this;
    if (attempt) {
      void this.negotiate(options, attempt);
    }
    return result;
  }

  /** Idempotently closes owned native resources. It never stops application-supplied media tracks. */
  close(): void {
    if (this.attempt) {
      this.failSetup(
        new WebRTCError('aborted', this.attempt.phase, 'WebRTC setup was closed by the application.'),
        'local',
      );
    } else {
      this.finish('local');
    }
  }

  private async negotiate(options: WebRTCConnectOptions, attempt: Attempt): Promise<void> {
    try {
      const offer = await this.peer.createOffer();
      if (this.attempt !== attempt) {
        return;
      }
      await this.peer.setLocalDescription(offer);
      if (this.attempt !== attempt) {
        return;
      }
      const sdp = this.peer.localDescription?.sdp;
      if (!sdp) {
        throw new Error('The local description has no SDP.');
      }
      attempt.phase = 'signaling';
      const answer = await options.exchangeSdp(sdp, { signal: attempt.controller.signal });
      if (this.attempt !== attempt) {
        return;
      }
      if (typeof answer !== 'string' || answer.length === 0) {
        throw new TypeError('The SDP callback must return a nonempty string.');
      }
      attempt.phase = 'answer';
      await this.peer.setRemoteDescription({ type: 'answer', sdp: answer });
      if (this.attempt !== attempt) {
        return;
      }
      attempt.answered = true;
      attempt.phase = 'transport';
      this.checkReady();
    } catch (error) {
      if (this.attempt !== attempt) {
        return;
      }
      this.failSetup(
        new WebRTCError(
          attempt.phase === 'signaling' ? 'signaling_failed' : 'negotiation_failed',
          attempt.phase,
          'Could not establish the WebRTC connection.',
          error,
        ),
        'failed',
      );
    }
  }

  private checkReady(): void {
    const { attempt } = this;
    if (
      !attempt?.answered ||
      this.peer.connectionState !== 'connected' ||
      this.dataChannel.readyState !== 'open'
    ) {
      return;
    }
    this.attempt = undefined;
    attempt.cleanup();
    this.currentState = 'connected';
    attempt.resolve();
    this.connectionEvents.emit({ type: 'state.changed', state: 'connected' });
  }

  private failSetup(error: WebRTCError, reason: WebRTCCloseReason): void {
    const { attempt } = this;
    if (!attempt) {
      return;
    }
    this.attempt = undefined;
    attempt.cleanup();
    attempt.reject(error);
    // Change state and detach first: abort callbacks cannot resurrect setup.
    this.finish(reason);
    attempt.controller.abort(error);
  }

  private finish(reason: WebRTCCloseReason, error?: WebRTCError): void {
    if (this.currentState === 'closed') {
      return;
    }
    this.currentState = 'closed';
    this.peer.removeEventListener('connectionstatechange', this.onPeerState);
    this.adapter.dispose();
    this.peer.close();
    if (error) {
      this.connectionEvents.emit({ type: 'error', error, fatal: true });
    }
    this.connectionEvents.emit({ type: 'closed', reason });
    this.connectionEvents.clear();
  }

  private readonly onPeerState = (): void => {
    if (this.currentState === 'closed') {
      return;
    }
    if (this.peer.connectionState === 'failed' || this.peer.connectionState === 'closed') {
      const failed = this.peer.connectionState === 'failed';
      const error = new WebRTCError(
        failed ? 'transport_failed' : 'connection_closed',
        'transport',
        'The WebRTC peer connection ended.',
      );
      if (this.attempt) {
        this.failSetup(error, failed ? 'failed' : 'remote');
      } else {
        this.finish(failed ? 'failed' : 'remote', failed ? error : undefined);
      }
    } else {
      this.checkReady();
    }
  };

  private readonly onChannelEvent = (event: WebRTCConnectionEvent): void => {
    if (this.currentState === 'closed') {
      return;
    }
    if (event.type === 'closed') {
      if (this.attempt) {
        this.failSetup(
          new WebRTCError('connection_closed', 'transport', 'The data channel closed during setup.'),
          'remote',
        );
      } else {
        this.finish('remote');
      }
    } else if (event.type === 'error') {
      if (event.error.phase === 'transport') {
        if (this.attempt) {
          this.failSetup(event.error, 'failed');
        } else {
          this.finish('failed', event.error);
        }
      } else {
        this.connectionEvents.emit(event);
      }
    } else {
      this.checkReady();
    }
  };
}
