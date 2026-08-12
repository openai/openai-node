import type * as WS from 'ws';
import type { WebSocketLike } from './ws-adapter';

/** A generic event listener callback. */
type Listener = (...args: any[]) => void;

/**
 * Adapts a Node.js `ws` socket to the SDK's platform-neutral WebSocket API.
 *
 * Text frames become strings, binary frames become `Buffer` values, fragmented
 * messages are merged, and close reasons are decoded before reaching listeners.
 */
export class NodeWebSocket implements WebSocketLike {
  private _ws: WS.WebSocket;

  /** Maps `(event, originalListener)` -> wrapped listener for correct `off()` removal. */
  private _listenerMap = new Map<string, Map<Listener, Listener>>();

  /** Wraps an existing socket created by the optional `ws` package. */
  constructor(ws: WS.WebSocket) {
    this._ws = ws;
  }

  /** The underlying `ws` socket; accessing it makes calling code Node.js-specific. */
  get platformSocket(): WS.WebSocket {
    return this._ws;
  }

  /** Current numeric socket connection state, using standard WebSocket values. */
  get readyState(): number {
    return this._ws.readyState;
  }

  /** Sends a text or binary frame through the underlying `ws` connection. */
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this._ws.send(data);
  }

  /** Initiates the socket's closing handshake with an optional code and reason. */
  close(code?: number, reason?: string): void {
    this._ws.close(code, reason);
  }

  /** Registers a listener with normalized message payloads and close reasons. */
  on(event: string, listener: Listener): void {
    const wrapped = NodeWebSocket._wrapListener(event, listener);
    this._listenersFor(event).set(listener, wrapped);
    this._ws.on(event, wrapped);
  }

  /** Removes the platform listener associated with the original callback. */
  off(event: string, listener: Listener): void {
    const byListener = this._listenerMap.get(event);
    if (!byListener) {
      return;
    }
    const wrapped = byListener.get(listener);
    if (wrapped) {
      byListener.delete(listener);
      this._ws.removeListener(event, wrapped);
    }
  }

  /** Registers a listener that is removed before it handles its first event. */
  once(event: string, listener: Listener): void {
    const onceListener: Listener = (...args) => {
      this.off(event, listener);
      listener(...args);
    };
    const wrapped = NodeWebSocket._wrapListener(event, onceListener);
    this._listenersFor(event).set(listener, wrapped);
    this._ws.on(event, wrapped);
  }

  private _listenersFor(event: string): Map<Listener, Listener> {
    let map = this._listenerMap.get(event);
    if (!map) {
      map = new Map();
      this._listenerMap.set(event, map);
    }
    return map;
  }

  /**
   * Normalizes `ws` message payloads: text frames become strings,
   * binary frames stay as `Buffer`, and fragmented frames are merged.
   */
  private static _normalizeMessageData(
    data: Buffer | ArrayBuffer | Buffer[],
    isBinary: boolean,
  ): string | Buffer {
    if (!isBinary) {
      if (Array.isArray(data)) {
        return Buffer.concat(data).toString();
      }
      if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString();
      }
      return data.toString();
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data);
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    return data;
  }

  private static _wrapListener(event: string, listener: Listener): Listener {
    switch (event) {
      case 'message': {
        return (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          listener(NodeWebSocket._normalizeMessageData(data, isBinary), isBinary);
        };
      }

      case 'close': {
        return (code: number, reason: Buffer) => {
          listener(code, reason.toString());
        };
      }

      // 'open' and 'error' pass through unchanged
      default: {
        return listener;
      }
    }
  }
}
