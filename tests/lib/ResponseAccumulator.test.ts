import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type {
  IncrementalContentPart,
  IncrementalOutputItem,
  IncrementalResponse,
  IncrementalResponseStreamEvent,
} from 'openai/lib/responses/ResponseAccumulator';
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

  describe('normalizes incomplete wire shapes', () => {
    it.each(incrementalWireCases())('%s', (_name, { ingest, normalized, delta, accumulated }) => {
      expect(accumulateEvents(ingest).output[0]).toEqual(normalized);

      if (delta) {
        expect(accumulateEvents([...ingest, delta]).output[0]).toEqual(accumulated);
      }
    });

    it('keeps output_text a string before the first text delta', () => {
      const ingest = messageIngest({ type: 'output_text', annotations: [] });

      expect(accumulateEvents(ingest).output_text).toBe('');
      expect(accumulateEvents([...ingest, outputTextDelta()]).output_text).toBe('Hello world');
    });
  });
});

/**
 * One case per event family that can carry an item or part whose delta-driven string
 * field has not streamed in yet. Each case asserts `snapshot.output[0]` directly after
 * the ingesting event, and again once the matching delta has been applied.
 */
function incrementalWireCases(): Array<[string, IncrementalWireCase]> {
  return [
    [
      'response.output_item.added - function_call arguments',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'f' }),
        ],
        normalized: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'f', arguments: '' },
        delta: {
          type: 'response.function_call_arguments.delta',
          sequence_number: 2,
          item_id: 'fc_1',
          output_index: 0,
          delta: '{"city": "Paris"}',
        },
        accumulated: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'f',
          arguments: '{"city": "Paris"}',
        },
      },
    ],
    [
      'response.output_item.added - mcp_call arguments',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'mcp_1', type: 'mcp_call', name: 'f', server_label: 'server' }),
        ],
        normalized: { id: 'mcp_1', type: 'mcp_call', name: 'f', server_label: 'server', arguments: '' },
        delta: {
          type: 'response.mcp_call_arguments.delta',
          sequence_number: 2,
          item_id: 'mcp_1',
          output_index: 0,
          delta: '{"query": "docs"}',
        },
        accumulated: {
          id: 'mcp_1',
          type: 'mcp_call',
          name: 'f',
          server_label: 'server',
          arguments: '{"query": "docs"}',
        },
      },
    ],
    [
      'response.output_item.added - custom_tool_call input',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'ctc_1', type: 'custom_tool_call', call_id: 'call_1', name: 'f' }),
        ],
        normalized: { id: 'ctc_1', type: 'custom_tool_call', call_id: 'call_1', name: 'f', input: '' },
        delta: {
          type: 'response.custom_tool_call_input.delta',
          sequence_number: 2,
          item_id: 'ctc_1',
          output_index: 0,
          delta: 'echo hi',
        },
        accumulated: {
          id: 'ctc_1',
          type: 'custom_tool_call',
          call_id: 'call_1',
          name: 'f',
          input: 'echo hi',
        },
      },
    ],
    [
      'response.content_part.added - output_text text',
      {
        ingest: messageIngest({ type: 'output_text', annotations: [] }),
        normalized: message([{ type: 'output_text', annotations: [], text: '' }]),
        delta: outputTextDelta(),
        accumulated: message([{ type: 'output_text', annotations: [], text: 'Hello world' }]),
      },
    ],
    [
      'response.content_part.added - refusal',
      {
        ingest: messageIngest({ type: 'refusal' }),
        normalized: message([{ type: 'refusal', refusal: '' }]),
        delta: {
          type: 'response.refusal.delta',
          sequence_number: 3,
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
          delta: 'Permission denied',
        },
        accumulated: message([{ type: 'refusal', refusal: 'Permission denied' }]),
      },
    ],
    [
      'response.content_part.added - reasoning_text',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'rs_1', type: 'reasoning', summary: [] }),
          {
            type: 'response.content_part.added',
            sequence_number: 2,
            item_id: 'rs_1',
            output_index: 0,
            content_index: 0,
            part: { type: 'reasoning_text' },
          },
        ],
        normalized: {
          id: 'rs_1',
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: '' }],
        },
        delta: {
          type: 'response.reasoning_text.delta',
          sequence_number: 3,
          item_id: 'rs_1',
          output_index: 0,
          content_index: 0,
          delta: 'thinking',
        },
        accumulated: {
          id: 'rs_1',
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: 'thinking' }],
        },
      },
    ],
    [
      'response.reasoning_summary_part.added - summary_text',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'rs_1', type: 'reasoning', summary: [] }),
          summaryPartAdded(),
        ],
        normalized: { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '' }] },
        delta: {
          type: 'response.reasoning_summary_text.delta',
          sequence_number: 3,
          item_id: 'rs_1',
          output_index: 0,
          summary_index: 0,
          delta: 'summarizing',
        },
        accumulated: {
          id: 'rs_1',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'summarizing' }],
        },
      },
    ],
    [
      'response.output_item.added - code_interpreter_call code',
      {
        ingest: [
          created(),
          outputItemAdded({
            id: 'ci_1',
            type: 'code_interpreter_call',
            container_id: 'container_1',
            outputs: null,
            status: 'in_progress',
          }),
        ],
        normalized: {
          id: 'ci_1',
          type: 'code_interpreter_call',
          container_id: 'container_1',
          outputs: null,
          status: 'in_progress',
          code: null,
        },
        delta: {
          type: 'response.code_interpreter_call_code.delta',
          sequence_number: 2,
          item_id: 'ci_1',
          output_index: 0,
          delta: 'print(1)',
        },
        accumulated: {
          id: 'ci_1',
          type: 'code_interpreter_call',
          container_id: 'container_1',
          outputs: null,
          status: 'in_progress',
          code: 'print(1)',
        },
      },
    ],
    [
      'response.output_item.done - function_call arguments',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'f' }),
          {
            type: 'response.output_item.done',
            sequence_number: 2,
            output_index: 0,
            item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'f', status: 'completed' },
          },
        ],
        normalized: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'f',
          status: 'completed',
          arguments: '',
        },
      },
    ],
    [
      'response.content_part.done - refusal',
      {
        ingest: [
          ...messageIngest({ type: 'refusal' }),
          {
            type: 'response.content_part.done',
            sequence_number: 3,
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
            part: { type: 'refusal' },
          },
        ],
        normalized: message([{ type: 'refusal', refusal: '' }]),
      },
    ],
    [
      'response.reasoning_summary_part.done - summary_text',
      {
        ingest: [
          created(),
          outputItemAdded({ id: 'rs_1', type: 'reasoning', summary: [] }),
          summaryPartAdded(),
          {
            type: 'response.reasoning_summary_part.done',
            sequence_number: 3,
            item_id: 'rs_1',
            output_index: 0,
            summary_index: 0,
            part: { type: 'summary_text' },
          },
        ],
        normalized: { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '' }] },
      },
    ],
    [
      'response.completed - function_call arguments',
      {
        ingest: [
          created(),
          {
            type: 'response.completed',
            sequence_number: 1,
            response: makeIncrementalResponse({
              status: 'completed',
              output: [
                { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'f', status: 'completed' },
              ],
            }),
          },
        ],
        normalized: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'f',
          status: 'completed',
          arguments: '',
        },
      },
    ],
  ];
}

type IncrementalWireCase = {
  /** Events up to and including the one that ingests the incomplete item or part. */
  ingest: AccumulatedEvent[];
  /** `snapshot.output[0]` directly after `ingest`, with no delta applied. */
  normalized: unknown;
  /** A delta appending to the field the ingested payload omitted. */
  delta?: AccumulatedEvent;
  /** `snapshot.output[0]` after `delta` is applied. */
  accumulated?: unknown;
};

type AccumulatedEvent = ResponseStreamEvent | IncrementalResponseStreamEvent;

function created(): AccumulatedEvent {
  return { type: 'response.created', sequence_number: 0, response: makeResponse() };
}

function summaryPartAdded(): AccumulatedEvent {
  return {
    type: 'response.reasoning_summary_part.added',
    sequence_number: 2,
    item_id: 'rs_1',
    output_index: 0,
    summary_index: 0,
    part: { type: 'summary_text' },
  };
}

function outputTextDelta(): AccumulatedEvent {
  return {
    type: 'response.output_text.delta',
    sequence_number: 3,
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
    delta: 'Hello world',
    logprobs: [],
  };
}

function outputItemAdded(item: IncrementalOutputItem): AccumulatedEvent {
  return { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item };
}

function messageIngest(part: IncrementalContentPart): AccumulatedEvent[] {
  return [
    created(),
    outputItemAdded({ id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] }),
    {
      type: 'response.content_part.added',
      sequence_number: 2,
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      part,
    },
  ];
}

function message(content: unknown): unknown {
  return { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content };
}

function accumulateEvents(events: AccumulatedEvent[]): Response {
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

function makeIncrementalResponse(overrides: Partial<IncrementalResponse> = {}): IncrementalResponse {
  return { ...makeResponse(), ...overrides };
}
