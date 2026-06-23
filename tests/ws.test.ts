import { SendQueue, type RawWebSocketData } from 'openai/internal/ws';

describe('SendQueue', () => {
  test('enqueues messages within the byte limit', () => {
    const queue = new SendQueue(100);
    expect(queue.enqueue({ msg: 'hello' })).toBe(true);
    expect(queue.enqueue({ msg: 'world' })).toBe(true);
  });

  test('rejects messages that would exceed the byte limit when queue is non-empty', () => {
    const queue = new SendQueue(20);
    expect(queue.enqueue({ a: 1 })).toBe(true);
    // This second message would push the queue over the limit
    expect(queue.enqueue({ b: 'x'.repeat(100) })).toBe(false);
  });

  test('accepts a single oversized message when the queue is empty', () => {
    const queue = new SendQueue(5);
    // The JSON representation is much larger than 5 bytes
    expect(queue.enqueue({ message: 'this is way larger than 5 bytes' })).toBe(true);
  });

  test('rejects further messages after an oversized message is queued', () => {
    const queue = new SendQueue(5);
    expect(queue.enqueue({ message: 'this is way larger than 5 bytes' })).toBe(true);
    expect(queue.enqueue({ x: 1 })).toBe(false);
  });

  test('accepts a single oversized raw message when the queue is empty', () => {
    const queue = new SendQueue(5);
    const bigData = 'x'.repeat(100);
    expect(queue.enqueueRaw(bigData)).toBe(true);
  });

  test('rejects oversized raw messages when the queue is non-empty', () => {
    const queue = new SendQueue(20);
    expect(queue.enqueueRaw('small')).toBe(true);
    expect(queue.enqueueRaw('x'.repeat(100))).toBe(false);
  });

  test('flush sends all queued messages and resets the queue', () => {
    const queue = new SendQueue(1024);
    queue.enqueue({ a: 1 });
    queue.enqueue({ b: 2 });

    const sent: unknown[] = [];
    queue.flush((data: RawWebSocketData) => sent.push(data));

    expect(sent).toEqual([JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 })]);

    // Queue is empty after flush, so oversized message should be accepted
    expect(queue.enqueue({ message: 'x'.repeat(2000) })).toBe(true);
  });

  test('flush re-queues remaining messages on error', () => {
    const queue = new SendQueue(1024);
    queue.enqueue({ a: 1 });
    queue.enqueue({ b: 2 });
    queue.enqueue({ c: 3 });

    let callCount = 0;
    expect(() =>
      queue.flush((data: RawWebSocketData) => {
        callCount++;
        if (callCount === 2) throw new Error('send failed');
      }),
    ).toThrow('send failed');

    // The failed message and all after it should be re-queued
    const drained = queue.drain();
    expect(drained).toEqual([
      { type: 'message', message: { b: 2 } },
      { type: 'message', message: { c: 3 } },
    ]);
  });

  test('drain returns unsent messages and resets the queue', () => {
    const queue = new SendQueue(1024);
    queue.enqueue({ msg: 'hello' });
    queue.enqueueRaw('raw-data');

    const unsent = queue.drain();
    expect(unsent).toEqual([
      { type: 'message', message: { msg: 'hello' } },
      { type: 'raw', data: 'raw-data' },
    ]);

    // Queue is empty after drain
    expect(queue.drain()).toEqual([]);
  });
});
