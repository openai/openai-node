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
  test('keeps full server error payloads out of serialized diagnostics', () => {
    const websocket = create(new OpenAI({ apiKey: 'test-key' }));
    const errors = vi.fn();
    onWebSocketEvent(websocket, 'error', errors);
    const event = { type: 'error', error: { detail: 'synthetic-private-payload' } };
    try {
      dispatchFrame(websocket, JSON.stringify(event));
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'unknown error', error: event }),
      );
      const error = errors.mock.calls[0]?.[0];
      expect(JSON.stringify(error)).not.toContain('synthetic-private-payload');
      expect({ ...error }).not.toHaveProperty('error');
      expect({ ...error }).not.toHaveProperty('error');
    } finally {
      websocket.close();
    }
  });

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

describe.each(websocketVariants.filter(({ name }) => name.endsWith('Responses')))(
  '$name server error messages',
  ({ create }) => {
    test.each<{ message: unknown; expected: string }>([
      { message: 'synthetic server error', expected: 'synthetic server error' },
      { message: '', expected: '' },
      { message: 0, expected: 'unknown error' },
      { message: false, expected: 'unknown error' },
      { message: { detail: 'synthetic detail' }, expected: 'unknown error' },
      { message: ['synthetic', 'error'], expected: 'unknown error' },
      { message: { toString: null }, expected: 'unknown error' },
      { message: { toString: {}, valueOf: null }, expected: 'unknown error' },
      { message: [{ toString: null }], expected: 'unknown error' },
    ])('delivers flat and nested message $message safely', async ({ message, expected }) => {
      const websocket = create(new OpenAI({ apiKey: 'test-key' }));
      const errors = vi.fn();
      const events = vi.fn();
      onWebSocketEvent(websocket, 'error', errors);
      onWebSocketEvent(websocket, 'event', events);
      const iterator = websocket.stream();

      try {
        await iterator.next();
        const deliveries = [
          { type: 'error', message },
          { type: 'error', error: { message } },
        ].map((event) => {
          expect(() => dispatchFrame(websocket, JSON.stringify(event))).not.toThrow();
          const error = errors.mock.lastCall?.[0];
          expect(error).toBeInstanceOf(OpenAIError);
          expect(error.message).toBe(expected);
          expect(error.error).toBe(events.mock.lastCall?.[0]);
          expect(error.error).toEqual(event);
          return expect(iterator.next()).resolves.toEqual({ value: { type: 'error', error }, done: false });
        });
        await Promise.all(deliveries);
        expect(errors).toHaveBeenCalledTimes(2);
      } finally {
        await iterator.return?.();
        websocket.close();
      }
    });

    test('preserves asynchronous rejection without an error listener', () => {
      const websocket = create(new OpenAI({ apiKey: 'test-key' }));
      // SAFETY: Replace Promise.reject with a fulfilled sentinel solely to record the requested rejection without creating an unhandled test rejection.
      const reject = vi.spyOn(Promise, 'reject').mockReturnValue(Promise.resolve() as Promise<never>);
      const event = { type: 'error', message: { toString: null } };

      try {
        expect(() => dispatchFrame(websocket, JSON.stringify(event))).not.toThrow();
        expect(reject).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            message: expect.stringContaining('unknown error'),
            error: event,
          }),
        );
        expect(reject.mock.lastCall?.[0]).toBeInstanceOf(OpenAIError);
      } finally {
        reject.mockRestore();
        websocket.close();
      }
    });

    test('preserves transport causes and exceptions from application error listeners', () => {
      const websocket = create(new OpenAI({ apiKey: 'test-key' }));
      const cause = new Error('synthetic transport failure');
      const listenerError = new Error('application listener failed');
      const errors = vi.fn<(error: unknown) => void>(() => {
        throw listenerError;
      });
      onWebSocketEvent(websocket, 'error', errors);

      try {
        expect(() => websocket.socket.platformSocket.emit('error', cause)).toThrow(listenerError);
        expect(errors.mock.lastCall?.[0]).toEqual(
          expect.objectContaining({ message: cause.message, cause, error: undefined }),
        );
      } finally {
        websocket.close();
      }
    });
  },
);
