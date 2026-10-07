import OpenAI from 'openai';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { Stream } from 'openai/streaming';
import { expectType } from '../utils/typing';

const audioFrames = [
  {
    id: 'chatcmpl-audio',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'audio-test',
    choices: [
      { index: 0, delta: { role: 'assistant', audio: { id: 'audio-1', data: 'ab', transcript: 'Hi' } } },
    ],
  },
  {
    id: 'chatcmpl-audio',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'audio-test',
    choices: [{ index: 0, delta: { audio: { data: 'cd', transcript: '!' } }, finish_reason: 'stop' }],
  },
  {
    id: 'chatcmpl-audio',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'audio-test',
    choices: [{ index: 0, delta: { audio: { expires_at: 0 } } }],
  },
];

test('the public create stream supplies the published nullable finish reason, including before and after stop', async () => {
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(
        `${audioFrames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'test-request' } },
      ),
  });
  const { data: stream, request_id } = await client.chat.completions
    .create({
      model: 'audio-test',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })
    .withResponse();
  const reasons: (OpenAI.Chat.ChatCompletion.Choice['finish_reason'] | null)[] = [];
  for await (const chunk of stream) {
    for (const choice of chunk.choices) {
      expectType<OpenAI.Chat.ChatCompletion.Choice['finish_reason'] | null>(choice.finish_reason);
      reasons.push(choice.finish_reason);
    }
  }
  expect(request_id).toBe('test-request');
  expect(reasons).toEqual([null, 'stop', null]);
});

test('transported chat streams normalize emitted chunks without erasing the final stop or audio', async () => {
  const wire = new Stream(async function* wire() {
    yield* audioFrames;
  }, new AbortController());
  const stream = ChatCompletionStream.fromReadableStream(wire.toReadableStream());
  const emitted: unknown[] = [];
  stream.on('chunk', (chunk) => emitted.push(chunk.choices[0]?.finish_reason));
  const final = await stream.finalChatCompletion();
  expect(emitted).toEqual([null, 'stop', null]);
  expect(final.choices[0]).toMatchObject({
    finish_reason: 'stop',
    message: { audio: { id: 'audio-1', data: 'abcd', transcript: 'Hi!', expires_at: 0 } },
  });
});

test('create preserves a supplied stream instance and normalizes its iterator', async () => {
  let supplied: Stream<unknown> | undefined;
  class CustomStream<T> extends Stream<T> {
    marker() {
      return this.controller.signal.aborted ? 'aborted' : 'custom';
    }
    static override fromSSEResponse<T>(
      response: Response,
      controller: AbortController,
      client?: OpenAI,
      synthesizeEventData?: boolean,
    ): Stream<T> {
      const decoded = Stream.fromSSEResponse<T>(response, controller, client, synthesizeEventData);
      const custom = new CustomStream(() => decoded[Symbol.asyncIterator](), controller);
      supplied = custom;
      return custom;
    }
  }
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(
        `${audioFrames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  });
  const stream = await client.chat.completions.create(
    { model: 'audio-test', messages: [], stream: true },
    { __streamClass: CustomStream },
  );
  expect(stream).toBe(supplied);
  if (!(stream instanceof CustomStream)) {
    throw new Error('Custom stream replaced');
  }
  expect(stream.marker()).toBe('custom');
  const reasons = [];
  for await (const chunk of stream) {
    reasons.push(chunk.choices[0]?.finish_reason);
  }
  expect(reasons).toEqual([null, 'stop', null]);
});
