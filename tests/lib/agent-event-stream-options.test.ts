import { expect, test, vi } from 'vitest';
import OpenAI, { APIUserAbortError } from 'openai';
import type { RequestOptions } from 'openai/internal/request-options';

async function expectEmpty(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  expect(events).toEqual([]);
}

test('event streams preserve fetchOptions in the legacy options argument', async () => {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe('https://example.com/v1/agents/sessions/session_test/events');
    expect(request.cache).toBe('no-store');
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    baseURL: 'https://example.com/v1',
    fetch,
    maxRetries: 0,
  });
  const options: RequestOptions = { fetchOptions: { cache: 'no-store' } };
  const stream = await client.beta.agents.sessions.events.stream('session_test', options);
  await expectEmpty(stream);
  expect(fetch).toHaveBeenCalledTimes(1);
});

for (const explicitOptions of [undefined, { fetchOptions: { cache: 'no-store' as const } }]) {
  test(`event streams accept explicit query and options: ${JSON.stringify(explicitOptions)}`, async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        'https://example.com/v1/agents/sessions/session_test/events?include_obfuscation=false',
      );
      expect(request.cache).toBe(explicitOptions ? 'no-store' : 'default');
      return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      baseURL: 'https://example.com/v1',
      fetch,
      maxRetries: 0,
    });
    const stream = await client.beta.agents.sessions.events.stream(
      'session_test',
      { include_obfuscation: false },
      explicitOptions,
    );
    await expectEmpty(stream);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
}

test('event streams preserve legacy destination, headers, signal, and query overrides', async () => {
  const headers = { 'x-synthetic': 'retained' };
  const controller = new AbortController();
  const options: RequestOptions = Object.freeze({
    path: '/agents/sessions/override/events',
    defaultBaseURL: 'https://override.example/v1',
    query: { trace: 'retained' },
    headers,
    signal: controller.signal,
    fetchOptions: { cache: 'no-store' as const },
  });
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe('https://override.example/v1/agents/sessions/override/events?trace=retained');
    expect(request.headers.get('x-synthetic')).toBe('retained');
    expect(request.cache).toBe('no-store');
    expect(request.signal.aborted).toBe(false);
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const client = new OpenAI({ apiKey: 'synthetic-key', fetch, maxRetries: 0 });
  const stream = await client.beta.agents.sessions.events.stream('session_test', options);
  await expectEmpty(stream);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(options.headers).toBe(headers);
  expect(options.signal).toBe(controller.signal);
});

test('event streams preserve cancellation in the legacy options argument', async () => {
  const fetch = vi.fn(async () => new Response());
  const client = new OpenAI({ apiKey: 'synthetic-key', fetch, maxRetries: 0 });
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.beta.agents.sessions.events.stream('session_test', { signal: controller.signal }),
  ).rejects.toBeInstanceOf(APIUserAbortError);
  expect(fetch).not.toHaveBeenCalled();
});
