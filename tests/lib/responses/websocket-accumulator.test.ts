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
    const terminal: ResponsesWebSocketEvent =
      type === 'error'
        ? { type, error: { message: 'synthetic rejection' }, stream_id: 'a' }
        : { type, response: { id: 'resp_a', status: type.slice(9), custom: 'kept' }, stream_id: 'a' };
    accumulator.add(terminal);
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
  expect(second.current).toEqual({ phase: 'provisional', snapshot: { output: [], output_text: '' } });
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

test('shared scaffolded events produce identical provisional output over SSE and WebSocket', () => {
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
      logprobs: [],
    },
    {
      type: 'response.output_item.added',
      sequence_number: 4,
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
      sequence_number: 5,
      item_id: 'fc_match',
      output_index: 1,
      delta: '{"q":"hello"}',
    },
  ];
  const socket = new ResponsesWebSocketAccumulator();
  let sse: Response | undefined;
  for (const event of events) {
    sse = accumulateResponse(event, sse);
    socket.add(event);
    expect(socket.current).toEqual({
      phase: 'provisional',
      snapshot: { output: sse.output, output_text: sse.output_text },
    });
  }
});
