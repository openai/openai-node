import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import handler, * as nextEdgeExample from '../../examples/chat-completions/stream-to-client-next';

const openai = vi.hoisted(() => {
  const toReadableStream = vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"content":"safe"}\n'));
          controller.close();
        },
      }),
  );

  const createStream = vi.fn(() => ({ toReadableStream }));
  class MockOpenAI {
    readonly chat = { completions: { stream: createStream } };
  }

  const constructor = vi.fn(MockOpenAI);

  return { constructor, createStream, toReadableStream };
});

vi.mock('openai', () => ({ default: openai.constructor }));

const token = '0123456789abcdef0123456789abcdef';
const trustedOrigin = 'https://sdk.example.com';
const maximumPromptBytes = 64 * 1024;

interface RequestOptions {
  method?: string;
  token?: string | null;
  origin?: string;
  fetchSite?: string;
  body?: string | ReadableStream<Uint8Array>;
  headers?: RequestInit['headers'];
  url?: string;
}

function request(options: RequestOptions = {}): Request {
  const method = options.method ?? 'POST';
  const headers = new Headers(options.headers);

  if (options.token !== null) {
    headers.set('authorization', `Bearer ${options.token ?? token}`);
  }
  if (options.origin !== undefined) {
    headers.set('origin', options.origin);
  }
  if (options.fetchSite !== undefined) {
    headers.set('sec-fetch-site', options.fetchSite);
  }

  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = options.body ?? 'Tell me why dogs are better than cats';
    if (init.body instanceof ReadableStream) {
      Object.assign(init, { duplex: 'half' });
    }
  }

  return new Request(options.url ?? `${trustedOrigin}/api/chat`, init);
}

function invoke(input: Request): Promise<Response> {
  type EdgeHandler = (
    request: Request,
    response: { send: (stream: ReadableStream<Uint8Array>) => Response },
  ) => Promise<Response>;

  return (handler as unknown as EdgeHandler)(input, {
    send: (stream) => new Response(stream),
  });
}

async function expectRejected(input: Request, status: number): Promise<Response> {
  const response = await invoke(input);
  expect(response.status).toBe(status);
  expect(openai.constructor).not.toHaveBeenCalled();
  expect(openai.createStream).not.toHaveBeenCalled();
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_EXAMPLE_AUTH_TOKEN', token);
  vi.stubEnv('OPENAI_EXAMPLE_ALLOWED_ORIGIN', trustedOrigin);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Next Edge streaming example request boundaries', () => {
  test('registers the default Pages Router handler with its Edge runtime configuration', () => {
    expect(nextEdgeExample.config).toEqual({ runtime: 'edge' });
    expect(nextEdgeExample).not.toHaveProperty('runtime');
  });

  test('keeps the dedicated bearer secret out of browser-facing documentation', () => {
    const exampleSource = readFileSync('examples/chat-completions/stream-to-client-next.ts', 'utf-8');

    expect(exampleSource).not.toContain('applicationAuthToken');
    expect(exampleSource).not.toMatch(/fetch\([^]*Authorization:/u);
    expect(exampleSource).toContain('session-authenticated server');
    expect(exampleSource).toContain('server-side');
    expect(exampleSource).toContain('$OPENAI_EXAMPLE_AUTH_TOKEN');
  });

  test.each(['GET', 'HEAD', 'PUT', 'DELETE'])(
    'rejects %s before constructing a billed client',
    async (method) => {
      const response = await expectRejected(request({ method }), 405);
      expect(response.headers.get('allow')).toBe('POST');
    },
  );

  test('fails closed when its dedicated authorization secret is missing', async () => {
    Reflect.deleteProperty(process.env, 'OPENAI_EXAMPLE_AUTH_TOKEN');
    await expectRejected(request(), 503);
  });

  test.each(['', 'too-short', token.slice(0, 31)])(
    'fails closed when its configured authorization secret is too short',
    async (configuredToken) => {
      vi.stubEnv('OPENAI_EXAMPLE_AUTH_TOKEN', configuredToken);
      await expectRejected(request({ token: configuredToken }), 503);
    },
  );

  test('rejects requests that omit the dedicated bearer token', async () => {
    await expectRejected(request({ token: null }), 401);
  });

  test.each([
    token.slice(0, -1),
    `${token}x`,
    `${token.slice(0, -1)}x`,
    'incorrect-example-authorization-secret',
  ])('rejects an invalid bearer credential', async (providedToken) => {
    await expectRejected(request({ token: providedToken }), 401);
  });

  test('rejects non-bearer authorization schemes', async () => {
    await expectRejected(
      request({ token: null, headers: { authorization: 'Basic not-a-bearer-token' } }),
      401,
    );
  });

  test('rejects cross-site browser metadata even with a valid bearer token', async () => {
    await expectRejected(request({ fetchSite: 'cross-site' }), 403);
  });

  test('rejects an untrusted browser origin even with a valid bearer token', async () => {
    await expectRejected(request({ origin: 'https://attacker.example.com' }), 403);
  });

  test('rejects attacker-controlled Host and request URL as origin authorities', async () => {
    await expectRejected(
      request({
        origin: 'https://attacker.example.com',
        headers: { host: 'attacker.example.com' },
        url: 'https://attacker.example.com/api/chat',
      }),
      403,
    );
  });

  test('fails closed for browser origins without an explicit trusted-origin configuration', async () => {
    Reflect.deleteProperty(process.env, 'OPENAI_EXAMPLE_ALLOWED_ORIGIN');
    await expectRejected(request({ origin: trustedOrigin }), 403);
  });

  test('rejects an oversized advertised body before reading it or constructing a client', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const getReader = vi.spyOn(body, 'getReader');

    await expectRejected(
      request({
        body,
        headers: { 'content-length': String(maximumPromptBytes + 1) },
      }),
      413,
    );

    expect(getReader).not.toHaveBeenCalled();
  });

  test('rejects an invalid advertised body length before constructing a client', async () => {
    await expectRejected(request({ headers: { 'content-length': 'not-a-number' } }), 400);
  });

  test('bounds the actual streamed body and cancels it before constructing a client', async () => {
    const cancel = vi.fn();
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(maximumPromptBytes / 2));
        if (produced === 4) {
          controller.close();
        }
      },
      cancel,
    });

    await expectRejected(request({ body, headers: { 'content-length': '1' } }), 413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('counts UTF-8 bytes rather than UTF-16 characters when enforcing the body limit', async () => {
    await expectRejected(request({ body: `${'🐕'.repeat(maximumPromptBytes / 4)}x` }), 413);
  });

  test('accepts an authenticated command-line request with no browser-origin headers', async () => {
    const response = await invoke(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"content":"safe"}\n');
    expect(openai.constructor).toHaveBeenCalledOnce();
    expect(openai.createStream).toHaveBeenCalledWith({
      model: 'gpt-3.5-turbo',
      stream: true,
      messages: [{ role: 'user', content: 'Tell me why dogs are better than cats' }],
    });
  });

  test('accepts an authenticated browser request from the configured trusted origin', async () => {
    const response = await invoke(request({ origin: trustedOrigin, fetchSite: 'same-origin' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"content":"safe"}\n');
    expect(openai.constructor).toHaveBeenCalledOnce();
  });

  test('preserves an authenticated body at exactly the 64 KiB UTF-8 boundary', async () => {
    const body = '🐕'.repeat(maximumPromptBytes / 4);
    const response = await invoke(request({ body }));

    expect(response.status).toBe(200);
    expect(openai.createStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: body }],
      }),
    );
  });
});
