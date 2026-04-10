import type * as WS from 'ws';
import type { WebSocketLike } from './ws-adapter';

/** A generic event listener callback. */
type Listener = (...args: any[]) => void;

export class NodeWebSocket implements WebSocketLike {
  private _ws: WS.WebSocket;

  /** Maps `(event, originalListener)` -> wrapped listener for correct `off()` removal. */
  private _listenerMap = new Map<string, Map<Listener, Listener>>();

  constructor(ws: WS.WebSocket) {
    this._ws = ws;
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
    this._ws.on(event, wrapped);
  }

  off(event: string, listener: Listener): void {
    const byListener = this._listenerMap.get(event);
    if (!byListener) return;
    const wrapped = byListener.get(listener);
    if (wrapped) {
      byListener.delete(listener);
      this._ws.removeListener(event, wrapped);
    }
  }

  once(event: string, listener: Listener): void {
    const onceListener: Listener = (...args) => {
      this.off(event, listener);
      listener(...args);
    };
    const wrapped = this._wrapListener(event, onceListener);
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
      if (Array.isArray(data)) return Buffer.concat(data).toString();
      if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
      return data.toString();
    }

    if (Array.isArray(data)) return Buffer.concat(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    return data;
  }

  private _wrapListener(event: string, listener: Listener): Listener {
    switch (event) {
      case 'message':
        return (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          listener(NodeWebSocket._normalizeMessageData(data, isBinary), isBinary);
        };

      case 'close':
        return (code: number, reason: Buffer) => {
          listener(code, reason.toString());
        };

      // 'open' and 'error' pass through unchanged
      default:
        return listener;
    }
  }
}
