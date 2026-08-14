import { vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import { hasOwn } from 'openai/internal/utils/values';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import { Stream } from 'openai/streaming';

function firstChoice(chunk: OpenAI.Chat.ChatCompletionChunk): OpenAI.Chat.ChatCompletionChunk.Choice {
  const [choice] = chunk.choices;
  if (!choice) {
    throw new Error('Expected a chat completion choice');
  }

  return choice;
}

describe('ChatCompletionStream prototype safety', () => {
  type PrototypeSnapshot = ChatCompletionSnapshot | OpenAI.Chat.ChatCompletion;
  interface PrototypeCase {
    name: string;
    inject: (
      chunk: OpenAI.Chat.ChatCompletionChunk,
      properties: Record<string, unknown>,
    ) => OpenAI.Chat.ChatCompletionChunk;
    target: (snapshot: PrototypeSnapshot) => object | undefined;
  }

  const prototypeCases: PrototypeCase[] = [
    {
      name: 'completion snapshot',
      inject: (chunk, properties) => ({ ...chunk, ...properties }),
      target: (snapshot) => snapshot,
    },
    {
      name: 'choice',
      inject: (chunk, properties) => ({
        ...chunk,
        choices: [{ ...firstChoice(chunk), ...properties }],
      }),
      target: (snapshot) => snapshot.choices[0],
    },
    {
      name: 'choice logprobs',
      inject: (chunk, properties) => ({
        ...chunk,
        choices: [{ ...firstChoice(chunk), logprobs: { content: [], refusal: [], ...properties } }],
      }),
      target: (snapshot) => snapshot.choices[0]?.logprobs ?? undefined,
    },
    {
      name: 'message delta',
      inject: (chunk, properties) => ({
        ...chunk,
        choices: [{ ...firstChoice(chunk), delta: { ...properties } }],
      }),
      target: (snapshot) => snapshot.choices[0]?.message,
    },
    {
      name: 'tool-call delta',
      inject: (chunk, properties) => ({
        ...chunk,
        choices: [{ ...firstChoice(chunk), delta: { tool_calls: [{ index: 0, ...properties }] } }],
      }),
      target: (snapshot) => snapshot.choices[0]?.message.tool_calls?.[0],
    },
  ];

  it.each(prototypeCases)(
    'preserves $name metadata without changing its prototype',
    async ({ inject, target }) => {
      const first: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chatcmpl-prototype',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: { content: [], refusal: [] },
            delta: {
              role: 'assistant',
              content: 'legitimate content',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_legitimate',
                  type: 'function',
                  function: { name: 'ordinary_tool', arguments: '{}' },
                },
              ],
            },
          },
        ],
      };
      const second: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chatcmpl-prototype',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
        choices: [{ index: 0, finish_reason: 'stop', logprobs: null, delta: {} }],
      };
      const properties = JSON.parse(
        '{"__proto__":{"forged_metadata":"inherited"},"provider_metadata":"preserved"}',
      ) as Record<string, unknown>;
      expect(hasOwn(properties, '__proto__')).toBe(true);

      const readable = new Stream(async function* chunks() {
        yield first;
        yield inject(second, properties);
      }, new AbortController()).toReadableStream();
      const stream = ChatCompletionStream.fromReadableStream(readable);
      let snapshotTarget: object | undefined;
      stream.on('chunk', (_chunk, snapshot) => {
        snapshotTarget = target(snapshot);
      });

      const completion = await stream.finalChatCompletion();

      if (!snapshotTarget) {
        throw new Error('Expected an accumulated snapshot target');
      }

      expect(Object.getPrototypeOf(snapshotTarget)).toBe(Object.prototype);
      expect(snapshotTarget).not.toHaveProperty('forged_metadata');
      expect(snapshotTarget).toHaveProperty('provider_metadata', 'preserved');
      expect(hasOwn(snapshotTarget, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(snapshotTarget, '__proto__')).toEqual({
        value: { forged_metadata: 'inherited' },
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const finalTarget = target(completion);
      if (!finalTarget) {
        throw new Error('Expected a finalized snapshot target');
      }

      expect(Object.getPrototypeOf(finalTarget)).toBe(Object.prototype);
      expect(finalTarget).not.toHaveProperty('forged_metadata');
      expect(finalTarget).toHaveProperty('provider_metadata', 'preserved');
    },
  );

  it('preserves enumerable symbols and ordinary constructor and prototype metadata', async () => {
    const providerMetadata = Symbol('provider metadata');
    const delta = JSON.parse(
      '{"role":"assistant","content":"legitimate content","constructor":"provider-constructor","prototype":"provider-prototype"}',
    ) as OpenAI.Chat.ChatCompletionChunk.Choice.Delta;
    Object.defineProperty(delta, providerMetadata, { value: 'symbol metadata', enumerable: true });

    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-provider-metadata',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [{ index: 0, delta, finish_reason: 'stop', logprobs: null }],
    };
    const originalParse = JSON.parse;
    const parse = vi.spyOn(JSON, 'parse');

    try {
      parse.mockImplementationOnce((serialized) => {
        const decoded: OpenAI.Chat.ChatCompletionChunk = originalParse(serialized);
        // JSON transport cannot preserve symbols, so restore provider metadata after real decoding.
        Object.defineProperty(firstChoice(decoded).delta, providerMetadata, {
          value: Reflect.get(delta, providerMetadata),
          enumerable: true,
        });
        return decoded;
      });

      const readable = new Stream(async function* chunks() {
        yield chunk;
      }, new AbortController()).toReadableStream();
      const stream = ChatCompletionStream.fromReadableStream(readable);
      let message: ChatCompletionSnapshot.Choice.Message | undefined;
      stream.on('chunk', (_chunk, snapshot) => {
        message = snapshot.choices[0]?.message;
      });

      await expect(stream.finalContent()).resolves.toBe('legitimate content');

      if (!message) {
        throw new Error('Expected an accumulated message');
      }

      expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
      expect(Reflect.get(message, providerMetadata)).toBe('symbol metadata');
      expect(message).toHaveProperty('constructor', 'provider-constructor');
      expect(message).toHaveProperty('prototype', 'provider-prototype');
    } finally {
      parse.mockRestore();
    }
  });

  it('does not accept assistant role or content inherited from a message delta', async () => {
    const delta = JSON.parse(
      '{"__proto__":{"role":"assistant","content":"forged assistant content"},"provider_metadata":"preserved"}',
    ) as OpenAI.Chat.ChatCompletionChunk.Choice.Delta;
    expect(hasOwn(delta, 'role')).toBe(false);
    expect(hasOwn(delta, 'content')).toBe(false);

    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-forged-content',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [{ index: 0, delta, finish_reason: 'stop', logprobs: null }],
    };
    const readable = new Stream(async function* chunks() {
      yield chunk;
    }, new AbortController()).toReadableStream();
    const stream = ChatCompletionStream.fromReadableStream(readable);
    let message: ChatCompletionSnapshot.Choice.Message | undefined;
    stream.on('chunk', (_chunk, snapshot) => {
      message = snapshot.choices[0]?.message;
    });

    await expect(stream.finalContent()).rejects.toThrow('missing role for choice 0');

    if (!message) {
      throw new Error('Expected an accumulated message');
    }

    expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
    expect(hasOwn(message, 'role')).toBe(false);
    expect(hasOwn(message, 'content')).toBe(false);
    expect(message).toHaveProperty('provider_metadata', 'preserved');
  });

  it('rejects function metadata inherited from a tool-call delta', async () => {
    const toolDelta = JSON.parse(
      '{"index":0,"__proto__":{"type":"function","id":"call_spoofed","function":{"name":"sensitive_tool","arguments":"{}"}},"provider_metadata":"preserved"}',
    ) as OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall;
    for (const key of ['type', 'id', 'function']) {
      expect(hasOwn(toolDelta, key)).toBe(false);
    }

    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-forged-tool',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          delta: { role: 'assistant', tool_calls: [toolDelta] },
        },
      ],
    };
    const readable = new Stream(async function* chunks() {
      yield chunk;
    }, new AbortController()).toReadableStream();
    const stream = ChatCompletionStream.fromReadableStream(readable);
    const argumentDelta = vi.fn();
    let tool: ChatCompletionSnapshot.Choice.Message.ToolCall | undefined;
    stream.on('tool_calls.function.arguments.delta', argumentDelta);
    stream.on('chunk', (_chunk, snapshot) => {
      tool = snapshot.choices[0]?.message.tool_calls?.[0];
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow('missing choices[0].tool_calls[0].type');

    expect(argumentDelta).not.toHaveBeenCalled();
    if (!tool) {
      throw new Error('Expected an accumulated tool call');
    }

    expect(Object.getPrototypeOf(tool)).toBe(Object.prototype);
    for (const key of ['type', 'id', 'function']) {
      expect(hasOwn(tool, key)).toBe(false);
    }
    expect(tool).toHaveProperty('provider_metadata', 'preserved');
  });

  it('never runs tools inherited from a message delta without tool-call events', async () => {
    const delta = JSON.parse(
      '{"__proto__":{"role":"assistant","tool_calls":[{"type":"function","id":"bypass_no_tool_delta","function":{"name":"sensitive_tool","arguments":"{}"}}]}}',
    ) as OpenAI.Chat.ChatCompletionChunk.Choice.Delta;
    expect(hasOwn(delta, '__proto__')).toBe(true);
    expect(hasOwn(delta, 'role')).toBe(false);
    expect(hasOwn(delta, 'tool_calls')).toBe(false);

    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-message-prototype-bypass',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [{ index: 0, delta, finish_reason: 'tool_calls', logprobs: null }],
    };
    const fetch = vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const client = new OpenAI({ apiKey: 'test', fetch });
    const sensitiveTool = vi.fn(() => 'executed');
    const runner = client.chat.completions.runTools(
      {
        model: 'gpt-test',
        stream: true,
        messages: [{ role: 'user', content: 'Do not run a tool' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'sensitive_tool',
              description: 'A tool that must never be called from inherited metadata.',
              function: sensitiveTool,
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
      { maxChatCompletions: 1 },
    );
    const argumentDelta = vi.fn();
    const argumentDone = vi.fn();
    let message: ChatCompletionSnapshot.Choice.Message | undefined;
    runner.on('chunk', (raw, snapshot) => {
      const rawDelta = raw.choices[0]?.delta;
      if (!rawDelta) {
        throw new Error('Expected a raw message delta');
      }

      expect(hasOwn(rawDelta, 'role')).toBe(false);
      expect(hasOwn(rawDelta, 'tool_calls')).toBe(false);
      message = snapshot.choices[0]?.message;
    });
    runner.on('tool_calls.function.arguments.delta', argumentDelta);
    runner.on('tool_calls.function.arguments.done', argumentDone);

    const completionError = await runner.done().then(
      () => null,
      (error: unknown) => error,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(argumentDelta).not.toHaveBeenCalled();
    expect(argumentDone).not.toHaveBeenCalled();
    expect(sensitiveTool).not.toHaveBeenCalled();
    expect(completionError).toBeInstanceOf(OpenAIError);
    expect((completionError as Error).message).toBe('missing role for choice 0');
    if (!message) {
      throw new Error('Expected an accumulated message');
    }

    expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
    expect(hasOwn(message, 'role')).toBe(false);
    expect(hasOwn(message, 'tool_calls')).toBe(false);
  });
});
