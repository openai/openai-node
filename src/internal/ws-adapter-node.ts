import { AsyncLocalStorage } from 'node:async_hooks';
import type * as WS from 'ws';
import type { WebSocketLike } from './ws-adapter';
import { buildWebSocketOptions, protectWebSocketOptionsFromCredentialRedirects } from './ws';
import { setRealtimeAPIKeyCacheContext } from './realtime-credentials';
import type { DeferredAPIKeyCache } from './realtime-credentials';
import type { OpenAI } from '../client';
import { VERSION } from '../version';

setRealtimeAPIKeyCacheContext(new AsyncLocalStorage<DeferredAPIKeyCache | undefined>());

/** Use the real client's header hook while retaining Realtime's structural partial-client contract. */
export function buildRealtimeWebSocketHeaders(
  client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  authHeaders: Record<string, string>,
  options: WS.ClientOptions | ReturnType<typeof snapshotNodeWebSocketOptions> | undefined,
): NonNullable<WS.ClientOptions['headers']> {
  if ('_buildWebSocketHeaders' in client && typeof client._buildWebSocketHeaders === 'function') {
    // SAFETY: buildWebSocketOptions only calls this checked hook and uses the client as a WeakMap key.
    return buildWebSocketOptions(client as OpenAI, authHeaders, { headers: options?.headers }).headers;
  }
  const headers = new Map<string, string | string[]>(
    Object.entries({ 'User-Agent': `${client.constructor.name}/JS ${VERSION}`, ...authHeaders }).map(
      ([name, value]) => [name.toLowerCase(), value],
    ),
  );
  for (const [name, value] of Object.entries(options?.headers ?? {})) {
    const normalizedName = name.toLowerCase();
    if (value === null) {
      headers.delete(normalizedName);
    } else if (value !== undefined) {
      headers.set(normalizedName, value);
    }
  }
  // SAFETY: ws forwards repeated-header arrays to Node's HTTP client, but its header type only declares strings.
  return Object.fromEntries(headers) as NonNullable<WS.ClientOptions['headers']>;
}

/** A generic event listener callback. */
type Listener = (...args: any[]) => void;

function copyTLSMaterial(value: string | Buffer): string | Buffer {
  return ArrayBuffer.isView(value)
    ? Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    : value;
}

/** Snapshot caller headers and TLS identity before an async reconnect credential refresh. */
export function snapshotNodeWebSocketOptions(
  options: WS.ClientOptions | null | undefined,
): Omit<WS.ClientOptions, 'headers'> & { headers: Record<string, string | string[]> } {
  const captured = {
    ...options,
    headers: Object.fromEntries(
      Object.entries(options?.headers ?? {}).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
  };
  const { ca, cert, crl, key, pfx } = captured;
  if (ca !== undefined) {
    captured.ca = Array.isArray(ca) ? ca.map(copyTLSMaterial) : copyTLSMaterial(ca);
  }
  if (cert !== undefined) {
    captured.cert = Array.isArray(cert) ? cert.map(copyTLSMaterial) : copyTLSMaterial(cert);
  }
  if (crl !== undefined) {
    captured.crl = Array.isArray(crl) ? crl.map(copyTLSMaterial) : copyTLSMaterial(crl);
  }
  if (key !== undefined) {
    captured.key = Array.isArray(key)
      ? key.map((value) =>
          typeof value === 'string' || ArrayBuffer.isView(value)
            ? copyTLSMaterial(value)
            : { ...value, pem: copyTLSMaterial(value.pem) },
        )
      : copyTLSMaterial(key);
  }
  if (pfx !== undefined) {
    captured.pfx = Array.isArray(pfx)
      ? pfx.map((value) =>
          typeof value === 'string' || ArrayBuffer.isView(value)
            ? copyTLSMaterial(value)
            : { ...value, buf: copyTLSMaterial(value.buf) },
        )
      : copyTLSMaterial(pfx);
  }
  if ('session' in captured && Buffer.isBuffer(captured.session)) {
    captured.session = Buffer.from(captured.session);
  }
  if ('ALPNProtocols' in captured) {
    if (Array.isArray(captured.ALPNProtocols)) {
      captured.ALPNProtocols = [...captured.ALPNProtocols];
    } else if (ArrayBuffer.isView(captured.ALPNProtocols)) {
      const { buffer, byteOffset, byteLength } = captured.ALPNProtocols;
      captured.ALPNProtocols = Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
    }
  }
  return captured;
}

/**
 * Adapts a Node.js `ws` socket to the SDK's platform-neutral WebSocket API.
 *
 * Text frames become strings, binary frames become `Buffer` values, fragmented
 * messages are merged, and close reasons are decoded before reaching listeners.
 */
export class NodeWebSocket implements WebSocketLike {
  private _ws: WS.WebSocket;

  /** Maps `(event, originalListener)` to every wrapped registration in listener order. */
  private _listenerMap = new Map<string, Map<Listener, Listener[]>>();

  /** Wraps an existing socket created by the optional `ws` package. */
  constructor(ws: WS.WebSocket) {
    this._ws = ws;
    this._ws.on('redirect', (_url, request) => {
      try {
        const options = protectWebSocketOptionsFromCredentialRedirects({
          followRedirects: true,
          headers: request.getHeaders(),
        });

        if (options.followRedirects) {
          return;
        }
      } catch {
        // Header inspection failure must never permit a credentialed redirect.
      }

      this._ws.terminate();
    });
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

  /** Forcibly closes the underlying transport. */
  terminate(): void {
    this._ws.terminate();
  }

  /** Registers a listener with normalized message payloads and close reasons. */
  on(event: string, listener: Listener): void {
    const wrapped = NodeWebSocket._wrapListener(event, listener);
    this._registerListener(event, listener, wrapped);
  }

  /** Removes the platform listener associated with the original callback. */
  off(event: string, listener: Listener): void {
    const wrappedListeners = this._listenerMap.get(event)?.get(listener);
    const [wrapped] = wrappedListeners?.slice(-1) ?? [];
    if (!wrapped) {
      return;
    }

    this._removeListener(event, listener, wrapped);
  }

  /** Registers a listener that is removed before it handles its first event. */
  once(event: string, listener: Listener): void {
    let fired = false;
    const wrapped = NodeWebSocket._wrapListener(event, (...args) => {
      if (fired) {
        return;
      }

      fired = true;
      this._removeListener(event, listener, wrapped);
      listener(...args);
    });
    this._registerListener(event, listener, wrapped);
  }

  private _registerListener(event: string, listener: Listener, wrapped: Listener): void {
    const byListener = this._listenersFor(event);
    const wrappedListeners = byListener.get(listener);
    if (wrappedListeners) {
      wrappedListeners.push(wrapped);
    } else {
      byListener.set(listener, [wrapped]);
    }

    this._ws.on(event, wrapped);
  }

  private _removeListener(event: string, listener: Listener, wrapped: Listener): void {
    const byListener = this._listenerMap.get(event);
    const wrappedListeners = byListener?.get(listener);
    if (!byListener || !wrappedListeners) {
      return;
    }

    const index = wrappedListeners.lastIndexOf(wrapped);
    if (index === -1) {
      return;
    }

    wrappedListeners.splice(index, 1);
    if (wrappedListeners.length === 0) {
      byListener.delete(listener);
    }
    if (byListener.size === 0) {
      this._listenerMap.delete(event);
    }

    this._ws.removeListener(event, wrapped);
  }

  private _listenersFor(event: string): Map<Listener, Listener[]> {
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
