import { setTimeout } from 'node:timers/promises';

import { expect, test, vi } from 'vitest';

import {
  createRequest,
  createResponse,
  invoke,
  loadExample,
  loadPublicHTTPExample,
} from './streaming-example-test-utils';

const largeContentChunk = 'x'.repeat(256 * 1024);
const largeContentChunkCount = 64;

test('the raw example waits for drain before consuming another upstream chunk', async () => {
  const runtime = loadExample('stream-to-client-raw.ts');
  const request = createRequest();
  const response = createResponse();
  response.writeResult = false;

  const pending = invoke(runtime, request, response);
  await vi.waitFor(() => expect(response.listenerCount('drain')).toBe(1));

  expect(runtime.generated).toBe(1);
  expect(response.write).toHaveBeenCalledOnce();
  expect(response.end).not.toHaveBeenCalled();

  response.writeResult = true;
  response.emit('drain');
  await pending;

  expect(runtime.generated).toBe(3);
  expect(response.body).toBe('safe chunk'.repeat(3));
  expect(response.end).toHaveBeenCalledOnce();
  expect(runtime.signal?.aborted).toBe(false);
  expect(runtime.consoleError).not.toHaveBeenCalled();
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('drain')).toBe(0);
  expect(response.listenerCount('error')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});

test.each(['response close', 'request abort', 'close during write'] as const)(
  'the raw example cancels a drain wait after %s',
  async (event) => {
    const runtime = loadExample('stream-to-client-raw.ts');
    const request = createRequest();
    const response = createResponse();
    response.writeResult = false;
    if (event === 'close during write') {
      response.onWrite = () => response.destroy();
    }

    const pending = invoke(runtime, request, response);
    if (event !== 'close during write') {
      await vi.waitFor(() => expect(response.listenerCount('drain')).toBe(1));
      if (event === 'response close') {
        response.destroy();
      } else {
        request.emit('aborted');
      }
    }
    await pending;

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.generated).toBe(1);
    expect(runtime.cancellations).toBe(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(runtime.consoleError).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  },
);

test.each(['write', 'drain wait'] as const)(
  'the raw example reports a genuine response error during %s',
  async (phase) => {
    const failure = new Error(`intentional response ${phase} failure`);
    const runtime = loadExample('stream-to-client-raw.ts');
    const request = createRequest();
    const response = createResponse();
    response.writeResult = false;
    if (phase === 'write') {
      response.onWrite = () => {
        throw failure;
      };
    }

    const pending = invoke(runtime, request, response);
    if (phase === 'drain wait') {
      await vi.waitFor(() => expect(response.listenerCount('drain')).toBe(1));
      response.emit('error', failure);
    }
    await pending;

    expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(runtime.signal?.aborted).toBe(false);
    expect(runtime.cancellations).toBe(1);
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  },
);

test.each(['response close', 'request abort'] as const)(
  'the raw example preserves a response error immediately followed by %s',
  async (event) => {
    const failure = new Error('intentional response error before client disconnect');
    const runtime = loadExample('stream-to-client-raw.ts');
    const request = createRequest();
    const response = createResponse();
    response.writeResult = false;

    const pending = invoke(runtime, request, response);
    await vi.waitFor(() => expect(response.listenerCount('drain')).toBe(1));
    response.emit('error', failure);
    if (event === 'response close') {
      response.destroy();
    } else {
      request.emit('aborted');
    }
    await pending;

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(runtime.cancellations).toBe(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  },
);

test.each(['resume', 'disconnect', 'upstream failure'] as const)(
  'the raw example handles a paused real downstream client followed by %s',
  async (mode) => {
    const downstream = await loadPublicHTTPExample('stream-to-client-raw.ts', {
      content: largeContentChunk,
      contentCount: largeContentChunkCount,
      terminalEvent:
        mode === 'upstream failure'
          ? { error: { message: 'intentional upstream failure after backpressure' } }
          : 'done',
    });
    const { client, controller } = downstream;
    try {
      const incoming = await fetch(downstream.url, {
        method: 'POST',
        body: 'A synthetic prompt',
        signal: controller.signal,
      });
      // Leave the actual HTTP response unread while the provider sends 16 MiB.
      await vi.waitFor(() => expect(downstream.outgoing?.writableNeedDrain).toBe(true));
      await setTimeout(100);
      expect(downstream.routeFinished).toBe(false);
      expect(downstream.outgoing?.writableNeedDrain).toBe(true);
      expect(downstream.outgoing?.writableLength).toBeLessThan(largeContentChunk.length * 2);
      expect(incoming.status).toBe(200);

      if (mode === 'resume') {
        expect(await incoming.text()).toBe(largeContentChunk.repeat(largeContentChunkCount));
      } else if (mode === 'upstream failure') {
        await expect(incoming.text()).rejects.toThrow();
      } else {
        controller.abort();
      }
      await vi.waitFor(() => expect(downstream.routeFinished).toBe(true));
      expect(client.transport).toHaveBeenCalledOnce();
      expect(client.upstreamClosed).toHaveLength(1);
      await client.upstreamClosed[0];

      if (mode === 'upstream failure') {
        expect(client.runtime.consoleError).toHaveBeenCalledOnce();
        expect(String(client.runtime.consoleError.mock.calls[0]?.[0])).toContain(
          'intentional upstream failure after backpressure',
        );
        expect(downstream.outgoing?.destroyed).toBe(true);
      } else {
        expect(client.runtime.consoleError).not.toHaveBeenCalled();
        expect(client.signal?.aborted).toBe(mode === 'disconnect');
      }
      expect(downstream.outgoing?.writableEnded).toBe(mode === 'resume');
      expect(downstream.incomingRequest?.listenerCount('aborted')).toBe(0);
      expect(downstream.outgoing?.listenerCount('drain')).toBe(0);
      expect(downstream.outgoing?.listenerCount('error')).toBe(0);
      expect(downstream.outgoing?.listenerCount('close')).toBe(0);
    } finally {
      await downstream.close();
    }
  },
);
