import { OpenAIError } from '../core/error';
import { ReadyState } from './ws-adapter';
import type { WebSocketLike } from './ws-adapter';
import { flattenRawData } from './ws';
import type { RawWebSocketData, SendQueue } from './ws';

// Read the public socket on each access; callers may replace it through an accessor.
interface SocketOwner {
  socket: WebSocketLike;
}
type OnError = (message: string, cause?: unknown) => void;

/** Sends or queues an application event using the existing connection state. */
export function sendWebSocketEvent<T>(
  owner: SocketOwner,
  event: T,
  queue: SendQueue<T>,
  isReconnecting: () => boolean,
  onError: OnError,
): void {
  if (!owner.socket) {
    throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
  }

  if (isReconnecting() || owner.socket.readyState === ReadyState.CONNECTING) {
    if (!queue.enqueue(event)) {
      onError('send queue is full, message discarded');
    }
    return;
  }
  if (owner.socket.readyState !== ReadyState.OPEN) {
    onError('cannot send on a closed WebSocket');
    return;
  }
  try {
    owner.socket.send(JSON.stringify(event));
  } catch (error) {
    onError('could not send data', error);
  }
}

/** Sends or snapshots a raw frame using the same admission rules as application events. */
export function sendRawWebSocketData<T>(
  owner: SocketOwner,
  data: RawWebSocketData,
  queue: SendQueue<T>,
  isReconnecting: () => boolean,
  onError: OnError,
): void {
  if (!owner.socket) {
    throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
  }

  if (isReconnecting() || owner.socket.readyState === ReadyState.CONNECTING) {
    if (!queue.enqueueRaw(data)) {
      onError('send queue is full, message discarded');
    }
    return;
  }
  if (owner.socket.readyState !== ReadyState.OPEN) {
    onError('cannot send on a closed WebSocket');
    return;
  }
  try {
    owner.socket.send(flattenRawData(data));
  } catch (error) {
    onError('could not send data', error);
  }
}

/** Flushes queued frames with the caller's existing failed-send policy. */
export function flushWebSocketSendQueue<T>(
  owner: SocketOwner,
  queue: SendQueue<T>,
  onError: OnError,
  options?: { requeueFailed?: boolean },
): void {
  if (!owner.socket) {
    throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
  }

  try {
    queue.flush((data) => owner.socket.send(flattenRawData(data)), options);
  } catch (error) {
    onError('could not send queued data', error);
  }
}

/** Resolves when the socket opens, or rejects if it errors or closes first. */
export function waitForWebSocketOpen(socket: WebSocketLike): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- Convert the existing socket event callbacks into the connection attempt's promise.
  return new Promise<void>((resolve, reject) => {
    /* oxlint-disable eslint/no-use-before-define -- All mutually dependent callbacks are initialized before socket listeners are registered. */
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onFail);
    };
    /* oxlint-enable eslint/no-use-before-define */
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onFail = () => {
      cleanup();
      reject(new Error('socket closed before open'));
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
    socket.once('close', onFail);
  });
}
