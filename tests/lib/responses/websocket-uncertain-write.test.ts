/* oxlint-disable max-classes-per-file -- This regression needs one public-base subclass and its WebSocketLike transport. */
import { EventEmitter } from 'node:events';
import { expect } from 'vitest';
import OpenAI from 'openai';
import { ResponsesWSBase as ResponsesBase } from 'openai/resources/responses/ws-base';
import { ResponsesWSBase as BetaResponsesBase } from 'openai/resources/beta/responses/ws-base';
import type { WebSocketLike } from 'openai/internal/ws-adapter';

// oxlint-disable-next-line unicorn/prefer-event-target -- WebSocketLike requires the Node on/off/once interface, not DOM EventTarget.
class RecordingSocket extends EventEmitter implements WebSocketLike {
  readyState = 0;
  readonly submitted: string[] = [];

  private readonly throwAfterFirstSubmission: boolean;

  constructor(throwAfterFirstSubmission: boolean) {
    super();
    this.throwAfterFirstSubmission = throwAfterFirstSubmission;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.submitted.push(String(data));
    if (this.throwAfterFirstSubmission && this.submitted.length === 1) {
      throw new Error('synthetic write completion unknown');
    }
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

class StableConnection extends ResponsesBase<RecordingSocket> {
  readonly physical: RecordingSocket[] = [];

  protected override _createSocket(): RecordingSocket {
    const socket = new RecordingSocket(this.physical.length === 1);
    this.physical.push(socket);
    if (this.physical.length > 1) {
      setImmediate(() => socket.open());
    }
    return socket;
  }

  start(): void {
    this._connectInitial();
  }
}

class BetaConnection extends BetaResponsesBase<RecordingSocket> {
  readonly physical: RecordingSocket[] = [];

  protected override _createSocket(): RecordingSocket {
    const socket = new RecordingSocket(this.physical.length === 1);
    this.physical.push(socket);
    if (this.physical.length > 1) {
      setImmediate(() => socket.open());
    }
    return socket;
  }

  start(): void {
    this._connectInitial();
  }
}

describe.each([
  { name: 'GA', Connection: StableConnection },
  { name: 'beta', Connection: BetaConnection },
])('Responses $name buffered writes', ({ Connection }) => {
  test('reports an uncertain submission once and flushes only never-attempted successors', async () => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const connection = new Connection(client, {
      reconnect: {
        initialDelay: 1,
        maxDelay: 1,
        maxRetries: 2,
        onReconnecting: ({ attempt }) => {
          if (attempt === 1) {
            connection.send({ type: 'response.create', model: 'gpt-synthetic', input: [] });
            connection.sendRaw('never-attempted-second');
            connection.sendRaw('never-attempted-third');
          }
        },
      },
    });
    const failures: Error[] = [];
    let reconnected = false;
    const onReconnect = () => {
      reconnected = true;
    };
    // The generated GA and beta event maps differ. Select their shared lifecycle events on each type.
    if (connection instanceof StableConnection) {
      connection.on('error', (error) => failures.push(error));
      connection.on('reconnected', onReconnect);
    } else {
      connection.on('error', (error) => failures.push(error));
      connection.on('reconnected', onReconnect);
    }
    connection.start();
    connection.socket.open();
    connection.socket.close(1012, 'synthetic service restart');
    await expect.poll(() => reconnected).toBe(true);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ message: 'could not send queued data' });
    expect(connection.physical[1]?.submitted).toEqual([
      JSON.stringify({ type: 'response.create', model: 'gpt-synthetic', input: [] }),
    ]);
    expect(connection.physical[1]?.readyState).toBe(3);
    expect(connection.physical[2]?.submitted).toEqual(['never-attempted-second', 'never-attempted-third']);
    connection.close();
  });
});
