import { timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';

import OpenAI, { APIUserAbortError } from '../../src/index';

const examples = ['stream-to-client-express.ts', 'stream-to-client-raw.ts'] as const;

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
    writableEnded: false,
    onWrite: null as (() => void) | null,
  });

  return Object.assign(response, {
    header: vi.fn((_name: string, _value: string) => response),

    write: vi.fn((chunk: unknown) => {
      if (response.destroyed) {
        throw new Error('Attempted to write to a destroyed socket');
      }

      response.body += String(chunk);
      response.onWrite?.();
      return true;
    }),

    end: vi.fn(() => {
      if (response.destroyed) {
        throw new Error('Attempted to end a destroyed socket');
      }

      response.writableEnded = true;
      response.emit('finish');
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

async function loadPublicExample(filename: Example, mode: 'pending' | 'complete' | 'failure' = 'pending') {
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

    if (mode === 'complete') {
      const base = {
        id: 'chatcmpl-public-loopback',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
      };
      const content = {
        ...base,
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'safe public chunk' }, finish_reason: null },
        ],
      };
      const finished = {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      response.end(
        `data: ${JSON.stringify(content)}\n\ndata: ${JSON.stringify(finished)}\n\ndata: [DONE]\n\n`,
      );
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
    expect(response.end).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  } finally {
    await closePublicExample(client.upstream);
  }
});

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
