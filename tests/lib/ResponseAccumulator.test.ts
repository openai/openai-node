import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type {
  Response,
  ResponseReasoningItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

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

  it('ignores keepalive events', () => {
    const initial = accumulateResponse({
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    });

    const snapshot = accumulateResponse({ type: 'keepalive', sequence_number: 1 }, initial);

    expect(snapshot).toBe(initial);
    expect(snapshot).toEqual(makeResponse());
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

  it('normalizes reasoning items that arrive without a summary', () => {
    const snapshot = accumulateEvents([
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: reasoningItemWithoutSummary('rs_123'),
      },
    ]);

    expect(snapshot.output[0]).toEqual({
      id: 'rs_123',
      type: 'reasoning',
      status: 'in_progress',
      summary: [],
    });
  });

  it('normalizes reasoning items replaced by output_item.done without a summary', () => {
    const snapshot = accumulateEvents([
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: reasoningItemWithoutSummary('rs_123'),
      },
      {
        type: 'response.output_item.done',
        sequence_number: 2,
        output_index: 0,
        item: reasoningItemWithoutSummary('rs_123', 'completed'),
      },
    ]);

    expect(snapshot.output[0]).toEqual({
      id: 'rs_123',
      type: 'reasoning',
      status: 'completed',
      summary: [],
    });
  });

  it('normalizes reasoning items carried by lifecycle events without a summary', () => {
    const snapshot = accumulateEvents([
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      {
        type: 'response.completed',
        sequence_number: 1,
        response: makeResponse({
          status: 'completed',
          output: [reasoningItemWithoutSummary('rs_123', 'completed')],
        }),
      },
    ]);

    expect(snapshot.output[0]).toEqual({
      id: 'rs_123',
      type: 'reasoning',
      status: 'completed',
      summary: [],
    });
  });

  it('handles reasoning summary events on output items with uninitialized summary', () => {
    const snapshot = accumulateEvents([
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: reasoningItemWithoutSummary('rs_123'),
      },
      {
        type: 'response.reasoning_summary_part.added',
        sequence_number: 2,
        item_id: 'rs_123',
        output_index: 0,
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
      },
      {
        type: 'response.reasoning_summary_text.delta',
        sequence_number: 3,
        item_id: 'rs_123',
        output_index: 0,
        summary_index: 0,
        delta: 'The model ',
      },
      {
        type: 'response.reasoning_summary_text.delta',
        sequence_number: 4,
        item_id: 'rs_123',
        output_index: 0,
        summary_index: 0,
        delta: 'reasoned about the problem.',
      },
      {
        type: 'response.reasoning_summary_part.done',
        sequence_number: 5,
        item_id: 'rs_123',
        output_index: 0,
        summary_index: 0,
        part: { type: 'summary_text', text: 'The model reasoned about the problem.' },
      },
    ]);

    expect(snapshot.output[0]).toMatchObject({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'The model reasoned about the problem.' }],
    });
  });
});

/**
 * The wire can send a reasoning item without the `summary` the type requires, so
 * build that shape at the boundary instead of widening a whole event to `any`.
 */
function reasoningItemWithoutSummary(
  id: string,
  status: ResponseReasoningItem['status'] = 'in_progress',
): ResponseReasoningItem {
  const item: Omit<ResponseReasoningItem, 'summary'> = { id, type: 'reasoning', status };
  return item as ResponseReasoningItem;
}

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
