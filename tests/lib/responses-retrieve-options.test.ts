import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { vi } from 'vitest';

describe('Responses retrieval request options', () => {
  test.each([true, false, 'true'])('rejects nested stream=%s before dispatch', (stream) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    expect(() => client.responses.retrieve('resp_test', { query: { stream } })).toThrow(
      'Pass stream in the query argument, not in options.query.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

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

  test('validates and sends one snapshot of nested query values', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: 'resp_test' }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    let streamReads = 0;
    const query = {
      starting_after: 0,
      get stream() {
        streamReads += 1;
        return streamReads === 1 ? undefined : true;
      },
    };

    const pending = client.responses.retrieve('resp_test', { query });
    query.starting_after = 1;
    await pending;

    expect(streamReads).toBe(1);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).search).toBe('?starting_after=0');
  });
});
