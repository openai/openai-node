import OpenAI from 'openai';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';

const RUNTIME_MODEL = 'us.openai.gpt-5.6-sol';
const RUNTIME_CHAT_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions';

function sseResponse(events: readonly unknown[]): Response {
  const body = events
    .map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}`)
    .join('\n\n');
  return new Response(`${body}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function chatChunk(delta: object, finishReason: 'stop' | null = null) {
  return {
    id: 'chatcmpl_runtime_stream',
    object: 'chat.completion.chunk',
    created: 1,
    model: RUNTIME_MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  };
}

describe('bedrock Runtime streaming', () => {
  test('streams Chat Completions in wire order, assembles content, and stops at [DONE]', async () => {
    const chunks = [
      chatChunk({ role: 'assistant', content: 'Hel' }),
      chatChunk({ content: 'lo' }),
      chatChunk({}, 'stop'),
    ];
    let request: { url: string; headers: Headers; body: string } | undefined;
    const client = new OpenAI({
      provider: bedrock({
        endpoint: 'runtime',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch: async (url, init) => {
        request = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: String(init?.body ?? ''),
        };
        return sseResponse([...chunks, '[DONE]', chatChunk({ content: ' ignored' })]);
      },
    });

    const deltas: string[] = [];
    const stream = client.chat.completions
      .stream({ model: RUNTIME_MODEL, messages: [{ role: 'user', content: 'Say hello' }] })
      .on('chunk', (chunk) => deltas.push(chunk.choices[0]?.delta.content ?? ''));
    const completion = await stream.finalChatCompletion();

    expect(request?.url).toBe(RUNTIME_CHAT_URL);
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ model: RUNTIME_MODEL, stream: true });
    expect(request?.headers.get('authorization')).toContain('/bedrock/aws4_request');
    expect(deltas).toEqual(['Hel', 'lo', '']);
    expect(completion.choices[0]).toMatchObject({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hello' },
    });
  });

  test('uses the terminal Responses event as the final streamed response', async () => {
    const completedResponse = {
      id: 'resp_runtime_stream',
      object: 'response',
      model: RUNTIME_MODEL,
      status: 'completed',
      output: [
        {
          id: 'msg_runtime',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', annotations: [], text: 'Hello' }],
        },
      ],
    };
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async () =>
        sseResponse([
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...completedResponse, status: 'in_progress', output: [] },
          },
          { type: 'response.completed', sequence_number: 1, response: completedResponse },
          '[DONE]',
          {
            type: 'response.failed',
            sequence_number: 2,
            response: { ...completedResponse, status: 'failed' },
          },
        ]),
    });

    const eventTypes: string[] = [];
    const stream = client.responses
      .stream({ model: RUNTIME_MODEL, input: 'Say hello' })
      .on('event', (event) => eventTypes.push(event.type));
    const response = await stream.finalResponse();

    expect(eventTypes).toEqual(['response.created', 'response.completed']);
    expect(response).toMatchObject({
      id: 'resp_runtime_stream',
      status: 'completed',
      output_text: 'Hello',
    });
  });
});
