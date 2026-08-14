import { vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStreamingRunner';
import { makeParseableResponseFormat } from 'openai/lib/parser';
import type { ChatCompletionTokenLogprob } from 'openai/resources';
import { Stream } from 'openai/streaming';
import { z } from 'zod/v4';
import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';
import { expectType } from '../utils/typing';

function mockStreamingClient(chunks: OpenAI.Chat.ChatCompletionChunk[]): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          controller: new AbortController(),
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        })),
      },
    },
  } as unknown as OpenAI;
}

function contentChunks(...contents: string[]): OpenAI.Chat.ChatCompletionChunk[] {
  return contents.map((content, index) => ({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        delta: index === 0 ? { role: 'assistant', content } : { content },
        finish_reason: index === contents.length - 1 ? 'stop' : null,
        logprobs: null,
      },
    ],
  }));
}

function customToolChunk(
  delta: OpenAI.Chat.ChatCompletionChunk.Choice.Delta,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'] = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chatcmpl-custom-tools',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-5.5',
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  };
}

function customToolChunks(): OpenAI.Chat.ChatCompletionChunk[] {
  return [
    customToolChunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call_custom_123',
          type: 'custom',
          custom: { name: 'code_exec', input: '' },
        },
      ],
    }),
    customToolChunk({ tool_calls: [{ index: 0, custom: { input: 'print("hel' } }] }),
    customToolChunk({ tool_calls: [{ index: 0, custom: { input: 'lo")\nreturn 42' } }] }),
    customToolChunk({
      tool_calls: [
        {
          index: 1,
          id: 'call_function_456',
          type: 'function',
          function: { name: 'get_weather', arguments: '' },
        },
      ],
    }),
    customToolChunk({ tool_calls: [{ index: 1, function: { arguments: '{"city":' } }] }),
    customToolChunk({ tool_calls: [{ index: 1, function: { arguments: '"SF"}' } }] }),
    customToolChunk({}, 'tool_calls'),
  ];
}

describe('.stream()', () => {
  it('emits finalization failures as errors', async () => {
    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          delta: { role: 'user', content: 'hello' },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    };

    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            controller: new AbortController(),
            async *[Symbol.asyncIterator]() {
              yield chunk;
            },
          })),
        },
      },
    } as unknown as OpenAI;

    const stream = ChatCompletionStream.createChatCompletion(client, {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    const errors: Error[] = [];
    stream.on('error', (error) => errors.push(error));

    await expect(stream.done()).rejects.toThrow(
      'stream ended without producing a ChatCompletionMessage with role=assistant',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe(
      'stream ended without producing a ChatCompletionMessage with role=assistant',
    );
  });

  it('removes the caller abort listener after the stream finishes', async () => {
    const callerController = new AbortController();
    const addEventListenerSpy = vi.spyOn(callerController.signal, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(callerController.signal, 'removeEventListener');

    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'hello' },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    };

    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            controller: new AbortController(),
            async *[Symbol.asyncIterator]() {
              yield chunk;
            },
          })),
        },
      },
    } as unknown as OpenAI;

    const stream = ChatCompletionStream.createChatCompletion(
      client,
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Say hello' }],
      },
      { signal: callerController.signal },
    );

    await expect(stream.finalContent()).resolves.toBe('hello');

    const abortListener = addEventListenerSpy.mock.calls.find(([event]) => event === 'abort')?.[1];
    expect(abortListener).toEqual(expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('abort', abortListener, { once: true });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', abortListener);
  });

  it('handles Azure async filter chunks without deltas', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'hello' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-test',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      },
      {
        id: '',
        object: '',
        created: 0,
        model: '',
        choices: [
          {
            index: 0,
            finish_reason: null,
            content_filter_results: {},
          },
        ],
      } as unknown as OpenAI.Chat.ChatCompletionChunk,
    ];
    const readable = new Stream(async function* readable() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStreamingRunner.fromReadableStream(readable);

    await expect(stream.finalChatCompletion()).resolves.toMatchObject({
      id: 'chatcmpl-test',
      created: 1,
      model: 'gpt-test',
      choices: [{ message: { content: 'hello' } }],
    });
  });

  it('finalizes audio streams that end with an expires_at-only chunk', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: { audio: { transcript: 'hel' } },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: null,
              refusal: null,
              audio: { id: 'audio-test', data: 'abc' },
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: { audio: { transcript: 'lo', data: 'def' } },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: { audio: { expires_at: 2 } },
          },
        ],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    const readable = new Stream(async function* readable() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStreamingRunner.fromReadableStream(readable);

    await expect(stream.finalChatCompletion()).resolves.toMatchObject({
      id: 'chatcmpl-test',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            audio: {
              id: 'audio-test',
              data: 'abcdef',
              transcript: 'hello',
              expires_at: 2,
            },
          },
        },
      ],
    });
  });

  it('does not infer a finish_reason if audio continues after expires_at', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              audio: {
                id: 'audio-test',
                data: 'abc',
                transcript: 'hello',
              },
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: { audio: { expires_at: 2 } },
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4o-audio-preview',
        choices: [
          {
            index: 0,
            delta: { audio: { data: 'def' } },
            finish_reason: null,
          },
        ],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    const readable = new Stream(async function* readable() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStreamingRunner.fromReadableStream(readable);

    await expect(stream.finalChatCompletion()).rejects.toThrow('missing finish_reason for choice 0');
  });

  it('still rejects non-audio streams without a finish_reason', async () => {
    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'hello' },
          finish_reason: null,
          logprobs: null,
        },
      ],
    };
    const readable = new Stream(async function* readable() {
      yield chunk;
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStreamingRunner.fromReadableStream(readable);

    await expect(stream.finalChatCompletion()).rejects.toThrow('missing finish_reason for choice 0');
  });

  it('works', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.chat.completions.stream({
        model: 'gpt-4o-2024-08-06',
        messages: [
          {
            role: 'user',
            content: "What's the weather like in SF?",
          },
        ],
        response_format: zodResponseFormat(
          z.object({
            city: z.string(),
            units: z.enum(['c', 'f']).default('f'),
          }),
          'location',
        ),
      }),
    );

    const completion = await stream.finalChatCompletion();
    expect(completion.choices[0]).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": null,
        "message": {
          "content": "{"city":"San Francisco","units":"c"}",
          "parsed": {
            "city": "San Francisco",
            "units": "c",
          },
          "refusal": null,
          "role": "assistant",
        },
      }
    `);
  });

  it('is robust against leading newline chunks', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.chat.completions.stream({
        model: 'gpt-4o-2024-08-06',
        messages: [
          {
            role: 'user',
            content: "What's the weather like in SF?",
          },
        ],
        response_format: zodResponseFormat(
          z.object({
            city: z.string(),
            units: z.enum(['c', 'f']).default('f'),
          }),
          'location',
        ),
      }),
    );

    const completion = await stream.finalChatCompletion();
    expect(completion.choices[0]).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": null,
        "message": {
          "content": "

      {"city":"San Francisco","units":"c"}",
          "parsed": {
            "city": "San Francisco",
            "units": "c",
          },
          "refusal": null,
          "role": "assistant",
        },
      }
    `);
  });

  it('emits content logprobs events', async () => {
    let capturedLogProbs: ChatCompletionTokenLogprob[] | undefined;

    const request = await makeStreamSnapshotRequest((openai) =>
      openai.chat.completions.stream({
        model: 'gpt-4o-2024-08-06',
        messages: [
          {
            role: 'user',
            content: "What's the weather like in SF?",
          },
        ],
        logprobs: true,
        response_format: zodResponseFormat(
          z.object({
            city: z.string(),
            units: z.enum(['c', 'f']).default('f'),
          }),
          'location',
        ),
      }),
    );
    const stream = request.on('logprobs.content.done', (props) => {
      if (!capturedLogProbs?.length) {
        capturedLogProbs = props.content;
      }
    });

    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    expect(choice).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": {
          "content": [
            {
              "bytes": [
                123,
                34,
              ],
              "logprob": -0.0036115935,
              "token": "{"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                99,
                105,
                116,
                121,
              ],
              "logprob": -0.000008418666,
              "token": "city",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                58,
                34,
              ],
              "logprob": -0.00034666734,
              "token": "":"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                83,
                97,
                110,
              ],
              "logprob": -0.013863761,
              "token": "San",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                70,
                114,
                97,
                110,
                99,
                105,
                115,
                99,
                111,
              ],
              "logprob": -0.00003190179,
              "token": " Francisco",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                44,
                34,
              ],
              "logprob": -0.03384693,
              "token": "","",
              "top_logprobs": [],
            },
            {
              "bytes": [
                117,
                110,
                105,
                116,
                115,
              ],
              "logprob": -0.0000012664457,
              "token": "units",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                58,
                34,
              ],
              "logprob": -0.000031305768,
              "token": "":"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                102,
              ],
              "logprob": -0.5759394,
              "token": "f",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                125,
              ],
              "logprob": -0.0000420341,
              "token": ""}",
              "top_logprobs": [],
            },
          ],
          "refusal": null,
        },
        "message": {
          "content": "{"city":"San Francisco","units":"f"}",
          "parsed": {
            "city": "San Francisco",
            "units": "f",
          },
          "refusal": null,
          "role": "assistant",
        },
      }
    `);
    expect(capturedLogProbs?.length).toEqual(choice?.logprobs?.content?.length);
  });

  it('emits refusal logprobs events', async () => {
    let capturedLogProbs: ChatCompletionTokenLogprob[] | undefined;

    const request = await makeStreamSnapshotRequest((openai) =>
      openai.chat.completions.stream({
        model: 'gpt-4o-2024-08-06',
        messages: [
          {
            role: 'user',
            content: 'a bad question',
          },
        ],
        logprobs: true,
        response_format: zodResponseFormat(
          z.object({
            city: z.string(),
            units: z.enum(['c', 'f']).default('f'),
          }),
          'location',
        ),
      }),
    );
    const stream = request.on('logprobs.refusal.done', (props) => {
      if (!capturedLogProbs?.length) {
        capturedLogProbs = props.refusal;
      }
    });

    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    expect(choice).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": {
          "content": null,
          "refusal": [
            {
              "bytes": [
                73,
                39,
                109,
              ],
              "logprob": -0.0020705638,
              "token": "I'm",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                118,
                101,
                114,
                121,
              ],
              "logprob": -0.60976714,
              "token": " very",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                115,
                111,
                114,
                114,
                121,
              ],
              "logprob": -0.000008180258,
              "token": " sorry",
              "top_logprobs": [],
            },
            {
              "bytes": [
                44,
              ],
              "logprob": -0.000040603656,
              "token": ",",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                98,
                117,
                116,
              ],
              "logprob": -0.048603047,
              "token": " but",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                73,
              ],
              "logprob": -0.003929745,
              "token": " I",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                99,
                97,
                110,
                39,
                116,
              ],
              "logprob": -0.012669391,
              "token": " can't",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                97,
                115,
                115,
                105,
                115,
                116,
              ],
              "logprob": -0.0036209812,
              "token": " assist",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                119,
                105,
                116,
                104,
              ],
              "logprob": -0.0052407524,
              "token": " with",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                116,
                104,
                97,
                116,
              ],
              "logprob": -0.0029618926,
              "token": " that",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                114,
                101,
                113,
                117,
                101,
                115,
                116,
              ],
              "logprob": -1.7024335,
              "token": " request",
              "top_logprobs": [],
            },
            {
              "bytes": [
                46,
              ],
              "logprob": -0.0000026968896,
              "token": ".",
              "top_logprobs": [],
            },
          ],
        },
        "message": {
          "content": null,
          "parsed": null,
          "refusal": "I'm very sorry, but I can't assist with that request.",
          "role": "assistant",
        },
      }
    `);
    expect(capturedLogProbs?.length).toEqual(choice?.logprobs?.refusal?.length);
  });

  it('surfaces a mid-stream error when chunks are buffered before consumption', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    // Yield valid chunks, then throw to error the stream after they have been
    // delivered (mimics a connection drop mid-response).
    const readable = new Stream(async function* failingChunks() {
      for (const chunk of chunks) {
        yield chunk;
      }
      throw new Error('network boom');
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStream.fromReadableStream(readable);
    // Grab the iterator (registering its listeners) but do not consume yet, so
    // the valid chunks and the error land while no reader is waiting: they
    // buffer in the iterator's internal queue instead of rejecting a pending
    // reader.
    const iterator = stream[Symbol.asyncIterator]();
    // Wait for the stream's terminal signal so the chunks and the error have
    // definitely been emitted before we start reading.
    await stream.done().catch(() => {});

    const collected: OpenAI.Chat.ChatCompletionChunk[] = [];
    let caught: unknown = null;
    try {
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
        collected.push(chunk);
      }
    } catch (error) {
      caught = error;
    }

    expect(collected).toHaveLength(chunks.length);
    expect(caught).toBeInstanceOf(OpenAIError);
    expect((caught as OpenAIError).message).toBe('network boom');
  });

  it('rejects a pending read exactly once when the stream errors while a reader is waiting', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    const readable = new Stream(async function* failingChunks() {
      for (const chunk of chunks) {
        yield chunk;
      }
      throw new Error('network boom');
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStream.fromReadableStream(readable);
    // Consume eagerly so each read is awaiting when its chunk (and finally the
    // error) arrives, exercising the pending-reader path rather than the
    // buffered path.
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const caught = await iterator.next().then(
      () => null,
      (error) => error,
    );
    expect(caught).toBeInstanceOf(OpenAIError);
    expect((caught as OpenAIError).message).toBe('network boom');
    // The failure is delivered exactly once; iteration then ends cleanly.
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('aborts the stream when the consumer breaks out of iteration', async () => {
    const readable = new Stream(
      async function* unfinishedChunks(): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
        yield {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' }, finish_reason: null }],
        } as unknown as OpenAI.Chat.ChatCompletionChunk;
        // Hang so the only way the consumer stops is by breaking out.
        await Promise.race([]);
      },
      new AbortController(),
    ).toReadableStream();

    const stream = ChatCompletionStream.fromReadableStream(readable);
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta.content === 'hel') {
        break;
      }
    }

    expect(stream.controller.signal.aborted).toBe(true);
  });

  it('returns done immediately when iterating after the stream has ended', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    const readable = new Stream(async function* completeChunks() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }, new AbortController()).toReadableStream();

    const stream = ChatCompletionStream.fromReadableStream(readable);
    await stream.done();

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('toReadableStream surfaces a mid-stream error when items are buffered before consumption', async () => {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }],
      },
    ] as unknown as OpenAI.Chat.ChatCompletionChunk[];
    const readable = new Stream(async function* failingChunks() {
      for (const chunk of chunks) {
        yield chunk;
      }
      throw new Error('network boom');
    }, new AbortController()).toReadableStream();

    const runner = ChatCompletionStreamingRunner.fromReadableStream(readable);
    // Bridge to a ReadableStream immediately (registering its listeners) but
    // do not read from it until the runner has already errored, so the chunks
    // and the error land while nothing is pulling: they buffer in the
    // adapter's internal queue instead of rejecting a pending reader.
    const proxied = Stream.fromReadableStream<OpenAI.Chat.ChatCompletionChunk>(
      runner.toReadableStream(),
      new AbortController(),
    );
    await runner.done().catch(() => {});

    const collected: OpenAI.Chat.ChatCompletionChunk[] = [];
    let caught: unknown = null;
    try {
      for await (const chunk of proxied) {
        collected.push(chunk);
      }
    } catch (error) {
      caught = error;
    }

    expect(collected).toHaveLength(chunks.length);
    expect(caught).toBeInstanceOf(OpenAIError);
    expect((caught as OpenAIError).message).toBe('network boom');
  });

  it('preserves the existing streamed function-call detail type', () => {
    const legacyFunction: ChatCompletionSnapshot.Choice.Message.ToolCall.Function = {
      name: 'get_weather',
      arguments: '{"city":"SF"}',
    };

    expectType<string>(legacyFunction.name);
    expectType<string>(legacyFunction.arguments);
    expect(legacyFunction).toEqual({ name: 'get_weather', arguments: '{"city":"SF"}' });
  });

  it('accumulates real custom-tool chunks alongside strict function-tool chunks', async () => {
    const customTool: OpenAI.Chat.ChatCompletionCustomTool = {
      type: 'custom',
      custom: { name: 'code_exec', description: 'Executes source code' },
    };
    const strictFunctionTool: OpenAI.Chat.ChatCompletionFunctionTool = {
      type: 'function',
      function: {
        name: 'get_weather',
        strict: true,
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      },
    };
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(customToolChunks()), {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Run some code and check the weather' }],
      tools: [customTool, strictFunctionTool],
    });

    const customInputDeltas: string[] = [];
    const customInputSnapshots: string[] = [];
    const functionArgumentDeltas: { index: number; arguments: string; arguments_delta: string }[] = [];
    const functionArgumentDone: {
      index: number;
      name: string;
      arguments: string;
      parsed_arguments: unknown;
    }[] = [];

    stream.on('chunk', (chunk, snapshot) => {
      for (const delta of chunk.choices[0]?.delta.tool_calls ?? []) {
        if (!delta.custom) {
          continue;
        }

        customInputDeltas.push(delta.custom.input ?? '');
        const toolCall = snapshot.choices[0]?.message.tool_calls?.[delta.index];
        if (toolCall?.type !== 'custom') {
          throw new Error('Expected a custom tool-call snapshot');
        }
        expectType<string>(toolCall.custom.input);
        customInputSnapshots.push(toolCall.custom.input);
      }
    });
    stream.on('tool_calls.function.arguments.delta', (event) =>
      functionArgumentDeltas.push({
        index: event.index,
        arguments: event.arguments,
        arguments_delta: event.arguments_delta,
      }),
    );
    stream.on('tool_calls.function.arguments.done', (event) => functionArgumentDone.push(event));

    const completion = await stream.finalChatCompletion();

    expect(customInputDeltas).toEqual(['', 'print("hel', 'lo")\nreturn 42']);
    expect(customInputSnapshots).toEqual(['', 'print("hel', 'print("hello")\nreturn 42']);
    expect(functionArgumentDeltas).toEqual([
      { index: 1, arguments: '', arguments_delta: '' },
      { index: 1, arguments: '{"city":', arguments_delta: '{"city":' },
      { index: 1, arguments: '{"city":"SF"}', arguments_delta: '"SF"}' },
    ]);
    expect(functionArgumentDone).toEqual([
      {
        index: 1,
        name: 'get_weather',
        arguments: '{"city":"SF"}',
        parsed_arguments: { city: 'SF' },
      },
    ]);
    expect(completion.choices[0]?.message.tool_calls).toEqual([
      {
        id: 'call_custom_123',
        type: 'custom',
        custom: { name: 'code_exec', input: 'print("hello")\nreturn 42' },
      },
      {
        id: 'call_function_456',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"SF"}',
          parsed_arguments: { city: 'SF' },
        },
      },
    ]);
  });

  it('preserves custom calls and unparsed function calls without auto-parseable tools', async () => {
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(customToolChunks()), {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Run some code and check the weather' }],
      tools: [
        { type: 'custom', custom: { name: 'code_exec' } },
        { type: 'function', function: { name: 'get_weather' } },
      ],
    });

    const completion = await stream.finalChatCompletion();
    const toolCalls = completion.choices[0]?.message.tool_calls;

    expect(toolCalls).toEqual([
      {
        id: 'call_custom_123',
        type: 'custom',
        custom: { name: 'code_exec', input: 'print("hello")\nreturn 42' },
      },
      {
        id: 'call_function_456',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' },
      },
    ]);
    expect(toolCalls?.[1]).not.toHaveProperty('function.parsed_arguments');
  });

  it('replays custom-tool headers and input fragments from a readable stream', async () => {
    const readable = new Stream(async function* replayChunks() {
      for (const chunk of customToolChunks()) {
        yield chunk;
      }
    }, new AbortController()).toReadableStream();
    const stream = ChatCompletionStream.fromReadableStream(readable);

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[0]?.message.tool_calls).toEqual([
      {
        id: 'call_custom_123',
        type: 'custom',
        custom: { name: 'code_exec', input: 'print("hello")\nreturn 42' },
      },
      {
        id: 'call_function_456',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' },
      },
    ]);
    expect(completion.choices[0]?.message.tool_calls?.[1]).not.toHaveProperty('function.parsed_arguments');
  });

  it('parses stream events for raw json_schema response formats', async () => {
    const stream = ChatCompletionStream.createChatCompletion(
      mockStreamingClient(contentChunks('{"city":', '"SF"}')),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: "What's the weather like in SF?" }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'location', schema: { type: 'object' } },
        },
      },
    );

    const deltaParsed: unknown[] = [];
    let doneParsed: unknown;
    stream.on('content.delta', (event) => deltaParsed.push(event.parsed));
    stream.on('content.done', (event) => (doneParsed = event.parsed));

    const completion = await stream.finalChatCompletion();

    // Partial events parse incrementally, and the final event agrees with the
    // finalized completion rather than reporting `null`.
    expect(deltaParsed).toEqual([{}, { city: 'SF' }]);
    expect(doneParsed).toEqual({ city: 'SF' });
    expect(completion.choices[0]?.message.parsed).toEqual({ city: 'SF' });
  });

  it('parses stream events for branded response formats', async () => {
    const stream = ChatCompletionStream.createChatCompletion(
      mockStreamingClient(contentChunks('{"city":', '"SF"}')),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: "What's the weather like in SF?" }],
        response_format: zodResponseFormat(z.object({ city: z.string() }), 'location'),
      },
    );

    const deltaParsed: unknown[] = [];
    let doneParsed: unknown;
    stream.on('content.delta', (event) => deltaParsed.push(event.parsed));
    stream.on('content.done', (event) => (doneParsed = event.parsed));

    const completion = await stream.finalChatCompletion();

    expect(deltaParsed).toEqual([{}, { city: 'SF' }]);
    expect(doneParsed).toEqual({ city: 'SF' });
    expect(completion.choices[0]?.message.parsed).toEqual({ city: 'SF' });
  });

  it('parses present empty assistant content when structured streaming finishes', async () => {
    const parseRaw = vi.fn((raw: string) => ({ raw }));
    const format = makeParseableResponseFormat(
      { type: 'json_schema', json_schema: { name: 'empty_content', schema: {} } },
      parseRaw,
    );
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(contentChunks('')), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Return empty content' }],
      response_format: format,
    });
    const contentEvents: unknown[] = [];
    const deltaEvents: unknown[] = [];
    const doneEvents: unknown[] = [];
    stream.on('content', (...event) => contentEvents.push(event));
    stream.on('content.delta', (event) => deltaEvents.push(event));
    stream.on('content.done', (event) => doneEvents.push(event));

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[0]?.message).toMatchObject({ content: '', parsed: { raw: '' } });
    expect(contentEvents).toEqual([]);
    expect(deltaEvents).toEqual([]);
    expect(doneEvents).toEqual([{ content: '', parsed: { raw: '' } }]);
    expect(parseRaw).toHaveBeenCalledTimes(2);
    expect(parseRaw).toHaveBeenNthCalledWith(1, '');
    expect(parseRaw).toHaveBeenNthCalledWith(2, '');
  });

  it.each([undefined, null] as const)(
    'does not emit content events when assistant content is %s',
    async (content) => {
      const [chunk] = contentChunks('');
      if (!chunk?.choices[0]) {
        throw new Error('Expected a completion choice');
      }
      chunk.choices[0].delta = content === undefined ? { role: 'assistant' } : { role: 'assistant', content };

      const parseRaw = vi.fn((raw: string) => ({ raw }));
      const format = makeParseableResponseFormat(
        { type: 'json_schema', json_schema: { name: 'absent_content', schema: {} } },
        parseRaw,
      );
      const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient([chunk]), {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Return no content' }],
        response_format: format,
      });
      const contentEvents: unknown[] = [];
      const deltaEvents: unknown[] = [];
      const doneEvents: unknown[] = [];
      stream.on('content', (...event) => contentEvents.push(event));
      stream.on('content.delta', (event) => deltaEvents.push(event));
      stream.on('content.done', (event) => doneEvents.push(event));

      const completion = await stream.finalChatCompletion();

      expect(completion.choices[0]?.message).toMatchObject({ content: null, parsed: null });
      expect(contentEvents).toEqual([]);
      expect(deltaEvents).toEqual([]);
      expect(doneEvents).toEqual([]);
      expect(parseRaw).not.toHaveBeenCalled();
    },
  );

  it('does not parse empty content preceding structured streamed tool calls', async () => {
    const chunks = [
      customToolChunk({ role: 'assistant', content: '' }),
      customToolChunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_function_123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"SF"}' },
          },
        ],
      }),
      customToolChunk({}, 'tool_calls'),
    ];
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(chunks), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Check the weather' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'location', schema: { type: 'object' } },
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            strict: true,
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
    });
    const doneEvents: unknown[] = [];
    stream.on('content.done', (event) => doneEvents.push(event));

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[0]?.message).toMatchObject({
      content: '',
      parsed: null,
      tool_calls: [{ type: 'function', function: { name: 'get_weather', parsed_arguments: { city: 'SF' } } }],
    });
    expect(doneEvents).toEqual([]);
  });

  it('keeps empty refusal content unparsed without emitting a content completion', async () => {
    const [chunk] = contentChunks('');
    if (!chunk?.choices[0]) {
      throw new Error('Expected a completion choice');
    }
    chunk.choices[0].delta.refusal = 'Request refused';

    const parseRaw = vi.fn((raw: string) => ({ raw }));
    const format = makeParseableResponseFormat(
      { type: 'json_schema', json_schema: { name: 'refused_content', schema: {} } },
      parseRaw,
    );
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient([chunk]), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Return refused content' }],
      response_format: format,
    });
    const doneEvents: unknown[] = [];
    const refusals: string[] = [];
    stream.on('content.done', (event) => doneEvents.push(event));
    stream.on('refusal.done', (event) => refusals.push(event.refusal));

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[0]?.message).toMatchObject({
      content: '',
      parsed: null,
      refusal: 'Request refused',
    });
    expect(doneEvents).toEqual([]);
    expect(refusals).toEqual(['Request refused']);
    expect(parseRaw).not.toHaveBeenCalled();
  });

  it('preserves unbranded custom parsers for structured stream completion', async () => {
    const parseRaw = vi.fn((content: string) => ({ transformed: JSON.parse(content) }));
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: { name: 'location', schema: { type: 'object' } },
      $parseRaw: parseRaw,
    };
    const stream = ChatCompletionStream.createChatCompletion(
      mockStreamingClient(contentChunks('{"city":', '"SF"}')),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: "What's the weather like in SF?" }],
        response_format: responseFormat,
      },
    );

    const doneParsed: unknown[] = [];
    stream.on('content.done', (event) => doneParsed.push(event.parsed));

    const completion = await stream.finalChatCompletion();

    expect(doneParsed).toEqual([{ transformed: { city: 'SF' } }]);
    expect(completion.choices[0]?.message.parsed).toEqual({ transformed: { city: 'SF' } });
    expect(parseRaw).toHaveBeenCalledTimes(2);
  });

  it.each(['length', 'content_filter'] as const)(
    'rejects unfinished raw-schema output with the %s finish reason',
    async (finishReason) => {
      const chunks = contentChunks('{"city":');
      const choice = chunks[0]?.choices[0];
      if (!choice) {
        throw new Error('Expected a completion choice');
      }
      choice.finish_reason = finishReason;
      const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(chunks), {
        model: 'gpt-test',
        messages: [{ role: 'user', content: "What's the weather like in SF?" }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'location', schema: { type: 'object' } },
        },
      });

      await expect(stream.finalChatCompletion()).rejects.toThrow(
        finishReason === 'length' ? /length limit/u : /content filter/u,
      );
    },
  );

  it('keeps raw-schema refusal content unparsed and emits the refusal', async () => {
    const chunks = contentChunks('not valid JSON');
    const choice = chunks[0]?.choices[0];
    if (!choice) {
      throw new Error('Expected a completion choice');
    }
    choice.delta.refusal = 'Request refused';
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(chunks), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: "What's the weather like in SF?" }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'location', schema: { type: 'object' } },
      },
    });

    const doneParsed: unknown[] = [];
    const refusals: string[] = [];
    stream.on('content.done', (event) => doneParsed.push(event.parsed));
    stream.on('refusal.done', (event) => refusals.push(event.refusal));

    const completion = await stream.finalChatCompletion();

    expect(doneParsed).toEqual([null]);
    expect(refusals).toEqual(['Request refused']);
    expect(completion.choices[0]?.message).toMatchObject({
      parsed: null,
      refusal: 'Request refused',
    });
  });

  it('keeps partially accumulated JSON unparsed when a later chunk refuses the request', async () => {
    const chunks = contentChunks('{"city":', '"SF"}');
    const refusalChoice = chunks[1]?.choices[0];
    if (!refusalChoice) {
      throw new Error('Expected a completion choice');
    }
    refusalChoice.delta.refusal = 'Request refused';
    const stream = ChatCompletionStream.createChatCompletion(mockStreamingClient(chunks), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: "What's the weather like in SF?" }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'location', schema: { type: 'object' } },
      },
    });

    const doneParsed: unknown[] = [];
    const refusals: string[] = [];
    stream.on('content.done', (event) => doneParsed.push(event.parsed));
    stream.on('refusal.done', (event) => refusals.push(event.refusal));

    const completion = await stream.finalChatCompletion();

    expect(doneParsed).toEqual([null]);
    expect(refusals).toEqual(['Request refused']);
    expect(completion.choices[0]?.message).toMatchObject({
      parsed: null,
      refusal: 'Request refused',
    });
  });

  it('leaves stream events unparsed for response formats without parsed output', async () => {
    const stream = ChatCompletionStream.createChatCompletion(
      mockStreamingClient(contentChunks('{"city":', '"SF"}')),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: "What's the weather like in SF?" }],
        response_format: { type: 'json_object' },
      },
    );

    const deltaParsed: unknown[] = [];
    let doneParsed: unknown;
    stream.on('content.delta', (event) => deltaParsed.push(event.parsed));
    stream.on('content.done', (event) => (doneParsed = event.parsed));

    const completion = await stream.finalChatCompletion();

    expect(deltaParsed).toEqual([undefined, undefined]);
    expect(doneParsed).toBeNull();
    expect(completion.choices[0]?.message.parsed).toBeNull();
  });
});
