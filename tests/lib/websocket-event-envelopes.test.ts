import { expect, vi } from 'vitest';
import OpenAI, { OpenAIError } from 'openai';
import { dispatchFrame, onWebSocketEvent, websocketVariants } from './helpers/websocket-variants';

const invalidEnvelopes = [
  'null',
  'false',
  'true',
  '0',
  '1',
  '""',
  '"response.created"',
  '[]',
  '[{"type":"response.created"}]',
  '{}',
  '{"type":null}',
  '{"type":false}',
  '{"type":0}',
  '{"type":[]}',
  '{"type":{}}',
  '{"__proto__":{"type":"response.created"}}',
].map((frame) => ({
  frame,
  message: 'received invalid WebSocket event: expected an object with an own string type',
}));

const reservedEnvelopes = ['raw', 'close', 'event', 'reconnecting', 'reconnected', 'open'].map((type) => ({
  frame: JSON.stringify({ type }),
  message: 'received reserved WebSocket event type',
}));

describe.each(websocketVariants)('$name event envelopes', ({ create }) => {
  test.each([...invalidEnvelopes, ...reservedEnvelopes])(
    'rejects $frame without misdispatch',
    async ({ frame, message }) => {
      const websocket = create(new OpenAI({ apiKey: 'test-key' }));
      const errors = vi.fn();
      const unexpected = vi.fn();
      onWebSocketEvent(websocket, 'error', errors);
      onWebSocketEvent(websocket, 'event', unexpected);
      onWebSocketEvent(websocket, 'raw', unexpected);
      onWebSocketEvent(websocket, 'close', unexpected);
      onWebSocketEvent(websocket, 'reconnecting', unexpected);
      onWebSocketEvent(websocket, 'reconnected', unexpected);
      const iterator = websocket.stream();

      try {
        await expect(iterator.next()).resolves.toEqual({ value: { type: 'open' }, done: false });
        expect(() => dispatchFrame(websocket, frame)).not.toThrow();
        expect(errors).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message, error: undefined }),
        );
        const error = errors.mock.calls[0]?.[0];
        expect(error).toBeInstanceOf(OpenAIError);
        expect(unexpected).not.toHaveBeenCalled();
        await expect(iterator.next()).resolves.toEqual({ value: { type: 'error', error }, done: false });

        const event = { type: 'future.event', sequence_number: 1 };
        dispatchFrame(websocket, JSON.stringify(event));
        expect(unexpected).toHaveBeenCalledExactlyOnceWith(event);
        await expect(iterator.next()).resolves.toEqual({
          value: { type: 'message', message: event },
          done: false,
        });
        websocket.close();
        await expect(iterator.next()).resolves.toEqual({
          value: { type: 'close', code: 1000, reason: 'OK', unsent: [] },
          done: false,
        });
        await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      } finally {
        await iterator.return?.();
        websocket.close();
      }
    },
  );

  test('preserves raw frames, server errors, and forward-compatible string event types', async () => {
    const websocket = create(new OpenAI({ apiKey: 'test-key' }));
    const iterator = websocket.stream();

    try {
      await iterator.next();
      const events = ['', '__proto__', 'constructor', 'future.event'].map((type) => ({ type }));
      for (const event of events) {
        dispatchFrame(websocket, JSON.stringify(event));
      }
      await expect(Promise.all(events.map(() => iterator.next()))).resolves.toEqual(
        events.map((message) => ({ value: { type: 'message', message }, done: false })),
      );

      const serverError = { type: 'error', error: { message: 'synthetic server error' } };
      dispatchFrame(websocket, JSON.stringify(serverError));
      await expect(iterator.next()).resolves.toEqual({
        value: { type: 'error', error: expect.objectContaining({ error: serverError }) },
        done: false,
      });

      const rawFrames = ['not json', Buffer.from([1, 2, 3])];
      for (const data of rawFrames) {
        dispatchFrame(websocket, data, Buffer.isBuffer(data));
      }
      await expect(Promise.all(rawFrames.map(() => iterator.next()))).resolves.toEqual(
        rawFrames.map((data) => ({ value: { type: 'raw', data }, done: false })),
      );
    } finally {
      await iterator.return?.();
      websocket.close();
    }
  });
});
