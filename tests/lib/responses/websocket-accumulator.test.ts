import { expectTypeOf } from 'vitest';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import type { ResponsesWebSocketEvent } from 'openai/lib/responses/responses-websocket-session';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import { ResponsesWebSocketAccumulator } from 'openai/lib/responses/responses-websocket-accumulator';

test('raw WebSocket lifecycle and unscaffolded deltas are not SSE input', () => {
  expectTypeOf<ResponsesWebSocketEvent>().not.toExtend<ResponseStreamEvent>();
  const created = {
    type: 'response.created' as const,
    sequence_number: 0,
    response: { id: 'resp_partial', status: 'in_progress' as const },
  };
  // @ts-expect-error WebSocket responses can omit fields required by the SSE accumulator.
  expect(() => accumulateResponse(created)).toThrow();
  expect(() =>
    accumulateResponse({
      type: 'response.output_text.delta',
      sequence_number: 1,
      output_index: 0,
      content_index: 0,
      item_id: 'msg_missing',
      delta: 'Visible raw text',
      logprobs: [],
    }),
  ).toThrow("expected 'response.created'");
});

test('unvalidated provisional metadata remains raw until the terminal response arrives', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const created = {
    type: 'response.created',
    response: { id: 'r', metadata: { label: '', count: 0, include: false }, future_optional: null },
  };
  accumulator.add(created);
  accumulator.add({
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message', id: 'm', content: [], role: 1, status: { later: true } },
  });
  const state = accumulator.current;
  if (state?.phase !== 'provisional') {
    throw new Error('Expected provisional output');
  }
  expectTypeOf(state.snapshot.metadata).toEqualTypeOf<unknown>();
  expect(state.snapshot).toMatchObject({
    id: 'r',
    metadata: { label: '', count: 0, include: false },
    future_optional: null,
  });
  created.response.metadata.label = 'changed input';
  const returned = state.snapshot.metadata;
  if (returned && typeof returned === 'object' && 'label' in returned) {
    returned.label = 'changed snapshot';
  }
  expect(accumulator.current).toMatchObject({
    snapshot: { metadata: { label: '', count: 0, include: false } },
  });
  const [message] = state.snapshot.output;
  if (message?.type !== 'message') {
    throw new Error('Expected message');
  }
  expectTypeOf(message.role).toEqualTypeOf<unknown>();
  expectTypeOf(message.status).toEqualTypeOf<unknown>();
  expect(message).toEqual({ type: 'message', id: 'm', content: [], role: 1, status: { later: true } });
  const selected = accumulator.outputAt(0);
  if (selected?.type !== 'message') {
    throw new Error('Expected selected message');
  }
  expectTypeOf(selected.role).toEqualTypeOf<unknown>();
  expect(selected).toEqual(message);
  accumulator.reset();
  accumulator.add({ type: 'response.created', response: { id: 'without_metadata' } });
  const absent = accumulator.current;
  if (absent?.phase !== 'provisional') {
    throw new Error('Expected provisional output');
  }
  expect(absent.snapshot).not.toHaveProperty('metadata');
  accumulator.add({ type: 'response.created', response: { id: 'null_metadata', metadata: null } });
  expect(accumulator.current).toMatchObject({ snapshot: { id: 'null_metadata', metadata: null } });
});

test('reconstructs text and tool arguments as provisional data while leaving raw input detached', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const created = { type: 'response.created', response: { id: 'resp_partial' } };
  accumulator.add(created);
  const message = {
    type: 'response.output_item.added',
    sequence_number: 1,
    output_index: 0,
    item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] },
  };
  accumulator.add(message);
  accumulator.add({
    type: 'response.content_part.added',
    sequence_number: 2,
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
  });
  accumulator.add({
    type: 'response.output_text.delta',
    sequence_number: 3,
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
    delta: 'Interim',
    logprobs: [],
  });
  accumulator.add({
    type: 'response.output_item.added',
    sequence_number: 4,
    output_index: 1,
    item: { type: 'function_call', id: 'fc_1', name: 'never_execute', call_id: 'call_1', arguments: '' },
  });
  accumulator.add({
    type: 'response.function_call_arguments.delta',
    sequence_number: 5,
    item_id: 'fc_1',
    output_index: 1,
    delta: '{"value":',
  });
  accumulator.add({
    type: 'response.function_call_arguments.delta',
    sequence_number: 6,
    item_id: 'fc_1',
    output_index: 1,
    delta: '5}',
  });
  const snapshot = accumulator.current;
  expect(snapshot).toMatchObject({
    phase: 'provisional',
    snapshot: {
      output_text: 'Interim',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Interim' }] },
        { type: 'function_call', name: 'never_execute', arguments: '{"value":5}' },
      ],
    },
  });
  expect(message.item.content).toEqual([]);
  expect(created.response).toEqual({ id: 'resp_partial' });
  if (snapshot?.phase !== 'provisional') {
    throw new Error('Expected provisional output');
  }
  snapshot.snapshot.output.length = 0;
  expect(accumulator.current).toMatchObject({ snapshot: { output: [{ id: 'msg_1' }, { id: 'fc_1' }] } });
  const firstItem = accumulator.outputAt(0);
  expect(firstItem).toMatchObject({ id: 'msg_1', type: 'message' });
  expect(accumulator.outputAt(1)).toMatchObject({ id: 'fc_1', type: 'function_call' });
  expect(accumulator.outputAt(-1)).toBeUndefined();
  expect(accumulator.outputAt(0.5)).toBeUndefined();
  expect(accumulator.outputAt(2)).toBeUndefined();
  if (firstItem?.type !== 'message' || !Array.isArray(firstItem.content)) {
    throw new Error('Expected message content');
  }
  expect(accumulator.outputAt(0, { content_index: 0 })).toEqual(firstItem.content[0]);
  expect(accumulator.outputAt(0, { summary_index: 0 })).toBeUndefined();
  expect(accumulator.outputAt(1, { content_index: 0 })).toBeUndefined();
  firstItem.content.length = 0;
  expect(accumulator.outputAt(0)).not.toEqual(firstItem);
  accumulator.reset();
  expect(accumulator.outputAt(0)).toBeUndefined();
});

test('reading a reasoning part keeps earlier parts detached without materializing every summary', () => {
  const acc = new ResponsesWebSocketAccumulator();
  acc.add({ type: 'response.created', response: { id: 'r', output: [] } });
  acc.add({
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'reasoning', id: 'reason', summary: [] },
  });
  for (let i = 0; i < 3; i += 1) {
    acc.add({
      type: 'response.reasoning_summary_part.added',
      item_id: 'reason',
      output_index: 0,
      summary_index: i,
      part: { type: 'summary_text', text: String(i) },
    });
  }
  const retained = acc.outputAt(0, { summary_index: 0 });
  expect(retained).toEqual({ type: 'summary_text', text: '0' });
  acc.add({
    type: 'response.reasoning_summary_text.delta',
    item_id: 'reason',
    output_index: 0,
    summary_index: 0,
    delta: ' then',
  });
  expect(retained).toEqual({ type: 'summary_text', text: '0' });
  expect(acc.outputAt(0, { summary_index: 0 })).toEqual({ type: 'summary_text', text: '0 then' });
  if (retained && typeof retained === 'object' && 'text' in retained) {
    retained.text = 'caller';
  }
  expect(acc.outputAt(0, { summary_index: 0 })).toMatchObject({ text: '0 then' });
  expect(acc.outputAt(0, { summary_index: -1 })).toBeUndefined();
  expect(acc.outputAt(0, { summary_index: 3 })).toBeUndefined();
});

test('reads and replaces just the changed annotation without copying its siblings', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  accumulator.add({
    type: 'response.created',
    response: {
      id: 'r',
      output: [
        { type: 'message', id: 'm', content: [{ type: 'output_text', text: 'answer', annotations: [] }] },
        {
          type: 'reasoning',
          id: 'reason',
          content: [{ type: 'reasoning_text', text: 'thinking' }],
          summary: [],
        },
      ],
    },
  });
  const select = (annotation_index: number) =>
    accumulator.outputAt(0, { content_index: 0, annotation_index });
  let retained: unknown;
  for (let index = 0; index < 32; index += 1) {
    const annotation = {
      type: 'url_citation',
      url: `https://example.test/${index}`,
      title: `Source ${index}`,
    };
    accumulator.add({
      type: 'response.output_text.annotation.added',
      output_index: 0,
      item_id: 'm',
      content_index: 0,
      annotation_index: index,
      annotation,
    });
    expect(select(index)).toEqual(annotation);
    if (index === 0) {
      retained = select(index);
    }
  }
  expect(select(-1)).toBeUndefined();
  expect(select(0.5)).toBeUndefined();
  expect(select(32)).toBeUndefined();
  expect(accumulator.outputAt(1, { content_index: 0, annotation_index: 0 })).toBeUndefined();
  accumulator.add({
    type: 'response.output_text.annotation.added',
    output_index: 0,
    item_id: 'm',
    content_index: 0,
    annotation_index: 0,
    annotation: { type: 'file_citation', file_id: 'file_new' },
  });
  expect(retained).toEqual({ type: 'url_citation', url: 'https://example.test/0', title: 'Source 0' });
  expect(select(0)).toEqual({ type: 'file_citation', file_id: 'file_new' });
  const selected = select(0);
  if (selected && typeof selected === 'object' && 'file_id' in selected) {
    selected.file_id = 'caller';
  }
  expect(select(0)).toEqual({ type: 'file_citation', file_id: 'file_new' });
  expect(select(31)).toMatchObject({ url: 'https://example.test/31' });
  accumulator.add({ type: 'response.completed', response: { id: 'r', output: [] } });
  expect(select(0)).toBeUndefined();
});

test.each(['response.completed', 'response.failed', 'response.incomplete', 'error'])(
  '%s always retains the exact terminal payload after incomplete deltas',
  (type) => {
    const accumulator = new ResponsesWebSocketAccumulator();
    accumulator.add({ type: 'response.created', response: { id: 'resp_a' } });
    accumulator.add({
      type: 'response.output_text.delta',
      item_id: 'msg_missing',
      output_index: 0,
      content_index: 0,
      delta: 'Must not be a final output',
    });
    expect(accumulator.current?.phase).toBe('unavailable');
    expect(accumulator.outputAt(0)).toBeUndefined();
    const terminal: ResponsesWebSocketEvent =
      type === 'error'
        ? { type, error: { message: 'synthetic rejection' }, stream_id: 'a' }
        : { type, response: { id: 'resp_a', status: type.slice(9), custom: 'kept' }, stream_id: 'a' };
    accumulator.add(terminal);
    expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
    expect(accumulator.outputAt(0)).toBeUndefined();
    accumulator.add({ type: 'keepalive', sequence_number: 7 });
    accumulator.add({ type: 'response.compaction.compacting', sequence_number: 8 });
    expect(accumulator.current).toEqual({ phase: 'terminal', event: terminal });
    accumulator.reset();
    expect(accumulator.current).toBeUndefined();
  },
);

test('one accumulator per lane isolates state, permits unknown events, and accepts an authoritative empty terminal', () => {
  const first = new ResponsesWebSocketAccumulator();
  const second = new ResponsesWebSocketAccumulator();
  first.add({ type: 'response.created', response: { id: 'first' }, stream_id: 'first' });
  second.add({ type: 'response.created', response: { id: 'second' }, stream_id: 'second' });
  first.add({
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'function_call', id: 'first_tool', call_id: 'call_a', name: 'as_data', arguments: '{}' },
    stream_id: 'first',
  });
  first.add({ type: 'response.future_event', payload: { untouched: true } });
  expect(first.current).toMatchObject({ phase: 'provisional', snapshot: { output: [{ id: 'first_tool' }] } });
  expect(second.current).toEqual({
    phase: 'provisional',
    snapshot: { id: 'second', output: [], output_text: '' },
  });
  const terminal = { type: 'response.completed', response: { id: 'first', output: [], output_text: '' } };
  first.add(terminal);
  expect(first.current).toEqual({ phase: 'terminal', event: terminal });
  expect(second.current?.phase).toBe('provisional');
});

test('derives omitted initial output text but respects explicitly supplied text', () => {
  const accumulator = new ResponsesWebSocketAccumulator();
  const output = [
    {
      type: 'message',
      id: 'msg_seed',
      role: 'assistant',
      status: 'in_progress',
      content: [{ type: 'output_text', text: 'Seeded content', annotations: [] }],
    },
  ];
  accumulator.add({ type: 'response.created', response: { id: 'seeded', output } });
  expect(accumulator.current).toMatchObject({
    phase: 'provisional',
    snapshot: { output_text: 'Seeded content' },
  });
  accumulator.add({ type: 'response.created', response: { id: 'supplied', output, output_text: '' } });
  expect(accumulator.current).toMatchObject({ phase: 'provisional', snapshot: { output_text: '' } });
});

test.each(['Server override', ''])(
  'keeps explicit initial text %j until a message actually changes its contribution',
  (outputText) => {
    const accumulator = new ResponsesWebSocketAccumulator();
    accumulator.add({
      type: 'response.created',
      response: {
        id: 'r',
        output_text: outputText,
        output: [{ type: 'message', id: 'seed', content: [{ type: 'output_text', text: 'seed' }] }],
      },
    });
    const unchanged: ResponsesWebSocketEvent[] = [
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'message', id: 'm', role: 'assistant', status: 'in_progress', content: [] },
      },
      {
        type: 'response.content_part.added',
        output_index: 1,
        content_index: 0,
        item_id: 'm',
        part: { type: 'output_text', text: '', annotations: [] },
      },
      {
        type: 'response.output_text.delta',
        output_index: 1,
        content_index: 0,
        item_id: 'm',
        delta: '',
      },
      {
        type: 'response.output_text.done',
        output_index: 1,
        content_index: 0,
        item_id: 'm',
        text: '',
      },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: {
          type: 'message',
          id: 'm',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: '', annotations: [] }],
        },
      },
    ];
    for (const event of unchanged) {
      accumulator.add(event);
      expect(accumulator.current).toMatchObject({
        phase: 'provisional',
        snapshot: { output_text: outputText },
      });
    }
    accumulator.add({
      type: 'response.output_item.added',
      output_index: 2,
      item: { type: 'message', id: 'real', content: [{ type: 'output_text', text: ' answer' }] },
    });
    expect(accumulator.current).toMatchObject({
      phase: 'provisional',
      snapshot: { output_text: 'seed answer', output: [{ id: 'seed' }, { id: 'm' }, { id: 'real' }] },
    });
  },
);

test('preserves explicit output_text across non-message completion as SSE does', () => {
  const initial: Response = {
    id: 'resp_scaffold',
    object: 'response',
    access_programs: null,
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output: [{ type: 'function_call', id: 'fc_match', name: 'tool', call_id: 'call_match', arguments: '' }],
    output_text: 'Explicit server text',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
  const events: ResponseStreamEvent[] = [
    { type: 'response.created', sequence_number: 0, response: initial },
    {
      type: 'response.output_item.done',
      sequence_number: 1,
      output_index: 0,
      item: { type: 'function_call', id: 'fc_match', name: 'tool', call_id: 'call_match', arguments: '{}' },
    },
  ];
  const socket = new ResponsesWebSocketAccumulator();
  let sse: Response | undefined;
  for (const event of events) {
    sse = accumulateResponse(event, sse);
    socket.add(event);
    expect(socket.current).toEqual({
      phase: 'provisional',
      snapshot: sse,
    });
  }
});

test('shared scaffolded events produce identical provisional output over SSE and WebSocket', () => {
  const firstLogprob = {
    token: 'こんにちは',
    bytes: [227, 129, 147],
    logprob: -0.1,
    top_logprobs: [{ token: 'はい', bytes: [227, 129, 175], logprob: -2 }],
    future_optional: null,
  };
  const lastLogprob = { token: '!', bytes: [33], logprob: -0.2, top_logprobs: [] };
  const initial: Response = {
    id: 'resp_scaffold',
    object: 'response',
    access_programs: null,
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: { test_id: 'current_model_logprobs', optional: '' },
    model: 'gpt-5',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
  const events: ResponseStreamEvent[] = [
    { type: 'response.created', sequence_number: 0, response: initial },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { type: 'message', id: 'msg_match', role: 'assistant', status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      sequence_number: 2,
      item_id: 'msg_match',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
    },
    {
      type: 'response.output_text.delta',
      sequence_number: 3,
      item_id: 'msg_match',
      output_index: 0,
      content_index: 0,
      delta: 'こんにちは',
      logprobs: [firstLogprob],
    },
    {
      type: 'response.output_text.delta',
      sequence_number: 4,
      item_id: 'msg_match',
      output_index: 0,
      content_index: 0,
      delta: '!',
      logprobs: [lastLogprob],
    },
    {
      type: 'response.output_text.done',
      sequence_number: 5,
      item_id: 'msg_match',
      output_index: 0,
      content_index: 0,
      text: 'Final',
      // The final set is deliberately different: done is authoritative, not another delta.
      logprobs: [lastLogprob],
    },
    {
      type: 'response.output_item.added',
      sequence_number: 6,
      output_index: 1,
      item: {
        type: 'function_call',
        id: 'fc_match',
        name: 'tool_as_data',
        call_id: 'call_match',
        arguments: '',
      },
    },
    {
      type: 'response.function_call_arguments.delta',
      sequence_number: 7,
      item_id: 'fc_match',
      output_index: 1,
      delta: '{"q":"hello"}',
    },
  ];
  const socket = new ResponsesWebSocketAccumulator();
  let sse: Response | undefined;
  const expectedLogprobs = [[firstLogprob], [firstLogprob, lastLogprob], [lastLogprob]];
  for (const event of events) {
    sse = accumulateResponse(event, sse);
    socket.add(event);
    if ('output_index' in event) {
      expect(socket.outputAt(event.output_index)).toEqual(sse.output[event.output_index]);
    }
    if (event.type === 'response.output_text.delta' || event.type === 'response.output_text.done') {
      const expected = expectedLogprobs[event.sequence_number - 3];
      expect(socket.outputAt(0, { content_index: 0 })).toMatchObject({ logprobs: expected });
      expect(sse.output[0]).toMatchObject({ content: [{ logprobs: expected }] });
    }
  }
  expect(socket.current).toEqual({
    phase: 'provisional',
    snapshot: sse,
  });
});
