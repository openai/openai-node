import type { Response, ResponseOutputItem, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { ResponsesWebSocketAccumulator } from 'openai/lib/responses/responses-websocket-accumulator';

function response(status: Response['status'] = 'in_progress'): Response {
  return {
    id: 'resp_fixture',
    object: 'response',
    access_programs: null,
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: { revision: status ?? 'absent' },
    model: 'fixture-model',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
}

function shellCall(commands: string[]): Extract<ResponseOutputItem, { type: 'shell_call' }> {
  return {
    type: 'shell_call',
    id: 'shell_fixture',
    call_id: 'call_shell_fixture',
    environment: null,
    status: 'in_progress',
    action: { commands, max_output_length: null, timeout_ms: null },
  };
}

function shellOutput(): Extract<ResponseOutputItem, { type: 'shell_call_output' }> {
  return {
    type: 'shell_call_output',
    id: 'shell_out_fixture',
    call_id: 'call_shell_fixture',
    status: 'in_progress',
    max_output_length: null,
    output: [],
  };
}

function shellAccumulator(commands: string[]): ResponsesWebSocketAccumulator {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 1,
    output_index: 0,
    item: shellCall(commands),
  });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 2,
    output_index: 1,
    item: shellOutput(),
  });
  return accumulator;
}

type SparseDelta = Extract<
  ResponseStreamEvent,
  {
    type:
      | 'response.output_text.delta'
      | 'response.refusal.delta'
      | 'response.function_call_arguments.delta'
      | 'response.custom_tool_call_input.delta'
      | 'response.mcp_call_arguments.delta';
  }
>;

const sparseDeltas: SparseDelta[] = [
  {
    type: 'response.output_text.delta',
    sequence_number: 1,
    output_index: 4,
    item_id: 'msg_fixture',
    content_index: 2,
    delta: 'partial text',
    logprobs: [],
  },
  {
    type: 'response.refusal.delta',
    sequence_number: 1,
    output_index: 4,
    item_id: 'msg_fixture',
    content_index: 2,
    delta: 'partial refusal',
  },
  {
    type: 'response.function_call_arguments.delta',
    sequence_number: 1,
    output_index: 4,
    item_id: 'fn_fixture',
    delta: '{"partial":',
  },
  {
    type: 'response.custom_tool_call_input.delta',
    sequence_number: 1,
    output_index: 4,
    item_id: 'custom_fixture',
    delta: 'partial input',
  },
  {
    type: 'response.mcp_call_arguments.delta',
    sequence_number: 1,
    output_index: 4,
    item_id: 'mcp_fixture',
    delta: '{"partial":',
  },
];

function expectedFields(delta: SparseDelta, final: boolean) {
  switch (delta.type) {
    case 'response.output_text.delta': {
      return {
        content: [{ content_index: 2, data: { text: final ? 'done text' : delta.delta, logprobs: [] } }],
      };
    }
    case 'response.refusal.delta': {
      return { content: [{ content_index: 2, data: { refusal: final ? 'done refusal' : delta.delta } }] };
    }
    case 'response.custom_tool_call_input.delta': {
      return { input: final ? 'done input' : delta.delta };
    }
    case 'response.function_call_arguments.delta':
    case 'response.mcp_call_arguments.delta': {
      return { arguments: final ? '{"done":true}' : delta.delta };
    }
    default: {
      throw new Error('Unknown sparse fixture');
    }
  }
}

test.each(sparseDeltas)('keeps valid unscaffolded $type observable over direct WS input', (delta) => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const created: ResponseStreamEvent = { type: 'response.created', sequence_number: 0, response: response() };
  const original = structuredClone(delta);
  accumulator.add(created);
  accumulator.add(delta);
  expect(delta).toEqual(original);
  // This direct caller-fed WS assertion is independent of the strict SSE helper.
  expect(accumulator.current?.phase).toBe('provisional');
  const fields = expectedFields(delta, false);
  expect(accumulator.current).toMatchObject({
    partialOutput: [{ output_index: 4, item_id: delta.item_id, ...fields }],
  });
  expect(accumulator.outputAt(4)).toBeUndefined();
});

test('exposes unscaffolded text in the public provisional aggregate', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  for (const event of sparseDeltas.slice(0, 1)) {
    accumulator.add(event);
  }
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    snapshot: { output_text: 'partial text' },
  });
});

test.each(['queued', 'in_progress'] as const)('refreshes valid response-bearing %s metadata', (status) => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const initial = response('queued');
  initial.metadata = { revision: 'before' };
  const refreshed = response(status);
  const event: ResponseStreamEvent =
    status === 'queued'
      ? { type: 'response.queued', sequence_number: 1, response: refreshed }
      : { type: 'response.in_progress', sequence_number: 1, response: refreshed };
  accumulator.add({ type: 'response.created', sequence_number: 0, response: initial });
  const prior = accumulator.current;
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(prior).toMatchObject({ snapshot: { metadata: { revision: 'before' } } });
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    snapshot: { status, metadata: { revision: status } },
  });
});

function done(delta: SparseDelta): ResponseStreamEvent {
  const common = { sequence_number: 2, output_index: 4, item_id: delta.item_id };
  switch (delta.type) {
    case 'response.output_text.delta': {
      return {
        ...common,
        type: 'response.output_text.done',
        content_index: 2,
        text: 'done text',
        logprobs: [],
      };
    }
    case 'response.refusal.delta': {
      return { ...common, type: 'response.refusal.done', content_index: 2, refusal: 'done refusal' };
    }
    case 'response.function_call_arguments.delta': {
      return { ...common, type: 'response.function_call_arguments.done', arguments: '{"done":true}' };
    }
    case 'response.custom_tool_call_input.delta': {
      return { ...common, type: 'response.custom_tool_call_input.done', input: 'done input' };
    }
    case 'response.mcp_call_arguments.delta': {
      return { ...common, type: 'response.mcp_call_arguments.done', arguments: '{"done":true}' };
    }
    default: {
      throw new Error('Unknown sparse fixture');
    }
  }
}

function fullItem(delta: SparseDelta): ResponseOutputItem {
  switch (delta.type) {
    case 'response.output_text.delta':
    case 'response.refusal.delta': {
      return {
        type: 'message',
        id: delta.item_id,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'full item text', annotations: [], logprobs: [] }],
      };
    }
    case 'response.function_call_arguments.delta': {
      return {
        type: 'function_call',
        id: delta.item_id,
        call_id: 'call_fixture',
        name: 'fixture_tool',
        arguments: '{"full":true}',
      };
    }
    case 'response.custom_tool_call_input.delta': {
      return {
        type: 'custom_tool_call',
        id: delta.item_id,
        call_id: 'call_fixture',
        name: 'fixture_tool',
        input: 'full item input',
      };
    }
    case 'response.mcp_call_arguments.delta': {
      return {
        type: 'mcp_call',
        id: delta.item_id,
        server_label: 'fixture_server',
        name: 'fixture_tool',
        arguments: '{"full":true}',
        status: 'completed',
        output: null,
        error: null,
      };
    }
    default: {
      throw new Error('Unknown sparse fixture');
    }
  }
}

test.each(sparseDeltas)('keeps done/full-item/terminal authority distinct for $type', (delta) => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  accumulator.add(delta);
  const prior = accumulator.current;
  const finalField = done(delta);
  const originalDone = structuredClone(finalField);
  accumulator.add(finalField);
  expect(finalField).toEqual(originalDone);
  const fields = expectedFields(delta, true);
  expect(accumulator.current).toMatchObject({
    partialOutput: [{ output_index: 4, item_id: delta.item_id, ...fields }],
  });
  const other: ResponseStreamEvent = {
    type: 'response.output_text.delta',
    sequence_number: 3,
    output_index: 8,
    content_index: 1,
    item_id: 'msg_other',
    delta: 'other text',
    logprobs: [],
  };
  accumulator.add(other);
  const item = Object.assign(fullItem(delta), { future_optional: null });
  const full: ResponseStreamEvent = {
    type: 'response.output_item.done',
    sequence_number: 4,
    output_index: 4,
    item,
  };
  const rawFull = structuredClone(full);
  accumulator.add(full);
  expect(full).toEqual(rawFull);
  expect(accumulator.outputAt(4)).toEqual(item);
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    snapshot: { output: [item], output_text: `${item.type === 'message' ? 'full item text' : ''}other text` },
    partialOutput: [{ output_index: 8, item_id: 'msg_other' }],
  });
  expect(prior).not.toEqual(accumulator.current);
  expect(prior).toMatchObject({ partialOutput: [{ output_index: 4, item_id: delta.item_id }] });
  const terminal: ResponseStreamEvent = {
    type: 'response.completed',
    sequence_number: 5,
    response: response('completed'),
  };
  accumulator.add(terminal);
  expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
  accumulator.add({ type: 'response.queued', sequence_number: 6, response: response('queued') });
  accumulator.add({ type: 'response.in_progress', sequence_number: 7, response: response() });
  expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
  expect(accumulator.outputAt(4)).toBeUndefined();
  accumulator.reset();
  expect(accumulator.current).toBeUndefined();
});

test('orders sparse wire indices without allocating missing positions', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  for (const [outputIndex, itemID, text] of [
    [Number.MAX_SAFE_INTEGER, 'msg_high', 'high'],
    [7, 'msg_middle', 'middle'],
    [0, 'msg_low', 'low'],
  ] as const) {
    const event: ResponseStreamEvent = {
      type: 'response.output_text.delta',
      sequence_number: 1,
      output_index: outputIndex,
      content_index: Number.MAX_SAFE_INTEGER,
      item_id: itemID,
      delta: text,
      logprobs: [],
    };
    accumulator.add(event);
  }
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    snapshot: { output: [], output_text: 'lowmiddlehigh' },
    partialOutput: [{ output_index: 0 }, { output_index: 7 }, { output_index: Number.MAX_SAFE_INTEGER }],
  });
});

test('replaces only matching sparse content observations with actual part data', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const events: ResponseStreamEvent[] = [
    { type: 'response.created', sequence_number: 0, response: response() },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 4,
      item: { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'in_progress', content: [] },
    },
    {
      type: 'response.output_text.delta',
      sequence_number: 2,
      output_index: 4,
      content_index: 3,
      item_id: 'msg_fixture',
      delta: 'draft',
      logprobs: [],
    },
    {
      type: 'response.output_text.delta',
      sequence_number: 3,
      output_index: 4,
      content_index: 5,
      item_id: 'msg_fixture',
      delta: 'tail',
      logprobs: [],
    },
  ];
  for (const event of events) {
    accumulator.add(event);
  }
  const saved = accumulator.current;
  const part = {
    type: 'output_text' as const,
    text: 'part authority',
    annotations: [],
    logprobs: [],
    future_optional: null,
  };
  const event: ResponseStreamEvent = {
    type: 'response.content_part.done',
    sequence_number: 4,
    output_index: 4,
    content_index: 3,
    item_id: 'msg_fixture',
    part,
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(accumulator.current).toMatchObject({
    snapshot: { output_text: 'part authoritytail' },
    partialOutput: [
      {
        output_index: 4,
        content: [
          { content_index: 3, data: part },
          { content_index: 5, data: { text: 'tail' } },
        ],
      },
    ],
  });
  expect(saved).toMatchObject({ snapshot: { output_text: 'drafttail' } });
  accumulator.add({
    type: 'response.content_part.added',
    sequence_number: 5,
    output_index: 4,
    content_index: 0,
    item_id: 'msg_fixture',
    part: { type: 'output_text', text: 'prefix', annotations: [], logprobs: [] },
  });
  expect(accumulator.current).toMatchObject({ snapshot: { output_text: 'prefixpart authoritytail' } });
});

test.each([0, 2])('does not invent shell outcomes or absent stderr for command %i', (commandIndex) => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const outputIndex = commandIndex === 0 ? 0 : 1;
  const item: ResponseOutputItem = {
    type: 'shell_call_output',
    id: 'shell_out_fixture',
    call_id: 'call_shell_fixture',
    max_output_length: null,
    status: 'in_progress',
    output: [],
  };
  const frames: ResponseStreamEvent[] = [
    { type: 'response.created', sequence_number: 0, response: response() },
  ];
  if (commandIndex > 0) {
    frames.push({
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: {
        type: 'shell_call',
        id: 'shell_fixture',
        call_id: 'call_shell_fixture',
        environment: null,
        status: 'in_progress',
        action: {
          commands: ['fixture a', 'fixture b', 'fixture c'],
          max_output_length: null,
          timeout_ms: null,
        },
      },
    });
  }
  frames.push({ type: 'response.output_item.added', sequence_number: 2, output_index: outputIndex, item });
  const delta: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: outputIndex,
    item_id: 'shell_out_fixture',
    command_index: commandIndex,
    delta: { stdout: 'partial stdout' },
  };
  const raw = structuredClone(delta);
  for (const frame of frames) {
    accumulator.add(frame);
  }
  accumulator.add(delta);
  expect(delta).toEqual(raw);
  expect(accumulator.outputAt(outputIndex)).not.toHaveProperty('output.0.outcome');
  expect(accumulator.outputAt(outputIndex)).toEqual(item);
  expect(accumulator.current).not.toHaveProperty('partialOutput.0.commands.0.data.stderr');
  expect(accumulator.current).not.toHaveProperty('partialOutput.0.commands.0.data.outcome');
  expect(accumulator.current).toMatchObject({
    partialOutput: [
      {
        output_index: outputIndex,
        item_id: 'shell_out_fixture',
        commands: [{ command_index: commandIndex, data: { stdout: 'partial stdout' } }],
      },
    ],
  });
});

test.each([0, 2])('preserves complete per-command shell done metadata at command %i', (commandIndex) => {
  const accumulator = shellAccumulator(['fixture a', 'fixture b', 'fixture c']);
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: commandIndex,
    delta: { stdout: 'draft' },
  });
  const prior = accumulator.current;
  const saved = structuredClone(prior);
  const completed = {
    stdout: 'done stdout',
    stderr: 'done stderr',
    outcome: { type: 'exit' as const, exit_code: 7 },
    created_by: 'fixture_actor',
    future_optional: null,
  };
  const doneFrame: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 4,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: commandIndex,
    output: [completed],
  };
  const raw = structuredClone(doneFrame);
  accumulator.add(doneFrame);
  expect(doneFrame).toEqual(raw);
  expect(prior).toEqual(saved);
  expect(accumulator.outputAt(1)).toEqual(shellOutput());
  expect(accumulator.current).toMatchObject({
    partialOutput: [
      { output_index: 1, commands: [{ command_index: commandIndex, data: { output: [completed] } }] },
    ],
  });
  const full: ResponseOutputItem = {
    ...shellOutput(),
    status: 'completed',
    output: Array.from({ length: 3 }, (_, index) => ({
      stdout: `full command ${index}`,
      stderr: '',
      outcome: { type: 'exit' as const, exit_code: 9 },
    })),
  };
  accumulator.add({ type: 'response.output_item.done', sequence_number: 5, output_index: 1, item: full });
  expect(accumulator.outputAt(1)).toEqual(full);
  expect(accumulator.current).not.toHaveProperty('partialOutput');
});

test('retains shell command bounds when a matching call exists', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 1,
    output_index: 0,
    item: {
      type: 'shell_call',
      id: 'shell_fixture',
      call_id: 'call_shell_fixture',
      environment: null,
      status: 'in_progress',
      action: { commands: ['fixture command'], max_output_length: null, timeout_ms: null },
    },
  });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 2,
    output_index: 1,
    item: {
      type: 'shell_call_output',
      id: 'shell_out_fixture',
      call_id: 'call_shell_fixture',
      status: 'in_progress',
      max_output_length: null,
      output: [],
    },
  });
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 1,
    delta: { stdout: 'outside known command list' },
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(accumulator.current?.phase).toBe('unavailable');
});

test.each(['item ID', 'item kind', 'stream ID'] as const)(
  'retains %s guards after admitting sparse progress',
  (mismatch) => {
    const accumulator = new ResponsesWebSocketAccumulator();
    accumulator.add({
      type: 'response.created',
      sequence_number: 0,
      response: response(),
      stream_id: 'first',
    });
    accumulator.add({
      type: 'response.function_call_arguments.delta',
      sequence_number: 1,
      output_index: 4,
      item_id: 'fn_fixture',
      delta: 'draft',
      stream_id: 'first',
    });
    const prior = accumulator.current;
    const saved = structuredClone(prior);
    if (mismatch === 'item kind') {
      accumulator.add({
        type: 'response.custom_tool_call_input.delta',
        sequence_number: 2,
        output_index: 4,
        item_id: 'fn_fixture',
        delta: 'wrong kind',
        stream_id: 'first',
      });
    } else {
      accumulator.add({
        type: 'response.function_call_arguments.delta',
        sequence_number: 2,
        output_index: 4,
        item_id: mismatch === 'item ID' ? 'fn_other' : 'fn_fixture',
        delta: 'wrong identity',
        stream_id: mismatch === 'stream ID' ? 'other' : 'first',
      });
    }
    expect(accumulator.current?.phase).toBe('unavailable');
    expect(prior).toEqual(saved);
  },
);

test('keeps observations on a WS metadata refresh with omitted output and replaces them with an actual output array', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response('queued') });
  accumulator.add({
    type: 'response.output_text.delta',
    sequence_number: 1,
    output_index: 4,
    content_index: 2,
    item_id: 'msg_fixture',
    delta: 'kept text',
    logprobs: [],
  });
  const { output, output_text: outputText, ...metadata } = response();
  void output;
  void outputText;
  const refresh = {
    type: 'response.in_progress',
    sequence_number: 2,
    response: { ...metadata, future_optional: null },
  };
  accumulator.add(refresh);
  expect(accumulator.current).toMatchObject({
    snapshot: { metadata: { revision: 'in_progress' }, future_optional: null, output_text: 'kept text' },
    partialOutput: [{ output_index: 4 }],
  });
  accumulator.add({ type: 'response.in_progress', sequence_number: 3, response: response() });
  expect(accumulator.current).toMatchObject({ snapshot: { output: [], output_text: '' } });
  expect(accumulator.current).not.toHaveProperty('partialOutput');
});

test.each(sparseDeltas)('admits delta-first $type without inventing response metadata', (delta) => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const raw = structuredClone(delta);
  accumulator.add(delta);
  const observed = accumulator.current;
  expect(delta).toEqual(raw);
  expect(observed?.phase).toBe('provisional');
  if (observed?.phase !== 'provisional') {
    throw new Error('Expected observed facts');
  }
  expect(Object.keys(observed.snapshot)).toHaveLength(2);
  expect(Object.keys(observed.snapshot)).toEqual(expect.arrayContaining(['output', 'output_text']));
  expect(observed.partialOutput).toMatchObject([{ output_index: 4, item_id: delta.item_id }]);
  expect(observed.partialOutput?.[0]).not.toHaveProperty('type');
  expect(observed.partialOutput?.[0]).not.toHaveProperty('name');
  accumulator.add(done(delta));
  const item = fullItem(delta);
  accumulator.add({ type: 'response.output_item.done', sequence_number: 3, output_index: 4, item });
  expect(accumulator.outputAt(4)).toEqual(item);
  expect(accumulator.current).not.toHaveProperty('partialOutput');
  expect(accumulator.current).not.toHaveProperty('snapshot.id');
  const terminal: ResponseStreamEvent = {
    type: 'response.completed',
    sequence_number: 4,
    response: response('completed'),
  };
  accumulator.add(terminal);
  expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
});

test('accepts an actual full item first without inventing response metadata', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const item: ResponseOutputItem = {
    type: 'function_call',
    id: 'fn_fixture',
    call_id: 'call_fixture',
    name: 'fixture_tool',
    arguments: '{"actual":true}',
  };
  const event: ResponseStreamEvent = {
    type: 'response.output_item.done',
    sequence_number: 0,
    output_index: 7,
    item,
  };
  const original = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(original);
  expect(accumulator.outputAt(7)).toEqual(item);
  expect(accumulator.current).toEqual({
    phase: 'provisional',
    snapshot: { output: [item], output_text: '' },
  });
});

test('an invalid initial event stays unavailable until creation or terminal authority', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({
    type: 'response.output_text.delta',
    sequence_number: 0,
    output_index: -1,
    content_index: 0,
    item_id: 'msg_fixture',
    delta: 'invalid index',
    logprobs: [],
  });
  expect(accumulator.current?.phase).toBe('unavailable');
  accumulator.add({
    type: 'response.output_text.delta',
    sequence_number: 1,
    output_index: 0,
    content_index: 0,
    item_id: 'msg_fixture',
    delta: 'valid next event',
    logprobs: [],
  });
  accumulator.add({ type: 'response.in_progress', sequence_number: 2, response: response() });
  expect(accumulator.current?.phase).toBe('unavailable');
  accumulator.add({ type: 'response.created', sequence_number: 3, response: response() });
  expect(accumulator.current?.phase).toBe('provisional');
});

test.each(['function_call', 'custom_tool_call'] as const)(
  'keeps tool fields when an optional platform ID is absent on %s',
  (kind) => {
    const accumulator = new ResponsesWebSocketAccumulator();
    const item: ResponseOutputItem =
      kind === 'function_call'
        ? { type: 'function_call', call_id: 'call_fixture', name: 'fixture_tool', arguments: '{"seed":' }
        : { type: 'custom_tool_call', call_id: 'call_fixture', name: 'fixture_tool', input: 'seed' };
    const originalItem = structuredClone(item);
    accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
    accumulator.add({ type: 'response.output_item.added', sequence_number: 1, output_index: 0, item });
    const event: ResponseStreamEvent =
      kind === 'function_call'
        ? {
            type: 'response.function_call_arguments.delta',
            sequence_number: 2,
            output_index: 0,
            item_id: 'platform_fixture',
            delta: 'true}',
          }
        : {
            type: 'response.custom_tool_call_input.delta',
            sequence_number: 2,
            output_index: 0,
            item_id: 'platform_fixture',
            delta: '+delta',
          };
    const raw = structuredClone(event);
    accumulator.add(event);
    expect(event).toEqual(raw);
    expect(item).toEqual(originalItem);
    expect(accumulator.current?.phase).toBe('provisional');
    const fields = kind === 'function_call' ? { arguments: '{"seed":true}' } : { input: 'seed+delta' };
    expect(accumulator.current).toMatchObject({
      snapshot: { output: [{ ...item, ...fields }] },
      partialOutput: [{ output_index: 0, item_id: 'platform_fixture', ...fields }],
    });
    expect(accumulator.outputAt(0)).toEqual({ ...item, ...fields });
    expect(accumulator.outputAt(0)).not.toHaveProperty('id');
    const prior = accumulator.current;
    const saved = structuredClone(prior);
    const doneFrame: ResponseStreamEvent =
      kind === 'function_call'
        ? {
            type: 'response.function_call_arguments.done',
            sequence_number: 3,
            output_index: 0,
            item_id: 'platform_fixture',
            arguments: '{"done":true}',
          }
        : {
            type: 'response.custom_tool_call_input.done',
            sequence_number: 3,
            output_index: 0,
            item_id: 'platform_fixture',
            input: 'done input',
          };
    accumulator.add(doneFrame);
    const doneFields = kind === 'function_call' ? { arguments: '{"done":true}' } : { input: 'done input' };
    expect(accumulator.outputAt(0)).toEqual({ ...item, ...doneFields });
    expect(accumulator.current).toMatchObject({ snapshot: { output: [{ ...item, ...doneFields }] } });
    expect(prior).toEqual(saved);
    const full: ResponseOutputItem =
      kind === 'function_call'
        ? { ...item, type: 'function_call', id: 'platform_fixture', arguments: '{"full":true}' }
        : { ...item, type: 'custom_tool_call', id: 'platform_fixture', input: 'full input' };
    accumulator.add({ type: 'response.output_item.done', sequence_number: 4, output_index: 0, item: full });
    expect(accumulator.outputAt(0)).toEqual(full);
    expect(accumulator.current).not.toHaveProperty('partialOutput');
    expect(item).toEqual(originalItem);
  },
);

test.each(['full item', 'lifecycle'] as const)('refreshes cached shell bounds after %s authority', (mode) => {
  const accumulator = shellAccumulator(['first', 'second', 'third']);
  for (let index = 0; index < 256; index += 1) {
    accumulator.add({
      type: 'response.shell_call_output_content.delta',
      sequence_number: index + 3,
      output_index: 1,
      item_id: 'shell_out_fixture',
      command_index: 2,
      delta: { stdout: 'x' },
    });
  }
  const prior = accumulator.current;
  const saved = structuredClone(prior);
  expect(prior).toMatchObject({
    partialOutput: [{ commands: [{ command_index: 2, data: { stdout: 'x'.repeat(256) } }] }],
  });
  if (mode === 'full item') {
    accumulator.add({
      type: 'response.output_item.done',
      sequence_number: 300,
      output_index: 0,
      item: shellCall(['only']),
    });
  } else {
    accumulator.add({
      type: 'response.in_progress',
      sequence_number: 300,
      response: { ...response(), output: [shellCall(['only']), shellOutput()] },
    });
  }
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.delta',
    sequence_number: 301,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 2,
    delta: { stdout: 'outside refreshed bounds' },
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(prior).toEqual(saved);
  expect(accumulator.current?.phase).toBe('unavailable');
});

test('refreshes cached bounds when a shell command is appended', () => {
  const accumulator = shellAccumulator(['first']);
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 0,
    delta: { stdout: 'first' },
  });
  accumulator.add({
    type: 'response.shell_call_command.added',
    sequence_number: 4,
    output_index: 0,
    item_id: 'shell_fixture',
    command_index: 1,
    command: 'second',
  });
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 5,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 1,
    delta: { stdout: 'second' },
  });
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    partialOutput: [
      {
        commands: [
          { command_index: 0, data: { stdout: 'first' } },
          { command_index: 1, data: { stdout: 'second' } },
        ],
      },
    ],
  });
});

test('invalidates absent shell bounds when the actual call arrives', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 1,
    output_index: 0,
    item: shellOutput(),
  });
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 2,
    output_index: 0,
    item_id: 'shell_out_fixture',
    command_index: 0,
    delta: { stdout: 'first' },
  });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 3,
    output_index: 1,
    item: shellCall(['only']),
  });
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 4,
    output_index: 0,
    item_id: 'shell_out_fixture',
    command_index: 1,
    delta: { stdout: 'outside actual bounds' },
  });
  expect(accumulator.current?.phase).toBe('unavailable');
  accumulator.reset();
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 5,
    output_index: 0,
    item: shellOutput(),
  });
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 6,
    output_index: 0,
    item_id: 'shell_out_fixture',
    command_index: 0,
    delta: { stdout: 'next turn' },
  });
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    partialOutput: [{ commands: [{ data: { stdout: 'next turn' } }] }],
  });
});

type ShellChunk = Extract<
  ResponseStreamEvent,
  { type: 'response.shell_call_output_content.done' }
>['output'][number] & { future_optional: null | boolean };

function shellChunks(): ShellChunk[] {
  return [
    {
      stdout: 'chunk a',
      stderr: 'error a',
      outcome: { type: 'exit' as const, exit_code: 7 },
      created_by: 'fixture_actor_a',
      future_optional: null,
    },
    {
      stdout: 'chunk b',
      stderr: 'error b',
      outcome: { type: 'exit' as const, exit_code: 11 },
      created_by: 'fixture_actor_b',
      future_optional: false,
    },
  ];
}

test('keeps all shell done chunks for one command without inferring flat placement', () => {
  const accumulator = shellAccumulator(['only']);
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 0,
    delta: { stdout: 'draft' },
  });
  const prior = accumulator.current;
  const saved = structuredClone(prior);
  const output = shellChunks();
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 4,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 0,
    output,
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(prior).toEqual(saved);
  expect(accumulator.outputAt(1)).toEqual(shellOutput());
  expect(accumulator.current).toMatchObject({
    partialOutput: [{ commands: [{ command_index: 0, data: { output } }] }],
  });
  expect(accumulator.current).not.toHaveProperty('partialOutput.0.commands.0.data.stdout');
});

test('keeps interleaved shell commands separate and replaces one complete chunk array', () => {
  const accumulator = shellAccumulator(['first', 'second', 'third', 'fourth']);
  const first: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 3,
    output: shellChunks(),
  };
  const second: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 4,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 1,
    output: shellChunks().slice(1),
  };
  accumulator.add(first);
  accumulator.add(second);
  const prior = accumulator.current;
  const saved = structuredClone(prior);
  const replacement: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 5,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 3,
    output: shellChunks().slice(0, 1),
  };
  const raw = structuredClone(replacement);
  accumulator.add(replacement);
  expect(replacement).toEqual(raw);
  expect(prior).toEqual(saved);
  expect(accumulator.current).toMatchObject({
    partialOutput: [
      {
        commands: [
          { command_index: 1, data: { output: second.output } },
          { command_index: 3, data: { output: replacement.output } },
        ],
      },
    ],
  });
  expect(accumulator.outputAt(1)).toEqual(shellOutput());
});

test('retains an authoritative empty shell done array', () => {
  const accumulator = shellAccumulator(['only']);
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 0,
    delta: { stderr: 'draft error' },
  });
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 4,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 0,
    output: [],
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    partialOutput: [{ commands: [{ command_index: 0, data: { output: [] } }] }],
  });
  expect(accumulator.current).not.toHaveProperty('partialOutput.0.commands.0.data.stderr');
});

test('retains sparse higher shell command facts when no companion call establishes a bound', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({ type: 'response.created', sequence_number: 0, response: response() });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 1,
    output_index: 0,
    item: shellOutput(),
  });
  accumulator.add({
    type: 'response.shell_call_output_content.delta',
    sequence_number: 2,
    output_index: 0,
    item_id: 'shell_out_fixture',
    command_index: 7,
    delta: { stdout: 'draft' },
  });
  const output = shellChunks();
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 3,
    output_index: 0,
    item_id: 'shell_out_fixture',
    command_index: 7,
    output,
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  expect(event).toEqual(raw);
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    partialOutput: [{ commands: [{ command_index: 7, data: { output } }] }],
  });
  expect(accumulator.outputAt(0)).toEqual(shellOutput());
});

test('keeps full shell item and terminal authority over per-command arrays', () => {
  const accumulator = shellAccumulator(['first', 'second']);
  const event: ResponseStreamEvent = {
    type: 'response.shell_call_output_content.done',
    sequence_number: 3,
    output_index: 1,
    item_id: 'shell_out_fixture',
    command_index: 1,
    output: shellChunks(),
  };
  const raw = structuredClone(event);
  accumulator.add(event);
  const prior = accumulator.current;
  const saved = structuredClone(prior);
  accumulator.add({
    type: 'response.output_text.delta',
    sequence_number: 4,
    output_index: 3,
    content_index: 0,
    item_id: 'msg_other',
    delta: 'other item',
    logprobs: [],
  });
  const full: ResponseOutputItem = { ...shellOutput(), status: 'completed', output: shellChunks().slice(1) };
  accumulator.add({ type: 'response.output_item.done', sequence_number: 5, output_index: 1, item: full });
  expect(event).toEqual(raw);
  expect(prior).toEqual(saved);
  expect(accumulator.outputAt(1)).toEqual(full);
  expect(accumulator.current).toMatchObject({ partialOutput: [{ output_index: 3 }] });
  const terminal: ResponseStreamEvent = {
    type: 'response.completed',
    sequence_number: 6,
    response: { ...response('completed'), output: [full] },
  };
  accumulator.add(terminal);
  expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
});

test.each(['function', 'mcp'] as const)(
  'uses the %s done discriminator rather than an unknown delta field',
  (kind) => {
    const accumulator = new ResponsesWebSocketAccumulator();
    const initial: ResponseStreamEvent =
      kind === 'function'
        ? {
            type: 'response.function_call_arguments.delta',
            sequence_number: 0,
            output_index: 4,
            item_id: 'tool_fixture',
            delta: '{"draft":',
          }
        : {
            type: 'response.mcp_call_arguments.delta',
            sequence_number: 0,
            output_index: 4,
            item_id: 'tool_fixture',
            delta: '{"draft":',
          };
    const frame: ResponseStreamEvent & { delta: string } =
      kind === 'function'
        ? {
            type: 'response.function_call_arguments.done',
            sequence_number: 1,
            output_index: 4,
            item_id: 'tool_fixture',
            arguments: '{"complete":true}',
            delta: 'unrelated future field',
          }
        : {
            type: 'response.mcp_call_arguments.done',
            sequence_number: 1,
            output_index: 4,
            item_id: 'tool_fixture',
            arguments: '{"complete":true}',
            delta: 'unrelated future field',
          };
    const raw = structuredClone(frame);
    accumulator.add(initial);
    accumulator.add(frame);
    expect(frame).toEqual(raw);
    expect(accumulator.current).toMatchObject({ partialOutput: [{ arguments: '{"complete":true}' }] });
  },
);
