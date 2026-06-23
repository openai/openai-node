import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';

describe('ResponseAccumulator', () => {
  it('accumulates a final response snapshot from stream events', () => {
    const createdResponse = makeResponse();

    let snapshot = accumulateResponse({
      type: 'response.created',
      sequence_number: 0,
      response: createdResponse,
    });

    snapshot = accumulateResponse(
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
      snapshot,
    );

    snapshot = accumulateResponse(
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
      snapshot,
    );

    snapshot = accumulateResponse(
      {
        type: 'response.output_text.delta',
        sequence_number: 3,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'Hello world',
        logprobs: [],
      },
      snapshot,
    );

    snapshot = accumulateResponse(
      {
        type: 'response.completed',
        sequence_number: 4,
        response: {
          ...snapshot,
          output_text: 'Hello world',
          status: 'completed',
          output: [
            {
              ...snapshot.output[0]!,
              status: 'completed',
            },
          ],
        },
      },
      snapshot,
    );

    expect(snapshot.output_text).toBe('Hello world');
    expect(snapshot.output[0]).toMatchObject({
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world' }],
    });
  });

  it('does not mutate raw events and can replay them', () => {
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const itemAdded = {
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
    } satisfies ResponseStreamEvent;
    const partAdded = {
      type: 'response.content_part.added',
      sequence_number: 2,
      item_id: 'msg_123',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', annotations: [], text: '' },
    } satisfies ResponseStreamEvent;
    const delta = {
      type: 'response.output_text.delta',
      sequence_number: 3,
      item_id: 'msg_123',
      output_index: 0,
      content_index: 0,
      delta: 'Hello world',
      logprobs: [],
    } satisfies ResponseStreamEvent;
    const events: ResponseStreamEvent[] = [created, itemAdded, partAdded, delta];

    const first = accumulateEvents(events);
    const replayed = accumulateEvents(events);

    expect(replayed).toEqual(first);
    expect(created.response.output).toEqual([]);
    expect(itemAdded.item.content).toEqual([]);
    expect(partAdded.part.text).toBe('');
    expect(first.output_text).toBe('Hello world');
  });

  it.each([
    ['response.completed', 'completed'],
    ['response.failed', 'failed'],
    ['response.incomplete', 'incomplete'],
  ] as const)('uses the authoritative response from %s', (type, status) => {
    const terminalResponse = makeResponse({
      status,
      output: [
        {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          status: status === 'failed' ? 'incomplete' : status,
          content: [{ type: 'output_text', annotations: [], text: 'terminal text' }],
        },
      ],
    });
    delete (terminalResponse as Partial<Response>).output_text;

    const initial = accumulateResponse({
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    });
    const snapshot = accumulateResponse(
      { type, sequence_number: 1, response: terminalResponse } as ResponseStreamEvent,
      initial,
    );

    expect(snapshot.status).toBe(status);
    expect(snapshot.output_text).toBe('terminal text');
    expect(snapshot).not.toBe(terminalResponse);
  });

  it('accumulates refusal deltas', () => {
    const snapshot = accumulateEvents([
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
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
        part: { type: 'refusal', refusal: '' },
      },
      {
        type: 'response.refusal.delta',
        sequence_number: 3,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'I cannot ',
      },
      {
        type: 'response.refusal.delta',
        sequence_number: 4,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'help with that.',
      },
    ]);

    expect(snapshot.output[0]).toMatchObject({
      type: 'message',
      content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
    });
  });
});

function accumulateEvents(events: ResponseStreamEvent[]): Response {
  let snapshot: Response | undefined;
  for (const event of events) {
    snapshot = accumulateResponse(event, snapshot);
  }
  if (!snapshot) {
    throw new Error('expected events to produce a response snapshot');
  }
  return snapshot;
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
