/* oxlint-disable max-classes-per-file -- Exercise the public connection with its custom transport. */
import { EventEmitter } from 'node:events';
import { expect, vi } from 'vitest';
import OpenAI from 'openai';
import { ResponsesWSBase } from 'openai/resources/responses/ws-base';
import type { WebSocketLike } from 'openai/internal/ws-adapter';
import type { UnsentMessage } from 'openai/internal/ws';

// oxlint-disable-next-line unicorn/prefer-event-target -- WebSocketLike uses on/off/once.
class ReentrantSocket extends EventEmitter implements WebSocketLike {
  readyState = 0;
  readonly submitted: string[] = [];
  afterSend: ((data: string) => void) | undefined;

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== 1) {
      throw new Error('synthetic transport is not open');
    }
    this.submitted.push(String(data));
    this.afterSend?.(String(data));
  }

  close(code = 1000, reason = 'OK'): void {
    this.readyState = 3;
    this.emit('close', code, reason);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }
}

class ReentrantConnection extends ResponsesWSBase<ReentrantSocket> {
  readonly physical: ReentrantSocket[] = [];
  reconnectSend: ((data: string) => void) | undefined;

  protected override _createSocket(): ReentrantSocket {
    const socket = new ReentrantSocket();
    this.physical.push(socket);
    if (this.physical.length > 1) {
      socket.afterSend = this.reconnectSend;
      setImmediate(() => socket.open());
    }
    return socket;
  }

  start(): void {
    this._connectInitial();
  }
}

test('keeps reconnect queue order when a custom transport sends reentrantly', async () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, {
    reconnect: {
      initialDelay: 1,
      maxDelay: 1,
      maxRetries: 1,
      onReconnecting: () => {
        connection.sendRaw('old-first');
        connection.sendRaw('old-second');
      },
    },
  });
  const errors: Error[] = [];
  let reconnected = false;
  connection.on('error', (error) => errors.push(error));
  connection.on('reconnected', () => {
    reconnected = true;
  });
  connection.reconnectSend = (data) => {
    if (data === 'old-first') {
      connection.sendRaw('new-third');
    }
  };
  try {
    connection.start();
    connection.socket.open();
    connection.socket.close(1012, 'synthetic restart');
    await expect.poll(() => reconnected).toBe(true);
    expect(errors).toEqual([]);
    expect(connection.physical[1]?.submitted).toEqual(['old-first', 'old-second', 'new-third']);
  } finally {
    connection.close();
  }
});

test('keeps connecting queue order when a custom transport sends raw and typed events reentrantly', () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client);
  const errors: Error[] = [];
  connection.on('error', (error) => errors.push(error));
  try {
    connection.start();
    connection.sendRaw('old-first');
    connection.sendRaw('old-second');
    connection.socket.afterSend = (data) => {
      if (data === 'old-first') {
        connection.send({ type: 'response.create', model: 'gpt-4o-mini' });
        connection.sendRaw('new-fourth');
      }
    };
    connection.socket.open();
    expect(errors).toEqual([]);
    expect(connection.socket.submitted).toEqual([
      'old-first',
      'old-second',
      JSON.stringify({ type: 'response.create', model: 'gpt-4o-mini' }),
      'new-fourth',
    ]);
  } finally {
    connection.close();
  }
});

test.each(['toJSON', 'getter'])(
  'rejects reentrant %s serialization errors without losing older queued frames',
  (kind) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const connection = new ReentrantConnection(client);
    const errors: Error[] = [];
    const serializationError = new Error('synthetic invalid new event');
    connection.on('error', (error) => errors.push(error));
    try {
      connection.start();
      connection.sendRaw('old-first');
      connection.sendRaw('old-second');
      connection.socket.afterSend = (data) => {
        if (data === 'old-first') {
          if (kind === 'toJSON') {
            const unserializable = {
              type: 'response.create' as const,
              model: 'gpt-4o-mini',
              toJSON: () => {
                throw serializationError;
              },
            };
            connection.send(unserializable);
          } else {
            connection.send({
              type: 'response.create',
              get model(): string {
                throw serializationError;
              },
            });
          }
          connection.sendRaw('new-last');
        }
      };
      connection.socket.open();
      expect(connection.socket.submitted).toEqual(['old-first', 'old-second', 'new-last']);
      expect(errors).toMatchObject([{ message: 'could not send data', cause: serializationError }]);
    } finally {
      connection.close();
    }
  },
);

test('does not catch a full-queue error observer as a serialization failure', () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, { maxQueueSize: 1 });
  const errors: Error[] = [];
  const observerError = new Error('synthetic observer failure');
  connection.on('error', (error) => {
    errors.push(error);
    throw observerError;
  });
  try {
    connection.start();
    connection.sendRaw('occupied');
    expect(() => connection.send({ type: 'response.create', model: 'gpt-4o-mini' })).toThrow(observerError);
    expect(errors).toMatchObject([{ message: 'send queue is full, message discarded' }]);
  } finally {
    connection.close();
  }
});

test.each([
  { kind: 'array buffer', from: (bytes: ArrayBuffer) => bytes },
  { kind: 'typed view', from: (bytes: ArrayBuffer) => new Uint8Array(bytes) },
  { kind: 'data view', from: (bytes: ArrayBuffer) => new DataView(bytes) },
  { kind: 'fragments', from: (bytes: ArrayBuffer) => [new Uint8Array([1]), new DataView(bytes)] },
])('rejects a detached raw $kind reentrantly without interrupting older writes', ({ from }) => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client);
  const errors: Error[] = [];
  connection.on('error', (error) => errors.push(error));
  try {
    connection.start();
    connection.sendRaw('old-first');
    connection.send({ type: 'response.create', model: 'gpt-4o-mini' });
    connection.sendRaw('old-third');
    connection.socket.afterSend = (data) => {
      if (data === 'old-first') {
        const bytes = new ArrayBuffer(4);
        const raw = from(bytes);
        structuredClone(bytes, { transfer: [bytes] });
        connection.sendRaw(raw);
        connection.sendRaw('new-fourth');
      }
    };
    connection.socket.open();
    expect(connection.socket.submitted).toEqual([
      'old-first',
      JSON.stringify({ type: 'response.create', model: 'gpt-4o-mini' }),
      'old-third',
      'new-fourth',
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'could not send data', cause: expect.any(TypeError) });
  } finally {
    connection.close();
  }
});

test('does not catch a raw full-queue error observer as a snapshot failure', () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, { maxQueueSize: 1 });
  const errors: Error[] = [];
  const observerError = new Error('synthetic raw observer failure');
  connection.on('error', (error) => {
    errors.push(error);
    throw observerError;
  });
  try {
    connection.start();
    connection.sendRaw('occupied');
    expect(() => connection.sendRaw(new Uint8Array([2]))).toThrow(observerError);
    expect(errors).toMatchObject([{ message: 'send queue is full, message discarded' }]);
  } finally {
    connection.close();
  }
});

test.each(['valid', 'invalid return', 'invalid throw'] as const)(
  'a %s later typed send observes older buffered messages after an initial failure',
  (kind) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const connection = new ReentrantConnection(client);
    const errors: Error[] = [];
    const close = vi.fn();
    const serializationError = new Error('synthetic later-event serialization failure');
    const observerError = new Error('synthetic later-event observer failure');
    const later = { type: 'response.create' as const, model: 'gpt-4o-mini' };
    connection.on('error', (event) => {
      errors.push(event);
      if (kind === 'invalid throw' && errors.length > 1) {
        throw observerError;
      }
    });
    connection.on('close', close);
    try {
      connection.start();
      connection.sendRaw('attempted');
      connection.sendRaw('old-second');
      connection.socket.afterSend = (data) => {
        if (data === 'attempted') {
          throw new Error('synthetic uncertain write');
        }
        if (data === 'old-second') {
          connection.sendRaw('reentrant-last');
        }
      };
      connection.socket.open();
      expect(connection.socket.submitted).toEqual(['attempted']);
      if (kind === 'valid') {
        connection.send(later);
        expect(connection.socket.submitted).toEqual([
          'attempted',
          'old-second',
          JSON.stringify(later),
          'reentrant-last',
        ]);
      } else {
        const invalid = {
          ...later,
          toJSON: () => {
            throw serializationError;
          },
        };
        if (kind === 'invalid throw') {
          expect(() => connection.send(invalid)).toThrow(observerError);
          expect(connection.socket.submitted).toEqual(['attempted']);
        } else {
          connection.send(invalid);
          expect(connection.socket.submitted).toEqual(['attempted', 'old-second', 'reentrant-last']);
        }
        expect(errors).toMatchObject([
          { message: 'could not send queued data' },
          { message: 'could not send data', cause: serializationError },
        ]);
      }
      connection.close();
      expect(close).toHaveBeenCalledExactlyOnceWith(
        1000,
        'OK',
        kind === 'invalid throw' ? [{ type: 'raw', data: 'old-second' }] : [],
      );
    } finally {
      connection.close();
    }
  },
);

test.each(['typed', 'raw'] as const)(
  'closing while a later %s send is snapshotted cannot admit a frame after close',
  (kind) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const connection = new ReentrantConnection(client);
    const errors: Error[] = [];
    const close = vi.fn();
    connection.on('error', (event) => errors.push(event));
    connection.on('close', close);
    try {
      connection.start();
      connection.sendRaw('attempted');
      connection.sendRaw('old-second');
      connection.socket.afterSend = (data) => {
        if (data === 'attempted') {
          throw new Error('synthetic uncertain write');
        }
      };
      connection.socket.open();
      if (kind === 'typed') {
        const later = {
          type: 'response.create' as const,
          model: 'gpt-4o-mini',
          toJSON: () => {
            connection.close();
            return { type: 'response.create', model: 'gpt-4o-mini' };
          },
        };
        connection.send(later);
      } else {
        const fragments = [new Uint8Array([1])];
        Object.defineProperty(fragments, '0', {
          get: () => {
            connection.close();
            return new Uint8Array([1]);
          },
        });
        connection.sendRaw(fragments);
      }
      expect(connection.socket.submitted).toEqual(['attempted']);
      expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', [{ type: 'raw', data: 'old-second' }]);
      expect(errors).toMatchObject([
        { message: 'could not send queued data' },
        { message: 'could not send data' },
      ]);
      connection.close();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      connection.close();
    }
  },
);

test('keeps order when the second reconnect drain receives reentrant sends', async () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, {
    reconnect: {
      initialDelay: 1,
      maxDelay: 1,
      maxRetries: 1,
      onReconnecting: (): void => connection.sendRaw('old-first'),
    },
  });
  const errors: Error[] = [];
  let reconnected = false;
  connection.on('error', (error) => errors.push(error));
  connection.on('reconnected', () => {
    reconnected = true;
  });
  connection.reconnectSend = (data) => {
    if (data === 'old-first') {
      connection.sendRaw('second');
      connection.sendRaw('third');
    }
    if (data === 'second') {
      connection.sendRaw('last');
    }
  };
  try {
    connection.start();
    connection.socket.open();
    connection.socket.close(1012, 'synthetic restart');
    await expect.poll(() => reconnected).toBe(true);
    expect(errors).toEqual([]);
    expect(connection.physical[1]?.submitted).toEqual(['old-first', 'second', 'third', 'last']);
  } finally {
    connection.close();
  }
});

test.each([false, true])(
  'terminal close during send stops the drain, even if the send throws: %s',
  (throwAfterClose) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const connection = new ReentrantConnection(client);
    const errors: Error[] = [];
    const closes: UnsentMessage<unknown>[][] = [];
    connection.on('error', (error) => errors.push(error));
    connection.on('close', (_code, _reason, unsent) => closes.push(unsent));
    try {
      connection.start();
      connection.sendRaw('old-first');
      connection.send({ type: 'response.create', model: 'gpt-4o-mini' });
      connection.sendRaw('old-third');
      connection.socket.afterSend = (data) => {
        if (data === 'old-first') {
          connection.sendRaw('new-fourth');
          connection.close();
          if (throwAfterClose) {
            throw new Error('synthetic close then write failure');
          }
        }
      };
      connection.socket.open();
      if (throwAfterClose) {
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ message: 'could not send queued data' });
      } else {
        expect(errors).toEqual([]);
      }
      expect(connection.socket.submitted).toEqual(['old-first']);
      expect(closes).toEqual([
        [
          { type: 'message', message: { type: 'response.create', model: 'gpt-4o-mini' } },
          { type: 'raw', data: 'old-third' },
          { type: 'raw', data: 'new-fourth' },
        ],
      ]);
    } finally {
      connection.close();
    }
  },
);

test('drains a long finite reentrant send chain without recursion', () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client);
  const errors: Error[] = [];
  connection.on('error', (error) => errors.push(error));
  try {
    connection.start();
    connection.sendRaw('0');
    connection.socket.afterSend = (data) => {
      const next = Number(data) + 1;
      if (next < 12_000) {
        connection.sendRaw(String(next));
      }
    };
    connection.socket.open();
    expect(errors).toEqual([]);
    expect(connection.socket.submitted).toEqual(Array.from({ length: 12_000 }, (_, index) => String(index)));
  } finally {
    connection.close();
  }
});

test('a recoverable close during flush leaves waiting frames for the new transport', async () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, {
    reconnect: {
      initialDelay: 1,
      maxDelay: 1,
      maxRetries: 1,
      onReconnecting: (): void => connection.sendRaw('new-third'),
    },
  });
  const errors: Error[] = [];
  let reconnected = false;
  connection.on('error', (error) => errors.push(error));
  connection.on('reconnected', () => {
    reconnected = true;
  });
  try {
    connection.start();
    connection.sendRaw('old-first');
    connection.sendRaw('old-second');
    connection.socket.afterSend = (data) => {
      if (data === 'old-first') {
        connection.socket.close(1001, 'synthetic going away');
      }
    };
    connection.socket.open();
    await expect.poll(() => reconnected).toBe(true);
    expect(errors).toEqual([]);
    expect(connection.physical[0]?.submitted).toEqual(['old-first']);
    expect(connection.physical[1]?.submitted).toEqual(['old-second', 'new-third']);
  } finally {
    connection.close();
  }
});

test('counts waiting bytes during flush, freeing the attempted frame and allowing an oversized first frame', () => {
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
  const connection = new ReentrantConnection(client, { maxQueueSize: 4 });
  const errors: Error[] = [];
  connection.on('error', (error) => errors.push(error));
  try {
    connection.start();
    connection.sendRaw('ab');
    connection.sendRaw('cd');
    connection.socket.afterSend = (data) => {
      if (data === 'ab') {
        const binary = new Uint8Array([69, 70]);
        connection.sendRaw(binary);
        binary.fill(0);
        connection.sendRaw('full');
      }
      if (data === '69,70') {
        connection.sendRaw('oversized');
      }
    };
    connection.socket.open();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'send queue is full, message discarded' });
    expect(connection.socket.submitted).toEqual(['ab', 'cd', '69,70', 'oversized']);
  } finally {
    connection.close();
  }
});
