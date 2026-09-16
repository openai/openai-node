import OpenAI from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { ChatCompletionStreamingRunner } from 'openai/resources/chat/completions';
import type { ChatCompletionChunk, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';
import { vi } from 'vitest';

const messagePrefix = 'chat.completion.chunk.message:';

function completion(
  id: string,
  toolCalls?: ChatCompletionChunk.Choice.Delta.ToolCall[],
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: toolCalls ? null : 'finished',
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
  };
}

function clientWithCompletions(completions: ChatCompletionChunk[]) {
  const bodies = completions.map((chunk) => `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  let requestIndex = 0;
  const fetch = vi.fn(async () => {
    const body = bodies[requestIndex];
    requestIndex += 1;
    expect(body).toBeDefined();
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  return { client: new OpenAI({ apiKey: 'test-key', fetch }), fetch, bodies };
}

function toolMessages(wire: string) {
  return wire
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ChatCompletionChunk)
    .filter((chunk) => chunk.object.startsWith(messagePrefix))
    .map(
      (chunk) =>
        JSON.parse(chunk.object.slice(messagePrefix.length)) as {
          message: ChatCompletionToolMessageParam;
          tool_call_ids?: string[];
        },
    );
}

describe('streaming tool result serialization', () => {
  it.each([32, 64])('keeps %i tool results proportional to their input', async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `call_${index}_${'x'.repeat(1024)}`);
    const chunk = completion(
      'completion-1',
      ids.map((id, index) => ({
        index,
        id,
        type: 'function',
        function: { name: 'unregistered_tool', arguments: '{}' },
      })),
    );
    const { client, bodies } = clientWithCompletions([chunk]);
    const lookup = vi.fn(() => 'tool result');
    const runner = client.chat.completions.runTools(
      {
        model: 'gpt-4o',
        messages: [],
        stream: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              function: lookup,
              description: 'Returns a synthetic result.',
              parameters: {},
            },
          },
        ],
      },
      { maxChatCompletions: 1 },
    );
    const [, wire] = await Promise.all([runner.done(), new Response(runner.toReadableStream()).text()]);
    const messages = toolMessages(wire);

    expect(lookup).not.toHaveBeenCalled();
    expect(messages.map(({ message }) => message.tool_call_id)).toEqual(ids);
    expect(messages.filter((message) => message.tool_call_ids !== undefined)).toHaveLength(1);
    expect(messages[0]?.tool_call_ids).toEqual(ids);
    expect(Buffer.byteLength(wire)).toBeLessThan(Buffer.byteLength(bodies.join('')) * 4);

    const replay = ChatCompletionStreamingRunner.fromReadableStream(
      ReadableStreamFrom([new TextEncoder().encode(wire)]),
    );
    await replay.done();
    expect(replay.messages).toEqual(runner.messages);
  });

  it('restores generated tool IDs across multiple completion turns', async () => {
    const toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] = Array.from({ length: 3 }, (_, index) => ({
      index,
      id: '',
      type: 'function',
      function: { name: 'lookup', arguments: '{}' },
    }));
    const { client, fetch } = clientWithCompletions([
      completion('completion-1', toolCalls),
      completion('completion-2', toolCalls),
      completion('completion-3'),
    ]);
    const lookup = vi.fn(() => 'tool result');
    const runner = client.chat.completions.runTools({
      model: 'gpt-4o',
      messages: [],
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            function: lookup,
            description: 'Returns a synthetic result.',
            parameters: {},
          },
        },
      ],
    });
    const [, wire] = await Promise.all([runner.done(), new Response(runner.toReadableStream()).text()]);
    const replay = ChatCompletionStreamingRunner.fromReadableStream(
      ReadableStreamFrom([new TextEncoder().encode(wire)]),
    );
    await replay.done();

    const ids = runner.messages.flatMap((message) =>
      message.role === 'assistant' ? (message.tool_calls?.map((call) => call.id) ?? []) : [],
    );
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) {
      expect(id).toMatch(/^call_/u);
    }
    expect(toolMessages(wire).flatMap((message) => message.tool_call_ids ?? [])).toEqual(ids);
    expect(toolMessages(wire).map(({ message }) => message.tool_call_id)).toEqual(ids);
    expect(replay.messages).toEqual(runner.messages);
    await expect(replay.finalContent()).resolves.toBe('finished');
    expect(lookup).toHaveBeenCalledTimes(6);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
