import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import { ChatCompletionRunner } from 'openai/lib/ChatCompletionRunner';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

describe.each(['runTools', 'streaming runTools', 'stream'] as const)('%s initial history', (mode) => {
  describe.each(['tool_calls', 'function_call'] as const)('%s', (callType) => {
    it.each([false, true])(
      'preserves an assistant message with omitted content (frozen: %s)',
      async (frozen) => {
        const assistant: ChatCompletionAssistantMessageParam =
          callType === 'tool_calls'
            ? {
                role: 'assistant',
                tool_calls: [
                  { id: 'call_initial', type: 'function', function: { name: 'lookup', arguments: '{}' } },
                ],
              }
            : { role: 'assistant', function_call: { name: 'lookup', arguments: '{}' } };
        const messages: ChatCompletionMessageParam[] = [
          assistant,
          callType === 'tool_calls'
            ? { role: 'tool', tool_call_id: 'call_initial', content: 'Found it' }
            : { role: 'function', name: 'lookup', content: 'Found it' },
          { role: 'user', content: 'Summarize the result' },
        ];
        const original = structuredClone(messages);
        if (frozen) {
          Object.freeze(assistant);
        }

        const requests: unknown[] = [];
        const fetch = vi.fn<Fetch>(async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new TypeError('Expected a serialized chat completion request');
          }
          requests.push(JSON.parse(init.body));
          const completion = {
            id: 'chatcmpl-history',
            created: 1,
            model: 'gpt-test',
          };
          if (mode === 'runTools') {
            return Response.json({
              ...completion,
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Done', refusal: null },
                  finish_reason: 'stop',
                  logprobs: null,
                },
              ],
            });
          }
          const chunk = {
            ...completion,
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Done' },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
          };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        });
        const client = new OpenAI({ apiKey: 'synthetic-key', fetch, maxRetries: 0 });
        const params = { model: 'gpt-test', messages, tools: [] };
        const startRunner = {
          runTools: () => client.chat.completions.runTools(params),
          'streaming runTools': () => client.chat.completions.runTools({ ...params, stream: true }),
          stream: () => client.chat.completions.stream(params),
        };
        const runner = startRunner[mode]();

        await expect(runner.finalContent()).resolves.toBe('Done');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(requests).toEqual([expect.objectContaining({ messages: original })]);
        expect(messages).toEqual(original);
        expect(assistant).not.toHaveProperty('content');
        expect(runner.messages[0]).toBe(assistant);
        expect(runner.messages).toHaveLength(messages.length + 1);
      },
    );
  });
});

it('still normalizes omitted content in newly emitted messages', async () => {
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    fetch: async () =>
      Response.json({
        id: 'chatcmpl-function',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', function_call: { name: 'lookup', arguments: '{}' }, refusal: null },
            finish_reason: 'function_call',
            logprobs: null,
          },
        ],
      }),
  });
  const runner = client.chat.completions.runTools({
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Look it up' }],
    tools: [],
  });
  const onMessage = vi.fn();
  runner.on('message', onMessage);

  await expect(runner.finalContent()).resolves.toBeNull();
  expect(onMessage).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', content: null }));
  expect(runner.messages[1]).toHaveProperty('content', null);
});

it.each([false, true])('preserves two-argument message-hook normalization (emit: %s)', (emit) => {
  class CustomRunner extends ChatCompletionRunner {
    override _addMessage(message: ChatCompletionMessageParam, emitMessage = true) {
      super._addMessage(message, emitMessage);
    }

    append(message: ChatCompletionMessageParam) {
      this._addMessage(message, emit);
    }
  }
  const runner = new CustomRunner();
  const message: ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    function_call: { name: 'lookup', arguments: '{}' },
  };
  const onMessage = vi.fn();
  runner.on('message', onMessage);

  runner.append(message);

  expect(message).toHaveProperty('content', null);
  expect(runner.messages[0]).toBe(message);
  expect(onMessage).toHaveBeenCalledTimes(emit ? 1 : 0);
});
