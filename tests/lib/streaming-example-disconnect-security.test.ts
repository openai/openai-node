import { timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';

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
  handler?: RouteHandler;
  signal?: AbortSignal;
  onProvider?: () => void;
  pendingCreate: boolean;
  resolveCreate?: (stream: AsyncIterable<Completion>) => void;
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

function loadExample(filename: Example, options: { withoutAbortController?: boolean } = {}): ExampleRuntime {
  const runtime: ExampleRuntime = {
    apiCalls: 0,
    aborts: 0,
    generated: 0,
    cancellations: 0,
    pendingCreate: false,
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
            const pending = once(deferred.signal, 'abort').then(() => chunks);
            runtime.resolveCreate = () => deferred.abort();
            runtime.signal?.addEventListener('abort', () => deferred.abort(), { once: true });
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
      return { __esModule: true, default: MockOpenAI };
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
    console: { error: vi.fn(), log: vi.fn() },
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

test('the raw example aborts a provider request while create is still pending', async () => {
  const runtime = loadExample('stream-to-client-raw.ts');
  runtime.pendingCreate = true;
  const request = createRequest();
  const response = createResponse();

  const pending = invoke(runtime, request, response);
  expect(runtime.resolveCreate).toBeDefined();

  response.destroyed = true;
  response.emit('close');
  runtime.resolveCreate?.(completionChunks(runtime, false) as AsyncIterable<Completion>);
  await pending;

  expect(runtime.signal?.aborted).toBe(true);
  expect(runtime.aborts).toBe(1);
  expect(runtime.generated).toBe(0);
  expect(response.header).not.toHaveBeenCalled();
  expect(response.write).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
  expect(request.listenerCount('aborted')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});
