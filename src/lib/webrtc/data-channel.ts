import { WebRTCError } from './errors';
import { Subscriptions } from './subscriptions';
import type { BrowserDataChannel, WebRTCConnectionEvent, WebRTCDataChannel } from './types';

/** Typed protocol messages on an application-owned native RTCDataChannel. */
export class DataChannel<ClientEvent, ServerEvent extends { type: string }> {
  /** The borrowed native channel. dispose() never closes it. */
  readonly dataChannel: BrowserDataChannel;
  private readonly channel: WebRTCDataChannel;
  private readonly events = new Subscriptions<ServerEvent>();
  private readonly connectionEvents = new Subscriptions<WebRTCConnectionEvent>();
  private disposed = false;

  /** Attaches listeners without negotiating, opening, or taking ownership of the channel. */
  constructor(channel: WebRTCDataChannel) {
    this.channel = channel;
    this.dataChannel = channel as BrowserDataChannel;
    channel.addEventListener('message', this.onMessage);
    channel.addEventListener('error', this.onError);
    channel.addEventListener('open', this.onOpen);
    channel.addEventListener('close', this.onClose);
  }

  /** Subscribes to one server event type with its generated payload; returns an independent unsubscribe function. */
  on<Type extends ServerEvent['type']>(
    type: Type,
    handler: (event: Extract<ServerEvent, { type: Type }>) => unknown,
  ): () => void {
    this.assertActive();
    // The shared dispatcher matches the original discriminator before invoking this callback.
    return this.events.add((event) => handler(event as Extract<ServerEvent, { type: Type }>), type);
  }

  /** Subscribes to future server events, including raw API errors; returns an unsubscribe function. */
  onEvent(handler: (event: ServerEvent) => unknown): () => void {
    this.assertActive();
    return this.events.add(handler);
  }

  /** Observes only this channel's local errors and lifecycle, not its owning peer connection. */
  onConnectionEvent(handler: (event: WebRTCConnectionEvent) => unknown): () => void {
    this.assertActive();
    return this.connectionEvents.add(handler);
  }

  /** Sends immediately on an open channel. Throws on local failure; API acceptance is reported by server events. */
  send(event: ClientEvent): void {
    this.assertActive();
    if (this.channel.readyState !== 'open') {
      throw new WebRTCError('not_open', 'send', 'The WebRTC data channel is not open.');
    }
    try {
      const data = JSON.stringify(event);
      if (data === undefined) {
        throw new TypeError('The event is not JSON serializable.');
      }
      this.channel.send(data);
    } catch (error) {
      throw new WebRTCError('send_failed', 'send', 'Could not send the WebRTC event.', error);
    }
  }

  /** Detaches all SDK listeners and subscriptions, without closing the channel or stopping tracks. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.channel.removeEventListener('message', this.onMessage);
    this.channel.removeEventListener('error', this.onError);
    this.channel.removeEventListener('open', this.onOpen);
    this.channel.removeEventListener('close', this.onClose);
    this.events.clear();
    this.connectionEvents.clear();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new WebRTCError('invalid_state', 'transport', 'The WebRTC data-channel adapter is disposed.');
    }
  }

  private readonly onMessage = (message: unknown): void => {
    if (this.disposed) {
      return;
    }
    let event: unknown;
    try {
      const { data } = message as { data?: unknown };
      if (typeof data !== 'string') {
        throw new TypeError('Invalid protocol message.');
      }
      event = JSON.parse(data);
      if (
        typeof event !== 'object' ||
        event === null ||
        Array.isArray(event) ||
        typeof Object.getOwnPropertyDescriptor(event, 'type')?.value !== 'string'
      ) {
        throw new TypeError('Invalid protocol message.');
      }
    } catch {
      // JSON SyntaxErrors can contain the payload. Do not retain their cause.
      this.connectionEvents.emit({
        type: 'error',
        fatal: false,
        error: new WebRTCError('invalid_message', 'message', 'Received an invalid WebRTC protocol message.'),
      });
      return;
    }
    // Like the generated SDK, accept future event types without a runtime schema registry.
    this.events.emit(event as ServerEvent);
  };

  private readonly onError = (cause: unknown): void => {
    if (this.disposed) {
      return;
    }
    this.connectionEvents.emit({
      type: 'error',
      fatal: false,
      error: new WebRTCError(
        'transport_failed',
        'transport',
        'The WebRTC data channel reported an error.',
        cause,
      ),
    });
  };

  private readonly onOpen = (): void => {
    if (!this.disposed) {
      this.connectionEvents.emit({ type: 'state.changed', state: 'connected' });
    }
  };

  private readonly onClose = (): void => {
    if (this.disposed) {
      return;
    }
    this.connectionEvents.emit({ type: 'closed', reason: 'remote' });
    this.dispose();
  };
}
