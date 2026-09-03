import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { APIUserAbortError } from 'openai';
import handler from '../../examples/chat-completions/stream-to-client-next';

const token = 'synthetic-auth-token-0123456789abcdef';
const encoder = new TextEncoder();
const content = {
  id: 'chatcmpl-example',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'gpt-test',
  choices: [{ index: 0, delta: { role: 'assistant', content: 'safe response' }, finish_reason: null }],
};
const finished = {
  ...content,
  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
};

function request(signal: AbortSignal): Request {
  return new Request('https://example.test/api/chat', {
    method: 'POST',
    body: 'A synthetic prompt',
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
}

function completeResponse(): Response {
  return new Response(
    `data: ${JSON.stringify(content)}\n\ndata: ${JSON.stringify(finished)}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function readOutcome(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  try {
    return await reader.read();
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-test-key');
  vi.stubEnv('OPENAI_BASE_URL', 'https://example.test/v1');
  vi.stubEnv('OPENAI_EXAMPLE_AUTH_TOKEN', token);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Next Edge streaming example cancellation through the public SDK', () => {
  test('does not start an upstream request when the caller is already aborted', async () => {
    const transport = vi.fn<typeof fetch>(async () => completeResponse());
    vi.stubGlobal('fetch', transport);
    const caller = new AbortController();
    caller.abort();

    const response = await handler(request(caller.signal));

    await expect(response.text()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(transport).not.toHaveBeenCalled();
  });

  test('cancels an upstream request that has not returned response headers', async () => {
    let upstreamSignal: AbortSignal | null | undefined;
    const transport = vi.fn<typeof fetch>(async (_input, options) => {
      upstreamSignal = options?.signal;
      if (!upstreamSignal) {
        throw new Error('Expected an upstream abort signal');
      }
      const signal = upstreamSignal;
      // oxlint-disable-next-line promise/avoid-new -- Model a pending fetch that rejects when its signal aborts.
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', transport);
    const caller = new AbortController();
    const input = request(caller.signal);
    const response = await handler(input);
    if (!response.body) {
      throw new Error('The example did not return a response body');
    }
    const reader = response.body.getReader();
    const pending = readOutcome(reader);

    try {
      await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
      caller.abort(new Error('caller disconnected'));

      await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
      expect(await pending).toBeInstanceOf(APIUserAbortError);
      expect(transport).toHaveBeenCalledOnce();
      expect(getEventListeners(input.signal, 'abort')).toHaveLength(0);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });

  test('cancels the upstream body after streaming has begun', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(content)}\n\n`));
      },
      cancel,
    });
    let upstreamSignal: AbortSignal | null | undefined;
    const transport = vi.fn<typeof fetch>(async (_input, options) => {
      upstreamSignal = options?.signal;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', transport);
    const caller = new AbortController();
    const input = request(caller.signal);
    const response = await handler(input);
    if (!response.body) {
      throw new Error('The example did not return a response body');
    }
    const reader = response.body.getReader();

    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(`${JSON.stringify(content)}\n`);
      const pending = readOutcome(reader);
      caller.abort();

      await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
      expect(await pending).toBeInstanceOf(APIUserAbortError);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(transport).toHaveBeenCalledOnce();
      expect(getEventListeners(input.signal, 'abort')).toHaveLength(0);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });

  test('preserves a completed response and removes the incoming abort listener', async () => {
    let upstreamSignal: AbortSignal | null | undefined;
    const transport = vi.fn<typeof fetch>(async (input, options) => {
      expect(String(input)).toBe('https://example.test/v1/chat/completions');
      expect(JSON.parse(String(options?.body))).toEqual({
        model: 'gpt-3.5-turbo',
        stream: true,
        messages: [{ role: 'user', content: 'A synthetic prompt' }],
      });
      upstreamSignal = options?.signal;
      return completeResponse();
    });
    vi.stubGlobal('fetch', transport);
    const caller = new AbortController();
    const input = request(caller.signal);
    const response = await handler(input);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`${JSON.stringify(content)}\n${JSON.stringify(finished)}\n`);
    expect(transport).toHaveBeenCalledOnce();
    expect(upstreamSignal?.aborted).toBe(false);
    expect(getEventListeners(input.signal, 'abort')).toHaveLength(0);

    caller.abort();
    expect(upstreamSignal?.aborted).toBe(false);
  });
});
