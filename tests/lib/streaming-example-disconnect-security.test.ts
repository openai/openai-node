import { describe, expect, test, vi } from 'vitest';

import { APIUserAbortError } from '../../src/index';
import {
  createRequest,
  createResponse,
  examples,
  invoke,
  loadExample,
  loadPublicExample,
  loadPublicHTTPExample,
} from './streaming-example-test-utils';

describe.each(examples)('%s upstream disconnect lifecycle', (filename) => {
  test('aborts upstream and closes its iterator as soon as the downstream socket closes', async () => {
    const runtime = loadExample(filename);
    const request = createRequest();
    const response = createResponse();
    response.onWrite = () => {
      response.destroyed = true;
      response.emit('close');
    };

    await invoke(runtime, request, response);

    expect(runtime.signal).toBeInstanceOf(AbortSignal);
    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.aborts).toBe(1);
    expect(runtime.generated).toBe(1);
    expect(runtime.cancellations).toBe(1);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  test('aborts upstream and closes its iterator when the request is aborted', async () => {
    const runtime = loadExample(filename);
    const request = createRequest();
    const response = createResponse();
    response.onWrite = () => request.emit('aborted');

    await invoke(runtime, request, response);

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.aborts).toBe(1);
    expect(runtime.generated).toBe(1);
    expect(runtime.cancellations).toBe(1);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  test('handles an immediate socket close during provider initialization', async () => {
    const runtime = loadExample(filename);
    const request = createRequest();
    const response = createResponse();
    runtime.onProvider = () => {
      response.destroyed = true;
      response.emit('close');
    };

    await invoke(runtime, request, response);

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.aborts).toBe(1);
    expect(runtime.generated).toBe(0);
    expect(response.header).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  test('preserves a complete stream and removes disconnect listeners without aborting', async () => {
    const runtime = loadExample(filename);
    const request = createRequest();
    const response = createResponse();

    await invoke(runtime, request, response);

    expect(runtime.signal).toBeInstanceOf(AbortSignal);
    expect(runtime.signal?.aborted).toBe(false);
    expect(runtime.aborts).toBe(0);
    expect(runtime.generated).toBe(3);
    expect(runtime.cancellations).toBe(0);
    expect(response.write).toHaveBeenCalledTimes(3);
    expect(response.end).toHaveBeenCalledOnce();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);

    response.emit('close');
    expect(runtime.aborts).toBe(0);
  });

  test('does not misinterpret normal request-body close as a disconnect', async () => {
    const runtime = loadExample(filename);
    const request = createRequest();
    const response = createResponse();
    runtime.onProvider = () => request.emit('close');

    await invoke(runtime, request, response);

    expect(runtime.signal?.aborted).toBe(false);
    expect(runtime.aborts).toBe(0);
    expect(response.write).toHaveBeenCalledTimes(3);
    expect(response.end).toHaveBeenCalledOnce();
  });

  test('keeps bare-VM plain request/response compatibility without AbortController', async () => {
    const runtime = loadExample(filename, { withoutAbortController: true });
    const request = { body: 'legacy request', get: vi.fn() };
    const response = {
      header: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    await invoke(runtime, request, response);

    expect(runtime.apiCalls).toBe(1);
    expect(runtime.signal).toBeUndefined();
    expect(response.write).toHaveBeenCalledTimes(3);
    expect(response.end).toHaveBeenCalledOnce();
  });
});

test.each(examples)('%s does not rewrite an already-ended response after an error', async (filename) => {
  const providerError = new Error('upstream failed after the response ended');
  const runtime = loadExample(filename);
  const request = createRequest();
  const response = createResponse();
  runtime.onProvider = () => {
    response.end();
    throw providerError;
  };

  await invoke(runtime, request, response);

  expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(providerError);
  expect(response.status).not.toHaveBeenCalled();
  expect(response.end).toHaveBeenCalledOnce();
  expect(response.destroy).not.toHaveBeenCalled();
});

test.each([
  ['stream-to-client-express.ts', 'response close'],
  ['stream-to-client-express.ts', 'request abort'],
  ['stream-to-client-raw.ts', 'response close'],
  ['stream-to-client-raw.ts', 'request abort'],
] as const)(
  'the public SDK aborts %s through the real loopback transport after %s',
  async (filename, event) => {
    const client = await loadPublicExample(filename, {
      pendingHeaders: filename === 'stream-to-client-raw.ts',
    });
    const request = createRequest();
    const response = createResponse();

    try {
      const pending = invoke(client.runtime, request, response);
      await vi.waitFor(() => expect(client.transport).toHaveBeenCalledOnce(), { timeout: 250 });
      await vi.waitFor(() => expect(client.upstreamClosed).toHaveLength(1));

      if (filename === 'stream-to-client-express.ts') {
        await vi.waitFor(() => expect(client.body?.locked).toBe(true));
      }

      expect(client.signal).toBeInstanceOf(AbortSignal);
      expect(client.signal?.aborted).toBe(false);

      if (event === 'response close') {
        response.destroyed = true;
        response.emit('close');
      } else {
        request.emit('aborted');
      }

      await pending;
      await client.upstreamClosed[0];

      expect(client.signal?.aborted).toBe(true);
      expect(client.runtime.consoleError).not.toHaveBeenCalled();
      expect(response.write).not.toHaveBeenCalled();
      expect(response.end).not.toHaveBeenCalled();
      expect(request.listenerCount('aborted')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
    } finally {
      await client.close();
    }
  },
);

test.each(examples)(
  'the public SDK completes %s through the real SSE loopback transport',
  async (filename) => {
    const client = await loadPublicExample(filename, { contentCount: 1, terminalEvent: 'done' });
    const request = createRequest();
    const response = createResponse();

    try {
      await invoke(client.runtime, request, response);

      expect(client.transport).toHaveBeenCalledOnce();
      expect(client.runtime.consoleError).not.toHaveBeenCalled();
      expect(response.write).toHaveBeenCalled();
      expect(response.end).toHaveBeenCalledOnce();
      expect(request.listenerCount('aborted')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
    } finally {
      await client.close();
    }
  },
);

test.each(examples)('the public SDK still reports genuine upstream failures from %s', async (filename) => {
  const client = await loadPublicExample(filename, { httpError: 'intentional public upstream failure' });
  const request = createRequest();
  const response = createResponse();

  try {
    await invoke(client.runtime, request, response);

    expect(client.transport).toHaveBeenCalledOnce();
    expect(client.runtime.consoleError).toHaveBeenCalledOnce();
    expect(String(client.runtime.consoleError.mock.calls[0]?.[0])).toContain(
      'intentional public upstream failure',
    );
    expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
    expect(response.end).toHaveBeenCalledExactlyOnceWith('Internal Server Error');
    expect(response.body).toBe('Internal Server Error');
    expect(response.destroy).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  } finally {
    await client.close();
  }
});

test.each(
  examples.flatMap((filename) => [
    { filename, mode: 'failure' as const },
    { filename, mode: 'partial' as const },
  ]),
)(
  '$filename finishes the real downstream HTTP connection after an upstream $mode',
  async ({ filename, mode }) => {
    const downstream = await loadPublicHTTPExample(
      filename,
      mode === 'failure' ? { httpError: 'intentional public upstream failure' } : { contentCount: 1 },
    );
    const { client, controller } = downstream;
    let receivedStatus: number | undefined;
    const result = (async () => {
      try {
        const response = await fetch(downstream.url, {
          method: 'POST',
          body: 'A synthetic prompt',
          signal: controller.signal,
        });
        receivedStatus = response.status;
        return { status: response.status, body: await response.text() };
      } catch (error) {
        return { error };
      }
    })();

    try {
      if (mode === 'partial') {
        await vi.waitFor(() => expect(receivedStatus).toBe(200));
        client.upstream.closeAllConnections();
      }
      await vi.waitFor(() => expect(downstream.routeFinished).toBe(true));
      expect(client.runtime.consoleError).toHaveBeenCalledOnce();
      if (mode === 'failure') {
        expect(downstream.outgoing?.writableEnded).toBe(true);
        expect(await result).toEqual({ status: 500, body: 'Internal Server Error' });
      } else {
        expect(downstream.outgoing?.destroyed).toBe(true);
        expect(downstream.outgoing?.writableEnded).toBe(false);
        expect(await result).toHaveProperty('error');
      }
    } finally {
      await downstream.close();
      await result;
    }
  },
);

test.each(['response close', 'request abort'] as const)(
  'the Express example silently handles an SDK iterator abort after %s',
  async (disconnectEvent) => {
    const runtime = loadExample('stream-to-client-express.ts');
    runtime.pendingNext = true;
    const request = createRequest();
    const response = createResponse();

    const pending = invoke(runtime, request, response);
    expect(runtime.rejectNext).toBeDefined();

    if (disconnectEvent === 'response close') {
      response.destroyed = true;
      response.emit('close');
    } else {
      request.emit('aborted');
    }

    await pending;

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.aborts).toBe(1);
    expect(runtime.generated).toBe(0);
    expect(runtime.consoleError).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  },
);

test('the Express example still reports a genuine iterator error after a client disconnect', async () => {
  const providerError = new Error('upstream stream failed during cancellation');
  const runtime = loadExample('stream-to-client-express.ts');
  runtime.pendingNext = true;
  runtime.abortError = providerError;
  const request = createRequest();
  const response = createResponse();

  const pending = invoke(runtime, request, response);
  response.destroyed = true;
  response.emit('close');
  await pending;

  expect(runtime.signal?.aborted).toBe(true);
  expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(providerError);
  expect(response.status).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
  expect(response.destroy).not.toHaveBeenCalled();
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});

test.each([
  ['a genuine upstream stream failure', new Error('upstream stream failed')],
  ['an SDK abort without a client disconnect', new APIUserAbortError()],
])('the Express example still reports %s', async (_description, providerError) => {
  const runtime = loadExample('stream-to-client-express.ts');
  runtime.pendingNext = true;
  const request = createRequest();
  const response = createResponse();

  const pending = invoke(runtime, request, response);
  runtime.rejectNext?.(providerError);
  await pending;

  expect(runtime.signal?.aborted).toBe(false);
  expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(providerError);
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});

test.each(['response close', 'request abort'] as const)(
  'the raw example silently handles an SDK abort while create is pending after %s',
  async (disconnectEvent) => {
    const runtime = loadExample('stream-to-client-raw.ts');
    runtime.pendingCreate = true;
    const request = createRequest();
    const response = createResponse();

    const pending = invoke(runtime, request, response);
    expect(runtime.rejectCreate).toBeDefined();

    if (disconnectEvent === 'response close') {
      response.destroyed = true;
      response.emit('close');
    } else {
      request.emit('aborted');
    }

    await pending;

    expect(runtime.signal?.aborted).toBe(true);
    expect(runtime.aborts).toBe(1);
    expect(runtime.generated).toBe(0);
    expect(runtime.consoleError).not.toHaveBeenCalled();
    expect(response.header).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  },
);

test('the raw example still reports a genuine provider error after a client disconnect', async () => {
  const providerError = new Error('upstream connection failed during cancellation');
  const runtime = loadExample('stream-to-client-raw.ts');
  runtime.pendingCreate = true;
  runtime.abortError = providerError;
  const request = createRequest();
  const response = createResponse();

  const pending = invoke(runtime, request, response);
  response.destroyed = true;
  response.emit('close');
  await pending;

  expect(runtime.signal?.aborted).toBe(true);
  expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(providerError);
  expect(response.status).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
  expect(response.destroy).not.toHaveBeenCalled();
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});

test.each([
  ['a genuine provider failure', new Error('upstream connection failed')],
  ['an SDK abort without a client disconnect', new APIUserAbortError()],
])('the raw example still reports %s', async (_description, providerError) => {
  const runtime = loadExample('stream-to-client-raw.ts');
  runtime.pendingCreate = true;
  const request = createRequest();
  const response = createResponse();

  const pending = invoke(runtime, request, response);
  runtime.rejectCreate?.(providerError);
  await pending;

  expect(runtime.signal?.aborted).toBe(false);
  expect(runtime.consoleError).toHaveBeenCalledExactlyOnceWith(providerError);
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});
