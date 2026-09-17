import type { ResponsesServerEvent } from '../../resources/responses/responses';
import type { ResponsesEmitter } from '../../resources/responses/internal-base';
import { WebSocketError } from '../../resources/responses/internal-base';
import { OpenAIError } from '../../core/error';
import { ReadyState } from '../../internal/ws-adapter';
import type { WebSocketLike } from '../../internal/ws-adapter';
import { getWebSocketError, rawByteLength } from '../../internal/ws';
import { hasOwn, isObj } from '../../internal/utils/values';
import { getWebSocketEventBytes, getWebSocketEventPayload } from '../../resources/responses/ws-base';
import {
  getWebSocketEventBytes as getBetaWebSocketEventBytes,
  getWebSocketEventPayload as getBetaWebSocketEventPayload,
} from '../../resources/beta/responses/ws-base';
import { ResponsesWebSocketLane, positiveInteger } from './responses-websocket-lane';

export { ResponsesWebSocketLane } from './responses-websocket-lane';
export type { ResponsesWebSocketEvent } from './responses-websocket-lane';

interface LaneState {
  lane: ResponsesWebSocketLane;
  events: number;
  bytes: number;
}

/** Limits for this optional helper. They do not change the underlying socket's limits. */
export interface ResponsesWebSocketSessionOptions {
  /** Maximum lane IDs registered until the next reconnect, including detached lanes. */
  maxLanes: number;
  /** Maximum queued events across all lanes. */
  maxBufferedEvents: number;
  /** Maximum queued UTF-8 JSON bytes across all lanes. */
  maxBufferedBytes: number;
}

function parseEvent(serialized: string): ResponsesServerEvent {
  // SAFETY: Validate the envelope below, as the native transport does for server-defined payloads.
  const event = JSON.parse(serialized) as ResponsesServerEvent;
  if (
    !isObj(event) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Match the native event envelope at this untyped boundary.
    typeof Object.getOwnPropertyDescriptor(event, 'type')?.value !== 'string'
  ) {
    throw new OpenAIError('Invalid WebSocket event shape');
  }
  return event;
}

function serializeCustomEvent(incoming: ResponsesServerEvent): string {
  const snapshot = structuredClone(incoming);
  // Mask inherited serialization hooks throughout our copy, not the caller's event.
  const pending: unknown[] = [snapshot];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Traverse only objects in the untyped structured clone.
    if (value === null || typeof value !== 'object' || visited.has(value)) {
      continue;
    }
    visited.add(value);
    // Keep Date's standard JSON conversion, which is owned by Date.prototype.
    if (!(value instanceof Date) && !hasOwn(value, 'toJSON')) {
      Object.defineProperty(value, 'toJSON', { value: undefined });
    }
    for (const child of Object.values(value)) {
      pending.push(child);
    }
  }
  return JSON.stringify(snapshot);
}

/**
 * Routes events from an existing Responses socket without creating another reader.
 * Register lanes before sending. Unregistered events remain observable on the socket.
 * Closing this helper releases its listeners and lanes, but leaves the socket open.
 * Attaching to a closing or closed socket is rejected.
 * Reconnecting invalidates lanes: register new ones after restoring application state.
 * No request is replayed by this helper.
 */
export class ResponsesWebSocketSession {
  readonly #connection: ResponsesEmitter & { readonly socket: WebSocketLike };
  readonly #lanes = new Map<string | undefined, LaneState>();
  readonly #maxLanes: number;
  readonly #maxEvents: number;
  readonly #maxBytes: number;
  #events = 0;
  #bytes = 0;
  #closed = false;
  #socket: WebSocketLike | undefined;
  #failedTransport: { socket: WebSocketLike | undefined; error: WebSocketError } | undefined;

  constructor(
    connection: ResponsesEmitter & { readonly socket: WebSocketLike },
    options: ResponsesWebSocketSessionOptions,
  ) {
    this.#connection = connection;
    this.#maxLanes = positiveInteger(options.maxLanes);
    this.#maxEvents = positiveInteger(options.maxBufferedEvents);
    this.#maxBytes = positiveInteger(options.maxBufferedBytes);
    if (
      connection.socket.readyState === ReadyState.CLOSING ||
      connection.socket.readyState === ReadyState.CLOSED
    ) {
      throw new OpenAIError('Cannot attach a Responses WebSocket session to a closing or closed socket');
    }
    connection.on('event', this.#onEvent);
    connection.on('error', this.#onError);
    connection.on('close', this.#onClose);
    connection.on('reconnecting', this.#onReconnect);
    connection.on('reconnected', this.#onReconnected);
    this.#onReconnected();
  }

  /** Omit streamID for the protocol's default lane. A lane has one consumer.
   * IDs remain reserved until reconnect, including after close or failure:
   * a terminal response can still be followed by an automatic successor.
   */
  lane(
    streamID?: string,
    limits: { maxBufferedEvents?: number; maxBufferedBytes?: number } = {},
  ): ResponsesWebSocketLane {
    if (this.#closed) {
      throw new OpenAIError('Responses WebSocket session is closed');
    }
    this.#assertTransportAvailable(this.#connection.socket);
    if (
      streamID !== undefined &&
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Untyped JavaScript callers must not create non-string routing keys through RegExp coercion.
      (typeof streamID !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/u.test(streamID))
    ) {
      throw new OpenAIError('Invalid Responses WebSocket stream ID');
    }
    if (this.#lanes.has(streamID)) {
      throw new OpenAIError('Responses WebSocket lane is already registered');
    }
    if (this.#lanes.size >= this.#maxLanes) {
      throw new OpenAIError('Responses WebSocket lane limit exceeded');
    }
    const entry: LaneState = {
      events: 0,
      bytes: 0,
      lane: new ResponsesWebSocketLane(
        streamID,
        (event) => {
          const { socket } = this.#connection;
          this.#assertTransportAvailable(socket);
          if (socket.readyState !== ReadyState.OPEN) {
            throw new OpenAIError('Wait for an open Responses WebSocket before sending');
          }
          // The emitter's reconnect queue may replay an uncertain write. Send
          // directly to the physical socket, including during its open callback.
          socket.send(JSON.stringify(event));
        },
        (bytes) => {
          this.#events -= 1;
          this.#bytes -= bytes;
          entry.events -= 1;
          entry.bytes -= bytes;
        },
        positiveInteger(limits.maxBufferedEvents ?? this.#maxEvents),
        positiveInteger(limits.maxBufferedBytes ?? this.#maxBytes),
      ),
    };
    this.#lanes.set(streamID, entry);
    return entry.lane;
  }

  close(): void {
    this.#closed = true;
    this.#removeListeners();
    this.#failLanes(new OpenAIError('Responses WebSocket session is closed'));
    this.#lanes.clear();
  }

  #removeListeners(): void {
    this.#connection.off('event', this.#onEvent);
    this.#connection.off('error', this.#onError);
    this.#connection.off('close', this.#onClose);
    this.#connection.off('reconnecting', this.#onReconnect);
    this.#connection.off('reconnected', this.#onReconnected);
    this.#socket?.off('error', this.#onSocketError);
    this.#socket = undefined;
  }

  #onEvent = (incoming: ResponsesServerEvent): void => {
    let event: ResponsesServerEvent;
    let bytes: number;
    try {
      const payload = getWebSocketEventPayload(incoming) ?? getBetaWebSocketEventPayload(incoming);
      // Native events are copied from the wire, before any observer's mutations.
      // Clone custom inputs once to strip prototypes and evaluate accessors,
      // then retain only the JSON representation covered by byte accounting.
      let serialized = payload;
      if (serialized === undefined) {
        serialized = serializeCustomEvent(incoming);
      }
      event = parseEvent(serialized);
      bytes =
        payload === undefined
          ? rawByteLength(serialized)
          : (getBetaWebSocketEventBytes(incoming) ?? getWebSocketEventBytes(incoming));
    } catch {
      this.#failLanes(new OpenAIError('Cannot snapshot custom WebSocket event'));
      return;
    }
    const routing = Object.getOwnPropertyDescriptor(event, 'stream_id');
    let streamID: string | undefined;
    if (routing) {
      const value: unknown = routing.value;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Raw event observers may mutate routing; only an own string value can select a lane, without invoking accessors.
      if (typeof value !== 'string') {
        return;
      }
      streamID = value;
    }
    const entry = this.#lanes.get(streamID);
    if (!entry || entry.lane.ended) {
      return;
    }
    if (bytes > this.#maxBytes) {
      entry.lane.fail(new OpenAIError('Responses WebSocket helper buffer limit exceeded'));
      return;
    }
    this.#events += 1;
    this.#bytes += bytes;
    entry.events += 1;
    entry.bytes += bytes;
    // Apply the lane's own limits first, releasing its backlog on overflow.
    entry.lane.push(event, bytes);
    while (this.#events > this.#maxEvents || this.#bytes > this.#maxBytes) {
      const bytePressure = this.#bytes > this.#maxBytes;
      let largest = entry;
      let largestSize = 0;
      for (const candidate of this.#lanes.values()) {
        // Attribute pressure to existing backlogs, excluding the incoming event.
        const size = bytePressure
          ? candidate.bytes - (candidate === entry ? bytes : 0)
          : candidate.events - (candidate === entry ? 1 : 0);
        // Strict comparison breaks ties by lane registration order.
        if (size > largestSize) {
          largest = candidate;
          largestSize = size;
        }
      }
      largest.lane.fail(new OpenAIError('Responses WebSocket helper buffer limit exceeded'));
    }
  };

  #onClose = (): void => {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#removeListeners();
    for (const { lane } of this.#lanes.values()) {
      lane.end(new OpenAIError('Responses WebSocket connection closed'));
    }
  };
  // oxlint-disable-next-line eslint/class-methods-use-this -- Each session owns a distinct listener so detaching one does not unhandle another session's errors.
  #onError = (): void => {
    // API errors are routed as events. Other emitter errors may be recoverable
    // diagnostics; only the physical socket's errors end all lanes.
  };
  #onSocketError = (cause: Error): void => {
    const error = new WebSocketError(cause.message, null);
    Object.assign(error, { cause });
    this.#failedTransport = { socket: this.#socket, error };
    for (const { lane } of this.#lanes.values()) {
      lane.end(error);
    }
  };
  #onReconnect = (): void => {
    this.#socket?.off('error', this.#onSocketError);
    this.#socket = undefined;
    this.#failLanes(new OpenAIError('Responses WebSocket reconnected state must be restored explicitly'));
    this.#lanes.clear();
  };
  #onReconnected = (): void => {
    if (this.#closed) {
      return;
    }
    this.#socket?.off('error', this.#onSocketError);
    this.#socket = this.#connection.socket;
    this.#clearRecoveredTransportError(this.#socket);
    this.#socket.on('error', this.#onSocketError);
  };

  #assertTransportAvailable(socket: WebSocketLike): void {
    // Native transports record failure before forwarding their public error event.
    const cause = getWebSocketError(socket);
    if (cause) {
      const error = new WebSocketError(cause.message, null);
      Object.assign(error, { cause });
      throw error;
    }
    this.#clearRecoveredTransportError(socket);
    if (this.#failedTransport) {
      throw this.#failedTransport.error;
    }
  }

  #clearRecoveredTransportError(socket: WebSocketLike): void {
    // Application recovery callbacks can run before our reconnected listener.
    if (
      this.#failedTransport &&
      socket !== this.#failedTransport.socket &&
      socket.readyState === ReadyState.OPEN
    ) {
      this.#failedTransport = undefined;
    }
  }

  #failLanes(error: Error): void {
    for (const { lane } of this.#lanes.values()) {
      lane.fail(error);
    }
  }
}
