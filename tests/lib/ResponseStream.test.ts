import OpenAI, { APIUserAbortError } from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';

jest.setTimeout(1000 * 30);

describe('.stream()', () => {
  it('replays prior events when resuming by ID so snapshots stay complete', async () => {
    const requests: string[] = [];
    const response = {
      id: 'resp_123',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      output: [],
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      parallel_tool_calls: false,
      temperature: null,
      tools: [],
      top_p: null,
      status: 'completed',
      usage: null,
    };
    const events = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: { ...response, status: 'in_progress' },
      },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      { type: 'response.completed', sequence_number: 2, response },
    ];
    const openai = new OpenAI({
      apiKey: 'My API Key',
      fetch: async (url) => {
        const requestURL = String(url);
        requests.push(requestURL);
        // Match the API's cursor behavior: forwarding `starting_after` omits the prefix needed
        // by the accumulator, while omitting it replays the complete event sequence.
        const streamEvents = requestURL.includes('starting_after=') ? events.slice(1) : events;
        const body = `${streamEvents
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join('\n\n')}\n\ndata: [DONE]\n\n`;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });

    const emittedEvents: number[] = [];
    const stream = openai.responses
      .stream({ response_id: 'resp_123', starting_after: 0 })
      .on('event', (event) => emittedEvents.push(event.sequence_number));
    const final = await stream.finalResponse();

    expect(requests).toEqual(['https://api.openai.com/v1/responses/resp_123?stream=true']);
    expect(emittedEvents).toEqual([1, 2]);
    expect(final.id).toBe('resp_123');
  });

  it('creates a response stream from a readable stream', async () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse(),
      },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'response.content_part.added',
        sequence_number: 2,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          text: '',
        },
      },
      {
        type: 'response.output_text.delta',
        sequence_number: 3,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'Hello world',
        logprobs: [],
      },
      {
        type: 'response.completed',
        sequence_number: 4,
        response: makeResponse({
          status: 'completed',
          output_text: 'Hello world',
          output: [
            {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', annotations: [], text: 'Hello world' }],
            },
          ],
        }),
      },
    ];
    const snapshots: string[] = [];
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events)).on(
      'response.output_text.delta',
      (event) => snapshots.push(event.snapshot),
    );
    const emittedEvents: ResponseStreamEvent[] = [];

    for await (const event of stream) {
      emittedEvents.push(event);
    }

    const final = await stream.finalResponse();

    expect(emittedEvents).toEqual(events);
    expect(snapshots).toEqual(['Hello world']);
    expect(final.output_text).toBe('Hello world');
    expect(final.output[0]).toMatchObject({
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world' }],
    });
  });

  it('cancels a stalled readable stream when aborted', async () => {
    const encoder = new TextEncoder();
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;

    let resolvePullStarted!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      resolvePullStarted = resolve;
    });
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const cancel = jest.fn(() => resolveCancelled());
    let pulls = 0;
    const readable = new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) {
          controller.enqueue(encoder.encode(`${JSON.stringify(created)}\n`));
          return;
        }

        resolvePullStarted();
        return new Promise<void>(() => {});
      },
      cancel,
    });
    const stream = ResponseStream.fromReadableStream(readable);

    await stream.emitted('response.created');
    await pullStarted;

    const done = expect(stream.done()).rejects.toThrowError(APIUserAbortError);
    stream.abort();

    await cancelled;
    await done;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.aborted).toBe(true);
  }, 5000);

  it('standard text works', async () => {
    const deltas: string[] = [];

    const stream = (
      await makeStreamSnapshotRequest((openai) =>
        openai.responses.stream({
          model: 'gpt-4o-2024-08-06',
          input: 'Say hello world',
        }),
      )
    ).on('response.output_text.delta', (e) => {
      deltas.push(e.snapshot);
    });

    const final = await stream.finalResponse();
    // The raw stream omits the SDK-only `output_text` convenience field.
    expect(final.output_text).toBe('Hello world');
    expect(deltas).toEqual(['Hello ', 'Hello world']);

    // basic shape checks
    expect(final.object).toBe('response');
    expect(final.output[0]?.type).toBe('message');
    // message should contain a single output_text part with the final text
    const msg = final.output[0];
    if (msg?.type === 'message') {
      expect(msg.content[0]).toMatchObject({ type: 'output_text', text: 'Hello world' });
    }
  });

  it('reasoning works', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.responses.stream({
        model: 'o3',
        input: 'Compute 6 * 7',
        reasoning: { effort: 'medium' },
      }),
    );

    const final = await stream.finalResponse();
    expect(final.object).toBe('response');
    // first item should be reasoning with accumulated text
    expect(final.output[0]?.type).toBe('reasoning');
    if (final.output[0]?.type === 'reasoning') {
      expect(final.output[0].content?.[0]).toMatchObject({
        type: 'reasoning_text',
        text: 'Chain: Step 1. Step 2.',
      });
    }
    // second item should be the assistant message with the final text
    expect(final.output[1]?.type).toBe('message');
    if (final.output[1]?.type === 'message') {
      expect(final.output[1].content[0]).toMatchObject({ type: 'output_text', text: 'The answer is 42' });
    }
    expect(final.output_text).toBe('The answer is 42');
  });
});

function readableStreamFromEvents(events: ResponseStreamEvent[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(events.map((event) => encoder.encode(JSON.stringify(event) + '\n')));
}

function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_123',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    max_output_tokens: null,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    service_tier: null,
    store: true,
    text: { format: { type: 'text' }, verbosity: null },
    truncation: 'disabled',
    usage: null,
    user: null,
    ...overrides,
  } as Response;
}
