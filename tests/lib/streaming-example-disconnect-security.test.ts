import { timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';

import OpenAI, { APIUserAbortError } from '../../src/index';

const examples = ['stream-to-client-express.ts', 'stream-to-client-raw.ts'] as const;
const largeContentChunk = 'x'.repeat(256 * 1024);
const largeContentChunkCount = 64;

type Example = (typeof examples)[number];
interface Completion {
  choices: [{ delta: { content: string } }];
}
type RouteHandler = (request: unknown, response: unknown) => Promise<void>;

interface ExampleRuntime {
  apiCalls: number;
  aborts: number;
  generated: number;
  cancellations: number;
  consoleError: ReturnType<typeof vi.fn>;
  handler?: RouteHandler;
  signal?: AbortSignal;
  onProvider?: () => void;
  pendingCreate: boolean;
  pendingNext: boolean;
  abortError?: Error;
  rejectCreate?: (error: Error) => void;
  rejectNext?: (error: Error) => void;
}

function createNodeHTTPEmitter(): EventEmitter {
  // Node HTTP requests and responses expose EventEmitter lifecycle events.
  // oxlint-disable-next-line unicorn/prefer-event-target
  return new EventEmitter();
}

function createRequest() {
  return Object.assign(createNodeHTTPEmitter(), {
    body: 'Tell me why dogs are better than cats',
    get: vi.fn(),
  });
}

function createResponse() {
  const response = Object.assign(createNodeHTTPEmitter(), {
    body: '',
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    writableEnded: false,
    writeResult: true,
    onWrite: null as (() => void) | null,
  });

  return Object.assign(response, {
    header: vi.fn((_name: string, _value: string) => response),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),

    write: vi.fn((chunk: unknown) => {
      if (response.destroyed) {
        throw new Error('Attempted to write to a destroyed socket');
      }

      response.headersSent = true;
      response.body += String(chunk);
      response.onWrite?.();
      return response.writeResult;
    }),

    end: vi.fn((chunk?: string) => {
      if (response.destroyed) {
        throw new Error('Attempted to end a destroyed socket');
      }

      response.body += chunk ?? '';
      response.headersSent = true;
      response.writableEnded = true;
      response.emit('finish');
      return response;
    }),

    destroy: vi.fn(() => {
      response.destroyed = true;
      response.emit('close');
      return response;
    }),
  });
}

function completionChunks(runtime: ExampleRuntime, encoded: boolean): AsyncIterable<string | Completion> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;

      return {
        async next() {
          if (encoded && runtime.pendingNext) {
            runtime.pendingNext = false;
            const deferred = new AbortController();
            let failure: Error | undefined;
            const pending = once(deferred.signal, 'abort').then(() => {
              throw failure ?? new APIUserAbortError();
            });

            runtime.rejectNext = (error) => {
              failure = error;
              deferred.abort();
            };
            runtime.signal?.addEventListener(
              'abort',
              () => runtime.rejectNext?.(runtime.abortError ?? new APIUserAbortError()),
              { once: true },
            );
            return pending;
          }

          if (index >= 3) {
            return { done: true as const, value: undefined };
          }

          index += 1;
          runtime.generated += 1;
          return {
            done: false as const,
            value: encoded ? 'safe chunk' : { choices: [{ delta: { content: 'safe chunk' } }] },
          };
        },

        async return() {
          runtime.cancellations += 1;
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

function loadExample(
  filename: Example,
  options: { withoutAbortController?: boolean; client?: new () => OpenAI } = {},
): ExampleRuntime {
  const runtime: ExampleRuntime = {
    apiCalls: 0,
    aborts: 0,
    generated: 0,
    cancellations: 0,
    consoleError: vi.fn(),
    pendingCreate: false,
    pendingNext: false,
  };

  const app = {
    use() {
      return app;
    },

    post(_path: string, handler: RouteHandler) {
      runtime.handler = handler;
      return app;
    },

    listen() {
      return app;
    },
  };

  const express = Object.assign(() => app, {
    text: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  });

  function configureProvider(providerOptions?: { signal?: AbortSignal }): void {
    runtime.apiCalls += 1;

    if (providerOptions?.signal) {
      runtime.signal = providerOptions.signal;
      runtime.signal.addEventListener(
        'abort',
        () => {
          runtime.aborts += 1;
        },
        { once: true },
      );
    }
  }

  class MockOpenAI {
    static APIUserAbortError = APIUserAbortError;

    readonly chat = {
      completions: {
        stream: (_body: unknown, providerOptions?: { signal?: AbortSignal }) => {
          configureProvider(providerOptions);
          runtime.onProvider?.();
          return {
            toReadableStream: () => completionChunks(runtime, true),
          };
        },

        create: (_body: unknown, providerOptions?: { signal?: AbortSignal }) => {
          configureProvider(providerOptions);
          const chunks = completionChunks(runtime, false) as AsyncIterable<Completion>;

          if (runtime.pendingCreate) {
            const deferred = new AbortController();
            let failure: Error | undefined;
            const pending = once(deferred.signal, 'abort').then(() => {
              throw failure ?? new APIUserAbortError();
            });

            runtime.rejectCreate = (error) => {
              failure = error;
              deferred.abort();
            };
            runtime.signal?.addEventListener(
              'abort',
              () => runtime.rejectCreate?.(runtime.abortError ?? new APIUserAbortError()),
              { once: true },
            );
            runtime.onProvider?.();
            return pending;
          }

          runtime.onProvider?.();
          return Promise.resolve(chunks);
        },
      },
    };
  }

  const source = readFileSync(`examples/chat-completions/${filename}`, 'utf-8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;

  function requireExampleModule(specifier: string): unknown {
    if (specifier === 'openai') {
      return { __esModule: true, default: options.client ?? MockOpenAI };
    }
    if (specifier === 'express') {
      return { __esModule: true, default: express };
    }
    if (specifier === 'node:crypto') {
      return { timingSafeEqual };
    }
    if (specifier === 'node:events') {
      return { once };
    }
    if (specifier === 'node:fs') {
      return { readFileSync: vi.fn() };
    }
    if (specifier === 'node:https') {
      return { createServer: vi.fn() };
    }

    throw new Error(`Unexpected streaming example import: ${specifier}`);
  }

  const commonJS = { exports: {} };
  const globals: Record<string, unknown> = {
    Buffer,
    console: { error: runtime.consoleError, log: vi.fn() },
    exports: commonJS.exports,
    module: commonJS,
    process: { env: {} },
    require: requireExampleModule,
  };

  if (!options.withoutAbortController) {
    globals['AbortController'] = AbortController;
  }

  runInNewContext(transpiled, globals, { filename });
  return runtime;
}

function invoke(runtime: ExampleRuntime, request: unknown, response: unknown): Promise<void> {
  if (!runtime.handler) {
    throw new Error('The streaming example did not register its Express route');
  }

  return runtime.handler(request, response);
}

async function loadPublicExample(
  filename: Example,
  mode: 'pending' | 'complete' | 'failure' | 'partial' | 'large' | 'large-failure' = 'pending',
) {
  const upstreamClosed: Promise<unknown[]>[] = [];
  const upstream = createServer((_request, response) => {
    upstreamClosed.push(once(response, 'close'));

    if (mode === 'failure') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'intentional public upstream failure' } }));
      return;
    }

    if (mode === 'pending' && filename === 'stream-to-client-raw.ts') {
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.flushHeaders();

    if (mode === 'complete' || mode === 'partial' || mode === 'large' || mode === 'large-failure') {
      const large = mode === 'large' || mode === 'large-failure';
      const base = {
        id: 'chatcmpl-public-loopback',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
      };
      const content = {
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: large ? largeContentChunk : 'safe public chunk' },
            finish_reason: null,
          },
        ],
      };
      const finished = {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      if (mode === 'partial') {
        response.write(`data: ${JSON.stringify(content)}\n\n`);
        return;
      }
      const contentEvents = `data: ${JSON.stringify(content)}\n\n`.repeat(large ? largeContentChunkCount : 1);
      const endEvent =
        mode === 'large-failure'
          ? `data: ${JSON.stringify({ error: { message: 'intentional upstream failure after backpressure' } })}\n\n`
          : `data: ${JSON.stringify(finished)}\n\ndata: [DONE]\n\n`;
      response.end(contentEvents + endEvent);
    }
  });

  const listening = once(upstream, 'listening');
  upstream.listen(0, '127.0.0.1');
  await listening;

  const address = upstream.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The public SDK loopback server has no local port');
  }
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  let signal: AbortSignal | undefined;
  let body: ReadableStream<Uint8Array> | null | undefined;
  const transport = vi.fn<typeof fetch>(async (request, options) => {
    signal = options?.signal ?? undefined;
    const response = await fetch(request, options);
    ({ body } = response);
    return response;
  });

  const PublicOpenAI = OpenAI.bind(undefined, {
    apiKey: 'public-sdk-loopback-test-key',
    baseURL,
    fetch: transport,
    maxRetries: 0,
  });

  return {
    runtime: loadExample(filename, { client: PublicOpenAI }),
    transport,
    upstream,
    upstreamClosed,
    get signal() {
      return signal;
    },
    get body() {
      return body;
    },
  };
}

async function closePublicExample(upstream: ReturnType<typeof createServer>): Promise<void> {
  const closed = once(upstream, 'close');
  upstream.closeAllConnections();
  upstream.close();
  await closed;
}

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
    const client = await loadPublicExample(
      'stream-to-client-raw.ts',
      mode === 'upstream failure' ? 'large-failure' : 'large',
    );
    let incomingRequest: IncomingMessage | undefined;
    let outgoing: ServerResponse | undefined;
    let routeFinished = false;
    const downstream = createServer(async (request, response) => {
      incomingRequest = request;
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
      }
      outgoing = response;
      const adaptedResponse = Object.assign(response, {
        header(name: string, value: string) {
          response.setHeader(name, value);
          return response;
        },
        status(code: number) {
          response.statusCode = code;
          return response;
        },
      });
      await invoke(client.runtime, Object.assign(request, { body }), adaptedResponse);
      routeFinished = true;
    });
    const listening = once(downstream, 'listening');
    downstream.listen(0, '127.0.0.1');
    await listening;
    const address = downstream.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The downstream server has no local port');
    }

    const controller = new AbortController();
    try {
      const incoming = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        body: 'A synthetic prompt',
        signal: controller.signal,
      });
      // Leave the actual HTTP response unread while the provider sends 16 MiB.
      await vi.waitFor(() => expect(outgoing?.writableNeedDrain).toBe(true));
      await setTimeout(100);
      expect(routeFinished).toBe(false);
      expect(outgoing?.writableNeedDrain).toBe(true);
      expect(outgoing?.writableLength).toBeLessThan(largeContentChunk.length * 2);
      expect(incoming.status).toBe(200);

      if (mode === 'resume') {
        expect(await incoming.text()).toBe(largeContentChunk.repeat(largeContentChunkCount));
      } else if (mode === 'upstream failure') {
        await expect(incoming.text()).rejects.toThrow();
      } else {
        controller.abort();
      }
      await vi.waitFor(() => expect(routeFinished).toBe(true));
      expect(client.transport).toHaveBeenCalledOnce();
      expect(client.upstreamClosed).toHaveLength(1);
      await client.upstreamClosed[0];

      if (mode === 'upstream failure') {
        expect(client.runtime.consoleError).toHaveBeenCalledOnce();
        expect(String(client.runtime.consoleError.mock.calls[0]?.[0])).toContain(
          'intentional upstream failure after backpressure',
        );
        expect(outgoing?.destroyed).toBe(true);
      } else {
        expect(client.runtime.consoleError).not.toHaveBeenCalled();
        expect(client.signal?.aborted).toBe(mode === 'disconnect');
      }
      expect(outgoing?.writableEnded).toBe(mode === 'resume');
      expect(incomingRequest?.listenerCount('aborted')).toBe(0);
      expect(outgoing?.listenerCount('drain')).toBe(0);
      expect(outgoing?.listenerCount('error')).toBe(0);
      expect(outgoing?.listenerCount('close')).toBe(0);
    } finally {
      controller.abort();
      await closePublicExample(downstream);
      await closePublicExample(client.upstream);
    }
  },
);

test.each([
  ['stream-to-client-express.ts', 'response close'],
  ['stream-to-client-express.ts', 'request abort'],
  ['stream-to-client-raw.ts', 'response close'],
  ['stream-to-client-raw.ts', 'request abort'],
] as const)(
  'the public SDK aborts %s through the real loopback transport after %s',
  async (filename, event) => {
    const client = await loadPublicExample(filename);
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
      await closePublicExample(client.upstream);
    }
  },
);

test.each(examples)(
  'the public SDK completes %s through the real SSE loopback transport',
  async (filename) => {
    const client = await loadPublicExample(filename, 'complete');
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
      await closePublicExample(client.upstream);
    }
  },
);

test.each(examples)('the public SDK still reports genuine upstream failures from %s', async (filename) => {
  const client = await loadPublicExample(filename, 'failure');
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
    await closePublicExample(client.upstream);
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
    const client = await loadPublicExample(filename, mode);
    let outgoing: ServerResponse | undefined;
    let routeFinished = false;
    const downstream = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
      }
      outgoing = response;
      const adaptedResponse = Object.assign(response, {
        header(name: string, value: string) {
          response.setHeader(name, value);
          return response;
        },
        status(code: number) {
          response.statusCode = code;
          return response;
        },
      });
      await invoke(client.runtime, Object.assign(request, { body }), adaptedResponse);
      routeFinished = true;
    });
    const listening = once(downstream, 'listening');
    downstream.listen(0, '127.0.0.1');
    await listening;
    const address = downstream.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The downstream server has no local port');
    }

    const controller = new AbortController();
    let receivedStatus: number | undefined;
    const result = (async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
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
      await vi.waitFor(() => expect(routeFinished).toBe(true));
      expect(client.runtime.consoleError).toHaveBeenCalledOnce();
      if (mode === 'failure') {
        expect(outgoing?.writableEnded).toBe(true);
        expect(await result).toEqual({ status: 500, body: 'Internal Server Error' });
      } else {
        expect(outgoing?.destroyed).toBe(true);
        expect(outgoing?.writableEnded).toBe(false);
        expect(await result).toHaveProperty('error');
      }
    } finally {
      controller.abort();
      await result;
      await closePublicExample(downstream);
      await closePublicExample(client.upstream);
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
