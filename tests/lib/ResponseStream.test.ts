import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';
import OpenAI from 'openai';

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
