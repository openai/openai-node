import { timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { vi } from 'vitest';

import OpenAI, { APIUserAbortError } from '../../src/index';

export const examples = ['stream-to-client-express.ts', 'stream-to-client-raw.ts'] as const;

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

export function createRequest() {
  return Object.assign(createNodeHTTPEmitter(), {
    body: 'Tell me why dogs are better than cats',
    get: vi.fn(),
  });
}

export function createResponse() {
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
            const pending = (async () => {
              await once(deferred.signal, 'abort');
              throw failure ?? new APIUserAbortError();
            })();

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

export function loadExample(
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
            const pending = (async () => {
              await once(deferred.signal, 'abort');
              throw failure ?? new APIUserAbortError();
            })();

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

export function invoke(runtime: ExampleRuntime, request: unknown, response: unknown): Promise<void> {
  if (!runtime.handler) {
    throw new Error('The streaming example did not register its Express route');
  }

  return runtime.handler(request, response);
}

interface UpstreamOptions {
  pendingHeaders?: boolean;
  httpError?: string;
  content?: string;
  contentCount?: number;
  // Omit the terminal event to keep the SSE connection open.
  terminalEvent?: 'done' | { error: { message: string } };
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The streaming example loopback server has no local port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  const closed = once(server, 'close');
  server.closeAllConnections();
  server.close();
  await closed;
}

export async function loadPublicExample(filename: Example, options: UpstreamOptions) {
  const upstreamClosed: Promise<unknown[]>[] = [];
  const upstream = createServer((_request, response) => {
    upstreamClosed.push(once(response, 'close'));

    if (options.httpError !== undefined) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: options.httpError } }));
      return;
    }
    if (options.pendingHeaders) {
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.flushHeaders();
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
          delta: { role: 'assistant', content: options.content ?? 'safe public chunk' },
          finish_reason: null,
        },
      ],
    };
    const contentEvents = `data: ${JSON.stringify(content)}\n\n`.repeat(options.contentCount ?? 0);
    if (options.terminalEvent === undefined) {
      if (contentEvents) {
        response.write(contentEvents);
      }
      return;
    }

    const finished = {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    const endEvent =
      options.terminalEvent === 'done'
        ? `data: ${JSON.stringify(finished)}\n\ndata: [DONE]\n\n`
        : `data: ${JSON.stringify(options.terminalEvent)}\n\n`;
    response.end(contentEvents + endEvent);
  });

  const baseURL = `${await listen(upstream)}/v1`;
  let signal: AbortSignal | undefined;
  let body: ReadableStream<Uint8Array> | null | undefined;
  const transport = vi.fn<typeof fetch>(async (request, requestOptions) => {
    signal = requestOptions?.signal ?? undefined;
    const response = await fetch(request, requestOptions);
    ({ body } = response);
    return response;
  });

  const PublicOpenAI = OpenAI.bind(undefined, {
    apiKey: 'public-sdk-loopback-test-key',
    baseURL,
    fetch: transport,
    maxRetries: 0,
  });

  let runtime: ExampleRuntime;
  try {
    runtime = loadExample(filename, { client: PublicOpenAI });
  } catch (error) {
    await closeServer(upstream);
    throw error;
  }

  return {
    runtime,
    transport,
    upstream,
    upstreamClosed,
    close: () => closeServer(upstream),
    get signal() {
      return signal;
    },
    get body() {
      return body;
    },
  };
}

export async function loadPublicHTTPExample(filename: Example, options: UpstreamOptions) {
  const client = await loadPublicExample(filename, options);
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
  const controller = new AbortController();
  let url: string;
  try {
    url = await listen(downstream);
  } catch (error) {
    await client.close();
    throw error;
  }

  return {
    client,
    url,
    controller,
    get incomingRequest() {
      return incomingRequest;
    },
    get outgoing() {
      return outgoing;
    },
    get routeFinished() {
      return routeFinished;
    },
    async close() {
      controller.abort();
      try {
        await closeServer(downstream);
      } finally {
        await client.close();
      }
    },
  };
}
