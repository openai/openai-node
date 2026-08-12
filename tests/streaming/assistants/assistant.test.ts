import OpenAI from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';
import { Stream } from 'openai/streaming';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('assistant tests', () => {
  test('delta accumulation', () => {
    expect(AssistantStream.accumulateDelta({}, {})).toEqual({});
    expect(AssistantStream.accumulateDelta({}, { a: 'apple' })).toEqual({ a: 'apple' });

    // strings
    expect(AssistantStream.accumulateDelta({ a: 'foo' }, { a: ' bar' })).toEqual({ a: 'foo bar' });

    // dictionaries
    expect(AssistantStream.accumulateDelta({ a: { foo: '1' } }, { a: { bar: '2' } })).toEqual({
      a: {
        foo: '1',
        bar: '2',
      },
    });
    expect(AssistantStream.accumulateDelta({ a: { foo: 'hello,' } }, { a: { foo: ' world' } })).toEqual({
      a: { foo: 'hello, world' },
    });

    expect(AssistantStream.accumulateDelta({}, { a: null })).toEqual({ a: null });
    expect(AssistantStream.accumulateDelta({ a: null }, { a: 'apple' })).toEqual({ a: 'apple' });
    expect(AssistantStream.accumulateDelta({ a: null }, { a: null })).toEqual({ a: null });
  });

  test('array delta accumulation uses the entry index', () => {
    const acc: any = {
      tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'f0', arguments: '{' } }],
    };
    AssistantStream.accumulateDelta(acc, {
      tool_calls: [{ index: 2, id: 'call_2', type: 'function', function: { name: 'f2', arguments: '{' } }],
    });
    AssistantStream.accumulateDelta(acc, {
      tool_calls: [{ index: 2, function: { arguments: '"x":1}' } }],
    });
    const atIndex2 = acc.tool_calls.filter((t: any) => t.index === 2);
    expect(atIndex2).toHaveLength(1);
    expect(atIndex2[0].function.arguments).toBe('{"x":1}');
  });

  test('toReadableStream preserves queued message deltas', async () => {
    const encoder = new TextEncoder();
    const events = [
      {
        event: 'thread.message.created',
        data: {
          id: 'msg_1',
          content: [],
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_1',
          delta: {
            content: [{ index: 0, type: 'text', text: { value: 'E', annotations: [] } }],
          },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_1',
          delta: {
            content: [{ index: 0, type: 'text', text: { value: 'ddy' } }],
          },
        },
      },
      {
        event: 'thread.run.completed',
        data: { id: 'run_1' },
      },
    ];
    const input = ReadableStreamFrom(events.map((event) => encoder.encode(JSON.stringify(event) + '\n')));
    const assistantStream = AssistantStream.fromReadableStream(input);
    const readable = assistantStream.toReadableStream();

    await assistantStream.done();

    const output = Stream.fromReadableStream<any>(readable, new AbortController());
    const deltas: string[] = [];
    for await (const event of output) {
      if (event.event === 'thread.message.delta') {
        deltas.push(event.data.delta.content[0].text.value);
      }
    }

    expect(deltas).toEqual(['E', 'ddy']);
  });
});
