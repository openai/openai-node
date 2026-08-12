import { vi } from 'vitest';
import type OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStreamingRunner';
import type { ChatCompletionTokenLogprob } from 'openai/resources';
import { Stream } from 'openai/streaming';
import { z } from 'zod/v4';
import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';

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
