import { NextRequest } from 'next/server';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import handler from '../src/pages/api/vercel-ai-streaming';

jest.mock('ai', () => ({
  createUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));

const apiKey = process.env.OPENAI_API_KEY;
const adminKey = process.env.OPENAI_ADMIN_KEY;
const maximumRequestBodyBytes = 64 * 1024;
const streamingBodyHeaderCases: { name: string; headers: Record<string, string> }[] = [
  { name: 'a missing Content-Length', headers: {} },
  { name: 'a spoofed smaller Content-Length', headers: { 'content-length': '8' } },
  { name: 'chunked transfer encoding', headers: { 'transfer-encoding': 'chunked' } },
];

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_ADMIN_KEY;
});

afterAll(() => {
  if (apiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = apiKey;
  }
  if (adminKey === undefined) {
    delete process.env.OPENAI_ADMIN_KEY;
  } else {
    process.env.OPENAI_ADMIN_KEY = adminKey;
  }
});

function requestWithMessages(messages: unknown): NextRequest {
  return new NextRequest('https://example.com/api/vercel-ai-streaming', {
    method: 'POST',
    body: JSON.stringify({ messages }),
    headers: { 'content-type': 'application/json' },
  });
}

function requestWithBodyChunks(
  chunks: string[],
  headers: Record<string, string> = {},
  cancel = jest.fn(),
): { request: NextRequest; cancel: jest.Mock } {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }

      index += 1;
      controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel,
  });

  return {
    request: new NextRequest('https://example.com/api/vercel-ai-streaming', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    }),
    cancel,
  };
}

it.each(streamingBodyHeaderCases)('rejects an oversized streamed body with $name', async ({ headers }) => {
  const body = JSON.stringify({ messages: null, padding: 'a'.repeat(maximumRequestBodyBytes) });
  const { request, cancel } = requestWithBodyChunks(
    [body.slice(0, maximumRequestBodyBytes / 2), body.slice(maximumRequestBodyBytes / 2), ' '],
    headers,
  );

  const response = await handler(request);

  expect(response.status).toBe(413);
  expect(await response.text()).toBe('Payload Too Large');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

it('does not let stream cancellation failures mask the oversized-body response', async () => {
  const cancel = jest.fn().mockRejectedValue(new Error('stream cancellation failed'));
  const body = JSON.stringify({ messages: null, padding: 'a'.repeat(maximumRequestBodyBytes) });
  const { request } = requestWithBodyChunks([body, ' '], {}, cancel);

  const response = await handler(request);

  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

it('enforces UTF-8 byte size instead of JavaScript character count', async () => {
  const body = JSON.stringify({ messages: null, padding: '🙂'.repeat(maximumRequestBodyBytes / 4) });
  const { request, cancel } = requestWithBodyChunks([body, ' '], { 'content-length': '8' });

  const response = await handler(request);

  expect(body.length).toBeLessThan(maximumRequestBodyBytes);
  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('accepts a streamed body exactly at the 64 KiB boundary', async () => {
  const prefix = '{"messages":null,"padding":"';
  const suffix = '"}';
  const body = prefix + 'a'.repeat(maximumRequestBodyBytes - prefix.length - suffix.length) + suffix;
  const { request, cancel } = requestWithBodyChunks([body.slice(0, 17), body.slice(17)]);

  const response = await handler(request);

  expect(response.status).toBe(400);
  expect(await response.text()).toBe('Invalid messages');
  expect(cancel).not.toHaveBeenCalled();
  expect(request.body?.locked).toBe(false);
});

it('preserves valid message streaming after consuming the body once', async () => {
  process.env.OPENAI_API_KEY = 'safe-synthetic-key';
  const expected = new Response('stream response');
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
  jest.mocked(createUIMessageStream).mockReturnValue(new ReadableStream());
  jest.mocked(createUIMessageStreamResponse).mockReturnValue(expected);
  const request = requestWithMessages([
    { id: 'message', role: 'user', parts: [{ type: 'text', text: 'safe message' }] },
  ]);

  try {
    expect(await handler(request)).toBe(expected);
    expect(request.bodyUsed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

it('rejects invalid messages before initializing an OpenAI client', async () => {
  const response = await handler(requestWithMessages(null));

  expect(response.status).toBe(400);
  expect(await response.text()).toBe('Invalid messages');
});

it('rejects too many messages before initializing an OpenAI client', async () => {
  const message = { id: 'message', role: 'user', parts: [{ type: 'text', text: 'test' }] };
  const response = await handler(requestWithMessages(Array.from({ length: 33 }, () => message)));

  expect(response.status).toBe(413);
  expect(await response.text()).toBe('Too many messages');
});

it('rejects oversized text before initializing an OpenAI client', async () => {
  const message = {
    id: 'message',
    role: 'user',
    parts: [{ type: 'text', text: 'a'.repeat(16_385) }],
  };
  const response = await handler(requestWithMessages([message]));

  expect(response.status).toBe(413);
  expect(await response.text()).toBe('Messages are too large');
});
