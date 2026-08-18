import { NextRequest } from 'next/server';
import handler from '../src/pages/api/vercel-ai-streaming';

jest.mock('ai', () => ({
  createUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));

const apiKey = process.env.OPENAI_API_KEY;
const adminKey = process.env.OPENAI_ADMIN_KEY;

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
