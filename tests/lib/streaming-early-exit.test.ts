import { setImmediate as nextTurn } from 'node:timers/promises';
import { vi } from 'vitest';
import OpenAI from 'openai';
import type { ResponseTextDeltaEvent } from 'openai/resources/responses/responses';

const encoder = new TextEncoder();
const responseEvent: ResponseTextDeltaEvent = {
  type: 'response.output_text.delta',
  sequence_number: 0,
  item_id: 'msg_test',
  output_index: 0,
  content_index: 0,
  delta: 'hello',
  logprobs: [],
};

async function publicSSEStream(body: ReadableStream<Uint8Array>) {
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  });
  return await client.responses.create({ model: 'gpt-4o', input: 'hello', stream: true });
}

function settlesSoon<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // oxlint-disable-next-line promise/avoid-new -- Bound regression fixtures that intentionally never settle.
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Aborted SSE stream did not settle')), 1500);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

describe('public Responses SSE iterator early exit', () => {
  const event = responseEvent;
  const wire = `data: ${JSON.stringify(event)}\n\n`;

  test.each([
    ['break', 'resolve'],
    ['break', 'reject'],
    ['return', 'resolve'],
    ['return', 'reject'],
  ] as const)('settles %s before deferred body cancellation can %s', async (method, settlement) => {
    let finishCleanup!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- The native cancellation fixture must remain pending during early exit.
    const cleanup = new Promise<void>((resolve, reject) => {
      finishCleanup = () =>
        settlement === 'resolve' ? resolve() : reject(new Error('synthetic cleanup failure'));
    });
    const cancel = vi.fn(() => cleanup);
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(encoder.encode(wire));
      },
      cancel,
    });
    const stream = await publicSSEStream(body);
    const unhandled = vi.fn();
    let pending: Promise<unknown>;
    if (method === 'break') {
      pending = (async () => {
        for await (const item of stream) {
          expect(item).toEqual(event);
          break;
        }
      })();
    } else {
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
      pending = Promise.resolve(iterator.return?.());
    }
    let settled = false;
    const observed = (async () => {
      try {
        return await pending;
      } catch (error) {
        return error;
      } finally {
        settled = true;
      }
    })();
    process.on('unhandledRejection', unhandled);

    try {
      await nextTurn();
      expect(settled).toBe(true);
      expect(stream.controller.signal.aborted).toBe(true);
      expect(body.locked).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
      await expect(observed).resolves.toEqual(
        method === 'break' ? undefined : { done: true, value: undefined },
      );
    } finally {
      finishCleanup();
      stream.controller.abort();
      try {
        await settlesSoon(observed);
        await nextTurn();
      } finally {
        process.removeListener('unhandledRejection', unhandled);
      }
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'returning an unused iterator preserves the owner (started: %s)',
    async (started) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(source) {
          source.enqueue(encoder.encode(`${wire}data: [DONE]\n\n`));
        },
        cancel,
      });
      const stream = await publicSSEStream(body);
      const owner = stream[Symbol.asyncIterator]();
      const unused = stream[Symbol.asyncIterator]();
      if (started) {
        await expect(owner.next()).resolves.toEqual({ done: false, value: event });
      }
      await expect(unused.return?.()).resolves.toEqual({ done: true, value: undefined });
      expect(stream.controller.signal.aborted).toBe(false);
      expect(cancel).not.toHaveBeenCalled();
      expect(body.locked).toBe(started);
      if (!started) {
        await expect(owner.next()).resolves.toEqual({ done: false, value: event });
      }
      await expect(owner.next()).resolves.toEqual({ done: true, value: undefined });
      expect(stream.controller.signal.aborted).toBe(false);
      expect(body.locked).toBe(false);
    },
  );

  test.each(['EOF', '[DONE]'])('return after %s does not abort a completed stream', async (ending) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(encoder.encode(`${wire}${ending === '[DONE]' ? 'data: [DONE]\n\n' : ''}`));
        if (ending === 'EOF') {
          source.close();
        }
      },
      cancel,
    });
    const stream = await publicSSEStream(body);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined });
    expect(stream.controller.signal.aborted).toBe(false);
    expect(body.locked).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(ending === 'EOF' ? 0 : 1);
  });

  test('preserves iterator throw identity with immediate body cleanup', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(encoder.encode(wire));
      },
      cancel,
    });
    const stream = await publicSSEStream(body);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
    const failure = new Error('synthetic consumer failure');
    await expect(iterator.throw?.(failure)).rejects.toBe(failure);
    expect(stream.controller.signal.aborted).toBe(true);
    expect(body.locked).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
