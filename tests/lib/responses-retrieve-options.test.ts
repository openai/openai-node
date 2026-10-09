import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { vi } from 'vitest';

describe('Responses retrieval request options', () => {
  test('preserves non-stream query options and headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 'resp_test', object: 'response', output: [] }),
    );
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    const response = await client.responses.retrieve('resp_test', {
      headers: { 'X-Test': 'legacy-options' },
      query: { starting_after: 0, include_obfuscation: false, stream: undefined },
    });

    expect(response.id).toBe('resp_test');
    expect(response.output_text).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams).toEqual(
      new URLSearchParams({ starting_after: '0', include_obfuscation: 'false' }),
    );
    expect(new Headers(init?.headers).get('X-Test')).toBe('legacy-options');
  });

  test('streams when stream is supplied in the query argument', async () => {
    const event = { type: 'response.output_text.delta', delta: 'hello' };
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    const stream = await client.responses.retrieve('resp_test', { stream: true }, { timeout: 1000 });

    expect(stream).toBeInstanceOf(Stream);
    const events = [];
    for await (const item of stream) {
      events.push(item);
    }
    expect(events).toEqual([event]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('stream')).toBe('true');
  });

  test('rejects mixed literal stream and legacy options before dispatch', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    expect(() =>
      // @ts-expect-error Query parameters and request options require separate arguments.
      client.responses.retrieve('resp_test', { stream: false, headers: { 'X-Test': 'mixed' } }),
    ).toThrow(/separate arguments/u);
    expect(fetch).not.toHaveBeenCalled();
  });
});
