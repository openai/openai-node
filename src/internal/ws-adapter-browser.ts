import type { WebSocketLike } from './ws-adapter';

/** A generic event listener callback. */
type Listener = (...args: any[]) => void;

/** A DOM-style event handler passed to addEventListener/removeEventListener. */
type DOMEventHandler = (ev: any) => void;

/** Minimal browser WebSocket surface accepted by the platform-neutral adapter. */
interface WebSocket {
  /** Numeric connection state reported by the browser WebSocket. */
  readonly readyState: number;

  /** Representation used for received binary message frames. */
  binaryType: string;

  /** Sends a text or binary WebSocket frame. */
  send(data: string | ArrayBufferLike | ArrayBufferView): void;

  /** Initiates a closing handshake with an optional status code and reason. */
  close(code?: number, reason?: string): void;

  /** Subscribes to a browser-native WebSocket event. */
  addEventListener(type: string, listener: DOMEventHandler): void;

  /** Removes a previously registered browser-native event listener. */
  removeEventListener(type: string, listener: DOMEventHandler): void;
}

interface MessageEvent {
  data: any;
}

interface CloseEvent {
  code: number;
  reason: string;
}

/**
 * Adapts a browser-native WebSocket to the SDK's platform-neutral event API.
 *
 * Binary messages are received as `ArrayBuffer` values, browser event objects
 * are converted into positional listener arguments, and browser errors are
 * normalized to `Error` instances.
 */
export class BrowserWebSocket implements WebSocketLike {
  private _ws: WebSocket;
  private _listenerMap = new Map<string, Map<Listener, DOMEventHandler[]>>();

  /** Wraps an existing browser socket and configures binary frames as array buffers. */
  constructor(ws: WebSocket) {
    this._ws = ws;
    this._ws.binaryType = 'arraybuffer';
  }

  /** The browser-native socket; accessing it makes calling code platform-specific. */
  get platformSocket(): WebSocket {
    return this._ws;
  }

  /** Current numeric browser connection state, using standard WebSocket values. */
  get readyState(): number {
    return this._ws.readyState;
  }

  /** Sends a text or binary frame without changing its contents. */
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this._ws.send(data);
  }

  /** Initiates the browser socket's closing handshake. */
  close(code?: number, reason?: string): void {
    this._ws.close(code, reason);
  }

  /** Registers a listener and converts browser event objects to SDK event arguments. */
  on(event: string, listener: Listener): void {
    const wrapped = BrowserWebSocket._wrapListener(event, listener);
    this._addListener(event, listener, wrapped);
  }

  /** Removes the browser event wrapper associated with the original listener. */
  off(event: string, listener: Listener): void {
    const wrappedListeners = this._listenerMap.get(event)?.get(listener);
    const [wrapped] = wrappedListeners?.slice(-1) ?? [];
    if (wrapped) {
      this._removeListener(event, listener, wrapped);
    }
  }

  /** Registers a listener that is removed before it handles its first event. */
  once(event: string, listener: Listener): void {
    let fired = false;
    const wrapped = BrowserWebSocket._wrapListener(event, (...args) => {
      if (fired) {
        return;
      }
      fired = true;
      this._removeListener(event, listener, wrapped);
      listener(...args);
    });
    this._addListener(event, listener, wrapped);
  }

  private _addListener(event: string, listener: Listener, wrapped: DOMEventHandler): void {
    this._ws.addEventListener(event, wrapped);
    const byListener = this._listenersFor(event);
    const wrappedListeners = byListener.get(listener);
    if (!wrappedListeners) {
      byListener.set(listener, [wrapped]);
    } else if (!wrappedListeners.includes(wrapped)) {
      wrappedListeners.push(wrapped);
    }
  }

  private _removeListener(event: string, listener: Listener, wrapped: DOMEventHandler): void {
    const byListener = this._listenerMap.get(event);
    const wrappedListeners = byListener?.get(listener);
    const index = wrappedListeners?.lastIndexOf(wrapped) ?? -1;
    if (!byListener || !wrappedListeners || index === -1) {
      return;
    }

    this._ws.removeEventListener(event, wrapped);
    wrappedListeners.splice(index, 1);
    if (wrappedListeners.length === 0) {
      byListener.delete(listener);
    }
    if (byListener.size === 0) {
      this._listenerMap.delete(event);
    }
  }

  private _listenersFor(event: string): Map<Listener, DOMEventHandler[]> {
    let map = this._listenerMap.get(event);
    if (!map) {
      map = new Map();
      this._listenerMap.set(event, map);
    }
    return map;
  }

  /**
   * Converts browser event objects to positional arguments matching the
   * {@link WebSocketLike} interface.
   */
  private static _wrapListener(event: string, listener: Listener): DOMEventHandler {
    switch (event) {
      case 'message': {
        return (ev: MessageEvent) => {
          const isBinary = typeof ev.data !== 'string';
          listener(ev.data, isBinary);
        };
      }

      case 'close': {
        return (ev: CloseEvent) => {
          listener(ev.code, ev.reason);
        };
      }

      case 'error': {
        return (ev: any) => {
          // Some environments provide an ErrorEvent with a `.message`;
          // fall back to a generic message when the event carries nothing.
          const message = ev?.message || ev?.error?.message || 'WebSocket error';
          const err = new Error(message);
          if (ev?.error) {
            (err as any).cause = ev.error;
          }
          listener(err);
        };
      }

      default: {
        return listener as DOMEventHandler;
      }
    }
  }
}
