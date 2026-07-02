import OpenAI from 'openai';
import { AssistantStream } from 'openai/lib/AssistantStream';

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
});
