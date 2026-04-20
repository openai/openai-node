import type { WebSocketLike } from './ws-adapter';

/** A generic event listener callback. */
type Listener = (...args: any[]) => void;

/** A DOM-style event handler passed to addEventListener/removeEventListener. */
type DOMEventHandler = (ev: any) => void;

// Minimal browser API type declarations.
declare class WebSocket {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: DOMEventHandler): void;
  removeEventListener(type: string, listener: DOMEventHandler): void;
}

interface MessageEvent {
  data: any;
}

interface CloseEvent {
  code: number;
  reason: string;
}

export class BrowserWebSocket implements WebSocketLike {
  private _ws: WebSocket;
  private _listenerMap = new Map<string, Map<Listener, DOMEventHandler>>();

  constructor(ws: WebSocket) {
    this._ws = ws;
    this._ws.binaryType = 'arraybuffer';
  }

  /** The underlying platform-specific socket. Code that accesses this will not be isomorphic across server and browser environments. */
  get platformSocket(): WebSocket {
    return this._ws;
  }

  get readyState(): number {
    return this._ws.readyState;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this._ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this._ws.close(code, reason);
  }

  on(event: string, listener: Listener): void {
    const wrapped = this._wrapListener(event, listener);
    this._listenersFor(event).set(listener, wrapped);
    this._ws.addEventListener(event, wrapped);
  }

  off(event: string, listener: Listener): void {
    const byListener = this._listenerMap.get(event);
    if (!byListener) return;
    const wrapped = byListener.get(listener);
    if (wrapped) {
      byListener.delete(listener);
      this._ws.removeEventListener(event, wrapped);
    }
  }

  once(event: string, listener: Listener): void {
    const onceListener: Listener = (...args) => {
      this.off(event, listener);
      listener(...args);
    };
    const wrapped = this._wrapListener(event, onceListener);
    this._listenersFor(event).set(listener, wrapped);
    this._ws.addEventListener(event, wrapped);
  }

  private _listenersFor(event: string): Map<Listener, DOMEventHandler> {
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
  private _wrapListener(event: string, listener: Listener): DOMEventHandler {
    switch (event) {
      case 'message':
        return (ev: MessageEvent) => {
          const isBinary = typeof ev.data !== 'string';
          listener(ev.data, isBinary);
        };

      case 'close':
        return (ev: CloseEvent) => {
          listener(ev.code, ev.reason);
        };

      case 'error':
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

      case 'open':
      default:
        return listener as DOMEventHandler;
    }
  }
}
