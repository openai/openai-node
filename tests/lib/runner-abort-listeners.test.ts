import { getEventListeners } from 'node:events';
import { vi } from 'vitest';
import OpenAI from 'openai';
import { APIConnectionError, APIUserAbortError } from 'openai/error';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

describe.each([false, true])('runTools abort subscriptions (stream=%s)', (streaming) => {
  test.each(['success', 'error', 'abort'] as const)(
    'reuses the caller subscription across turns and cleans up after %s',
    async (outcome) => {
      const caller = new AbortController();
      const unrelated = vi.fn();
      caller.signal.addEventListener('abort', unrelated);
      const add = vi.spyOn(caller.signal, 'addEventListener');
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const listenerCounts: number[] = [];
      let requests = 0;
      const client = new OpenAI({
        apiKey: 'synthetic-api-key',
        baseURL: 'https://example.invalid/v1',
        maxRetries: 0,
        fetch: async () => {
          requests += 1;
          listenerCounts.push(getEventListeners(caller.signal, 'abort').length);
          if (outcome === 'error' && requests === 12) {
            throw new Error('synthetic fetch failure');
          }
          const call = {
            id: `call_${requests}`,
            type: 'function',
            function: { name: 'readValue', arguments: '{}' },
          };
          const completion = {
            id: `completion_${requests}`,
            object: streaming ? 'chat.completion.chunk' : 'chat.completion',
            created: 1,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                logprobs: null,
                [streaming ? 'delta' : 'message']: {
                  role: 'assistant',
                  content: null,
                  refusal: null,
                  tool_calls: [streaming ? { ...call, index: 0 } : call],
                },
              },
            ],
          };
          return streaming
            ? new Response(`data: ${JSON.stringify(completion)}\n\ndata: [DONE]\n\n`, {
                headers: { 'Content-Type': 'text/event-stream' },
              })
            : Response.json(completion);
        },
      });
      const tool = vi.fn(() => {
        if (outcome === 'abort' && requests === 12) {
          caller.abort();
        }
        return 'synthetic tool result';
      });
      const params = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user' as const, content: 'Read a value' }],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'readValue',
              description: 'Returns a synthetic value',
              parameters: { type: 'object' },
              function: tool,
            },
          },
        ],
      };
      const options = { signal: caller.signal, maxChatCompletions: 12 };
      const runner = streaming
        ? client.chat.completions.runTools({ ...params, stream: true }, options)
        : client.chat.completions.runTools({ ...params, stream: false }, options);
      const abort = vi.spyOn(runner.controller, 'abort');

      await (outcome === 'success'
        ? expect(runner.done()).resolves.toBeUndefined()
        : expect(runner.done()).rejects.toBeInstanceOf(
            outcome === 'error' ? APIConnectionError : APIUserAbortError,
          ));

      expect(requests).toBe(12);
      expect(tool).toHaveBeenCalledTimes(outcome === 'error' ? 11 : 12);
      expect(listenerCounts).toEqual(Array.from({ length: 12 }, () => 2));
      expect(add).toHaveBeenCalledTimes(1);
      const listener = add.mock.calls[0]?.[1];
      expect(add).toHaveBeenCalledWith('abort', listener, { once: true });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('abort', listener);
      expect(getEventListeners(caller.signal, 'abort')).toEqual([unrelated]);
      expect(abort).toHaveBeenCalledTimes(outcome === 'abort' ? 1 : 0);
      expect(runner.aborted).toBe(outcome === 'abort');

      abort.mockClear();
      caller.abort();
      expect(abort).not.toHaveBeenCalled();
      expect(unrelated).toHaveBeenCalledTimes(1);
      caller.signal.removeEventListener('abort', unrelated);
    },
  );
});

class TestStream extends EventStream<BaseEvents> {
  observe(signal: AbortSignal) {
    this._listenForAbort(signal);
  }

  end() {
    this._emit('end');
  }
}

test('keeps distinct abort sources and immediately observes an already-aborted source', () => {
  const stream = new TestStream();
  const first = new AbortController();
  const second = new AbortController();
  for (const signal of [first.signal, second.signal, first.signal, second.signal]) {
    stream.observe(signal);
  }
  expect(getEventListeners(first.signal, 'abort')).toHaveLength(1);
  expect(getEventListeners(second.signal, 'abort')).toHaveLength(1);

  const reason = new Error('second source aborted');
  second.abort(reason);
  expect(stream.controller.signal.aborted).toBe(true);
  expect(stream.controller.signal.reason).toBe(reason);
  stream.controller = new AbortController();
  stream.observe(second.signal);
  expect(stream.controller.signal.aborted).toBe(true);
  expect(stream.controller.signal.reason).toBe(reason);

  stream.end();
  expect(getEventListeners(first.signal, 'abort')).toHaveLength(0);
  expect(getEventListeners(second.signal, 'abort')).toHaveLength(0);
});
