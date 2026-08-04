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

  describe('string delta accumulation', () => {
    // Every target that a `.delta` event appends to. The wire payload can leave any
    // of them unset, in which case appending must start from an empty string rather
    // than stringifying `undefined`.
    const cases: Array<{
      name: string;
      setup: ResponseStreamEvent[];
      clear: (snapshot: Response) => void;
      deltas: ResponseStreamEvent[];
      read: (snapshot: Response) => string | undefined;
    }> = [
      {
        name: 'response.output_text.delta (content part text)',
        setup: [...messageSetup(), outputTextPartAdded()],
        clear: (snapshot) => deleteField(outputTextPart(snapshot), 'text'),
        deltas: [outputTextDelta(3, 'foo'), outputTextDelta(4, 'bar')],
        read: (snapshot) => outputTextPart(snapshot).text,
      },
      {
        name: 'response.output_text.delta (aggregated output_text)',
        setup: [...messageSetup(), outputTextPartAdded()],
        clear: (snapshot) => deleteField(snapshot, 'output_text'),
        deltas: [outputTextDelta(3, 'foo'), outputTextDelta(4, 'bar')],
        read: (snapshot) => snapshot.output_text,
      },
      {
        name: 'response.refusal.delta',
        setup: [
          ...messageSetup(),
          {
            type: 'response.content_part.added',
            sequence_number: 2,
            item_id: 'msg_123',
            output_index: 0,
            content_index: 0,
            part: { type: 'refusal', refusal: '' },
          },
        ],
        clear: (snapshot) => deleteField(refusalPart(snapshot), 'refusal'),
        deltas: [
          {
            type: 'response.refusal.delta',
            sequence_number: 3,
            item_id: 'msg_123',
            output_index: 0,
            content_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.refusal.delta',
            sequence_number: 4,
            item_id: 'msg_123',
            output_index: 0,
            content_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => refusalPart(snapshot).refusal,
      },
      {
        name: 'response.function_call_arguments.delta',
        setup: [
          created(),
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: {
              id: 'fc_123',
              type: 'function_call',
              call_id: 'call_123',
              name: 'get_weather',
              arguments: '',
              status: 'in_progress',
            },
          },
        ],
        clear: (snapshot) => deleteField(outputItem(snapshot, 'function_call'), 'arguments'),
        deltas: [
          {
            type: 'response.function_call_arguments.delta',
            sequence_number: 2,
            item_id: 'fc_123',
            output_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.function_call_arguments.delta',
            sequence_number: 3,
            item_id: 'fc_123',
            output_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => outputItem(snapshot, 'function_call').arguments,
      },
      {
        name: 'response.reasoning_text.delta',
        setup: [
          ...reasoningSetup(),
          {
            type: 'response.content_part.added',
            sequence_number: 2,
            item_id: 'rs_123',
            output_index: 0,
            content_index: 0,
            part: { type: 'reasoning_text', text: '' },
          },
        ],
        clear: (snapshot) => deleteField(reasoningTextPart(snapshot), 'text'),
        deltas: [
          {
            type: 'response.reasoning_text.delta',
            sequence_number: 3,
            item_id: 'rs_123',
            output_index: 0,
            content_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.reasoning_text.delta',
            sequence_number: 4,
            item_id: 'rs_123',
            output_index: 0,
            content_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => reasoningTextPart(snapshot).text,
      },
      {
        name: 'response.reasoning_summary_text.delta',
        setup: [
          ...reasoningSetup(),
          {
            type: 'response.reasoning_summary_part.added',
            sequence_number: 2,
            item_id: 'rs_123',
            output_index: 0,
            summary_index: 0,
            part: { type: 'summary_text', text: '' },
          },
        ],
        clear: (snapshot) => deleteField(reasoningSummaryPart(snapshot), 'text'),
        deltas: [
          {
            type: 'response.reasoning_summary_text.delta',
            sequence_number: 3,
            item_id: 'rs_123',
            output_index: 0,
            summary_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.reasoning_summary_text.delta',
            sequence_number: 4,
            item_id: 'rs_123',
            output_index: 0,
            summary_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => reasoningSummaryPart(snapshot).text,
      },
      {
        name: 'response.custom_tool_call_input.delta',
        setup: [
          created(),
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: {
              id: 'ctc_123',
              type: 'custom_tool_call',
              call_id: 'call_123',
              name: 'run_script',
              input: '',
            },
          },
        ],
        clear: (snapshot) => deleteField(outputItem(snapshot, 'custom_tool_call'), 'input'),
        deltas: [
          {
            type: 'response.custom_tool_call_input.delta',
            sequence_number: 2,
            item_id: 'ctc_123',
            output_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.custom_tool_call_input.delta',
            sequence_number: 3,
            item_id: 'ctc_123',
            output_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => outputItem(snapshot, 'custom_tool_call').input,
      },
      {
        name: 'response.mcp_call_arguments.delta',
        setup: [
          created(),
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: {
              id: 'mcp_123',
              type: 'mcp_call',
              name: 'search',
              server_label: 'docs',
              arguments: '',
            },
          },
        ],
        clear: (snapshot) => deleteField(outputItem(snapshot, 'mcp_call'), 'arguments'),
        deltas: [
          {
            type: 'response.mcp_call_arguments.delta',
            sequence_number: 2,
            item_id: 'mcp_123',
            output_index: 0,
            delta: 'foo',
          },
          {
            type: 'response.mcp_call_arguments.delta',
            sequence_number: 3,
            item_id: 'mcp_123',
            output_index: 0,
            delta: 'bar',
          },
        ],
        read: (snapshot) => outputItem(snapshot, 'mcp_call').arguments,
      },
    ];

    it.each(cases)('appends to an initialized target for $name', ({ setup, deltas, read }) => {
      let snapshot = accumulateEvents(setup);

      for (const delta of deltas) {
        snapshot = accumulateResponse(delta, snapshot);
      }

      expect(read(snapshot)).toBe('foobar');
    });

    it.each(cases)('appends to a missing target for $name', ({ setup, clear, deltas, read }) => {
      let snapshot = accumulateEvents(setup);
      clear(snapshot);
      expect(read(snapshot)).toBeUndefined();

      for (const delta of deltas) {
        snapshot = accumulateResponse(delta, snapshot);
      }

      expect(read(snapshot)).toBe('foobar');
    });
  });
});

function created(): ResponseStreamEvent {
  return { type: 'response.created', sequence_number: 0, response: makeResponse() };
}

function messageSetup(): ResponseStreamEvent[] {
  return [
    created(),
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
  ];
}

function reasoningSetup(): ResponseStreamEvent[] {
  return [
    created(),
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { id: 'rs_123', type: 'reasoning', summary: [], content: [] },
    },
  ];
}

function outputTextPartAdded(): ResponseStreamEvent {
  return {
    type: 'response.content_part.added',
    sequence_number: 2,
    item_id: 'msg_123',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', annotations: [], text: '' },
  };
}

function outputTextDelta(sequenceNumber: number, delta: string): ResponseStreamEvent {
  return {
    type: 'response.output_text.delta',
    sequence_number: sequenceNumber,
    item_id: 'msg_123',
    output_index: 0,
    content_index: 0,
    delta,
    logprobs: [],
  };
}

/**
 * Drops a required field the way a wire payload that omits it would, without
 * widening the type of the object under test.
 */
function deleteField<T extends object, K extends keyof T>(target: T, key: K): void {
  delete (target as Partial<T>)[key];
}

function outputItem<T extends Response['output'][number]['type']>(
  snapshot: Response,
  type: T,
): Extract<Response['output'][number], { type: T }> {
  const output = snapshot.output[0];
  if (output?.type !== type) {
    throw new Error(`expected output at index 0 to be '${type}', got ${output?.type}`);
  }
  return output as Extract<Response['output'][number], { type: T }>;
}

function messagePart(snapshot: Response) {
  const part = outputItem(snapshot, 'message').content[0];
  if (!part) {
    throw new Error('expected content at index 0');
  }
  return part;
}

function outputTextPart(snapshot: Response) {
  const part = messagePart(snapshot);
  if (part.type !== 'output_text') {
    throw new Error(`expected content to be 'output_text', got ${part.type}`);
  }
  return part;
}

function refusalPart(snapshot: Response) {
  const part = messagePart(snapshot);
  if (part.type !== 'refusal') {
    throw new Error(`expected content to be 'refusal', got ${part.type}`);
  }
  return part;
}

function reasoningTextPart(snapshot: Response) {
  const part = outputItem(snapshot, 'reasoning').content?.[0];
  if (!part) {
    throw new Error('expected reasoning content at index 0');
  }
  return part;
}

function reasoningSummaryPart(snapshot: Response) {
  const part = outputItem(snapshot, 'reasoning').summary[0];
  if (!part) {
    throw new Error('expected reasoning summary at index 0');
  }
  return part;
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
