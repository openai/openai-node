import OpenAI from 'openai';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import { Stream } from 'openai/streaming';
import type { Response as APIResponse } from 'openai/resources/responses/responses';
import { vi } from 'vitest';

function streamEvents(
  events: Record<string, unknown>[],
  startingAfter?: number,
  configure?: (client: OpenAI) => void,
) {
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(
        events
          .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  configure?.(client);
  return client.responses.stream(
    startingAfter === undefined
      ? { model: 'test-model', input: 'Read the stream.' }
      : { response_id: 'resp_test', starting_after: startingAfter },
  );
}

const part = { type: 'output_text', text: '{"answer":4}', annotations: [], logprobs: [] };
const message = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [part],
};
const tool = {
  id: 'fc_test',
  type: 'function_call',
  call_id: 'call_test',
  name: 'lookup',
  arguments: '{"answer":4}',
  status: 'completed',
};

test('requires an own lifecycle response before reading a custom event getter', async () => {
  let reads = 0;
  const stream = streamEvents(
    [
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [] } },
    ],
    undefined,
    (client) => {
      class LifecycleEvent {
        readonly type = 'response.created' as const;
        readonly sequence_number: number;
        private readonly value: APIResponse;
        constructor(sequence_number: number, value: APIResponse) {
          this.sequence_number = sequence_number;
          this.value = value;
        }
        get response() {
          reads += 1;
          return this.value;
        }
      }
      const create = client.responses.create.bind(client.responses);
      vi.spyOn(client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if (!(response instanceof Stream)) {
            return response;
          }
          return new Stream(async function* ownEvents() {
            for await (const event of response) {
              yield event.type === 'response.created'
                ? new LifecycleEvent(event.sequence_number, event.response)
                : event;
            }
          }, response.controller);
        }),
      );
    },
  );
  await expect(stream.finalResponse()).rejects.toThrow('Lifecycle events require their own response field.');
  expect(reads).toBe(0);
});

test.each([false, true])('retains an empty computer item ID with null completion=%s', async (missing) => {
  const item = {
    type: 'computer_call',
    id: '',
    call_id: 'native_one',
    status: 'completed',
    pending_safety_checks: [],
    actions: [{ type: 'wait' }],
  };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 3, item },
    { type: 'response.output_item.done', output_index: 3, item },
    {
      type: 'response.completed',
      response: { id: 'resp_test', status: 'completed', output: missing ? null : [item] },
    },
  ]);
  await expect(stream.finalResponse()).resolves.toHaveProperty('output', [item]);
});

test.each([message, tool])('keeps empty $type item IDs invalid', async (item) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, id: '' } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/non-empty output item id/iu);
});

test('rejects duplicate empty computer item IDs', async () => {
  const item = {
    type: 'computer_call',
    id: '',
    call_id: 'one',
    status: 'completed',
    actions: [{ type: 'wait' }],
  };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.added', output_index: 1, item: { ...item, call_id: 'two' } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/duplicate output item identity/iu);
});

function eventsAt(index: number, nullCompletion: boolean, missingItem: boolean) {
  const empty = {
    type: 'response.output_item.added',
    output_index: 0,
    ...(missingItem ? {} : { item: null }),
  };
  return [
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    empty,
    {
      type: 'response.output_item.added',
      output_index: index,
      item: { ...message, status: 'in_progress', content: [] },
    },
    { ...empty, output_index: index },
    {
      type: 'response.output_item.added',
      output_index: index + 1,
      item: { ...tool, status: 'in_progress', arguments: '' },
    },
    {
      type: 'response.content_part.added',
      output_index: index,
      item_id: message.id,
      content_index: 0,
      part: { ...part, text: '' },
    },
    ...['{"answer":', '4}'].flatMap((delta) => [
      {
        type: 'response.output_text.delta',
        output_index: index,
        content_index: 0,
        item_id: message.id,
        delta,
        logprobs: [],
      },
      { type: 'response.function_call_arguments.delta', output_index: index + 1, item_id: tool.id, delta },
    ]),
    { type: 'response.output_item.done', output_index: index + 1, item: tool },
    { type: 'response.output_item.done', output_index: index, item: message },
    {
      type: 'response.completed',
      response: { id: 'resp_test', status: 'completed', output: nullCompletion ? null : [message, tool] },
    },
  ];
}

test('unindexed audio events do not enter sparse output routing', async () => {
  const audio = { type: 'response.audio.delta', delta: 'YQ==' };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test' } },
    audio,
    { type: 'response.audio.done' },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed' } },
  ]);
  const received = [];
  for await (const event of stream) {
    received.push(event);
  }
  expect(received).toContainEqual({ ...audio, sequence_number: 1 });
  const final = await stream.finalResponse();
  expect(final.output).toEqual([]);
});

test.each([0, 1, 1_000_000])('preserves sparse wire index %i and finalized output', async (index) => {
  await Promise.all(
    [false, true].flatMap((nullCompletion) =>
      [false, true].map(async (missingItem) => {
        const events = eventsAt(index, nullCompletion, missingItem);
        const stream = streamEvents(events);
        const text: { index: number; value: string }[] = [];
        const arguments_: { index: number; value: string }[] = [];
        stream.on('response.output_text.delta', (event) => {
          text.push({ index: event.output_index, value: event.snapshot });
        });
        stream.on('response.function_call_arguments.delta', (event) => {
          arguments_.push({ index: event.output_index, value: event.snapshot });
        });
        const addedIDs: string[] = [];
        stream.on('response.output_item.added', (event) => {
          // This is a typed listener; it must be safe to inspect the declared item.
          addedIDs.push(event.item.type);
        });
        const received = [];
        for await (const event of stream) {
          received.push(event);
        }
        expect(received).toEqual(
          events
            .map((event, sequence_number) => ({ ...event, sequence_number }))
            .map((event) =>
              event.type === 'response.completed' && 'response' in event
                ? {
                    ...event,
                    response: {
                      ...event.response,
                      output: [message, tool],
                      ...(nullCompletion ? { output_text: '{"answer":4}' } : {}),
                    },
                  }
                : event,
            )
            .filter(
              (event) =>
                event.type !== 'response.output_item.added' ||
                ('item' in event && event.item !== null && event.item !== undefined),
            ),
        );
        expect(addedIDs).toEqual(['message', 'function_call']);
        expect(text).toEqual([
          { index, value: '{"answer":' },
          { index, value: '{"answer":4}' },
        ]);
        expect(arguments_).toEqual([
          { index: index + 1, value: '{"answer":' },
          { index: index + 1, value: '{"answer":4}' },
        ]);
        const final = await stream.finalResponse();
        expect(final.output_text).toBe('{"answer":4}');
        expect(final.output).toMatchObject([message, tool]);
      }),
    ),
  );
});

test('rejects content that has no real output item', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: null },
    {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      item_id: message.id,
      delta: 'x',
    },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/output.*0/iu);
});

test.each([
  { index: 0, terminal: null },
  { index: 1_000_000, terminal: null },
  { index: 7, terminal: [] },
  { index: 7, terminal: [tool] },
])('final output cannot drop an unfinished real item at $index', async ({ index, terminal }) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: index, item: { ...message, status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: index + 1, item: tool },
    { type: 'response.output_item.done', output_index: index + 1, item: tool },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: terminal } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/unfinished.*output/iu);
});

test.each(['before-done', 'after-done'] as const)(
  'lifecycle snapshot retains sparse index and completion %s',
  async (phase) => {
    const initial = { ...tool, arguments: '', status: 'in_progress' };
    const added = { type: 'response.output_item.added', output_index: 7, item: initial };
    const replacement = {
      type: 'response.in_progress',
      response: { id: 'resp_test', output: [phase === 'after-done' ? tool : initial] },
    };
    const delta = {
      type: 'response.function_call_arguments.delta',
      output_index: 7,
      item_id: tool.id,
      delta: tool.arguments,
    };
    const done = { type: 'response.output_item.done', output_index: 7, item: tool };
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      added,
      ...(phase === 'after-done' ? [delta, done, replacement] : [replacement, delta, done]),
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
    ]);
    const deltas: { index: number; snapshot: string }[] = [];
    stream.on('response.function_call_arguments.delta', (event) => {
      deltas.push({ index: event.output_index, snapshot: event.snapshot });
    });
    const final = await stream.finalResponse();
    expect(deltas).toEqual([{ index: 7, snapshot: tool.arguments }]);
    expect(final.output).toMatchObject([tool]);
  },
);

test.each(['null', 'missing'])('final %s output keeps completed lifecycle replacements', async (terminal) => {
  const updatedMessage = { ...message, content: [{ ...part, text: 'Updated result' }] };
  const updatedTool = { ...tool, arguments: '{"answer":5}' };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 3, item: message },
    { type: 'response.output_item.done', output_index: 3, item: message },
    { type: 'response.output_item.added', output_index: 7, item: tool },
    { type: 'response.output_item.done', output_index: 7, item: tool },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [updatedTool, updatedMessage] } },
    {
      type: 'response.completed',
      response: { id: 'resp_test', status: 'completed', ...(terminal === 'null' ? { output: null } : {}) },
    },
  ]);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([updatedMessage, updatedTool]);
  expect(final.output_text).toBe('Updated result');
});

test('lifecycle replacement recognizes a function call without an optional platform ID', async () => {
  const { id: _id, ...withoutID } = tool;
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item: { ...withoutID, arguments: '' } },
    { type: 'response.output_item.done', output_index: 7, item: withoutID },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [withoutID] } },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
  ]);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([withoutID]);
});

test('a replacement item cannot reuse a completed dense index with a different identity', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: message },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [tool] } },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/conflicting output/iu);
});

test('added item cannot reuse a completed wire index after a lifecycle omission', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item: tool },
    { type: 'response.output_item.done', output_index: 7, item: tool },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item: message },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/duplicate.*index/iu);
});

test('completed sparse item reintroduced by a lifecycle keeps its original wire position', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: tool },
    { type: 'response.output_item.done', output_index: 99, item: tool },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [tool] } },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
  ]);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([tool]);
});

test('unfinished sparse item keeps its index through omission and reintroduction', async () => {
  const initial = { ...tool, arguments: '', status: 'in_progress' };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: initial },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [initial] } },
    {
      type: 'response.function_call_arguments.delta',
      output_index: 99,
      item_id: tool.id,
      delta: tool.arguments,
    },
    { type: 'response.output_item.done', output_index: 99, item: tool },
    { type: 'response.completed', response: { id: 'resp_test', output: null } },
  ]);
  const deltas: string[] = [];
  stream.on('response.function_call_arguments.delta', (event) => {
    expect(event.output_index).toBe(99);
    deltas.push(event.snapshot);
  });
  const final = await stream.finalResponse();
  expect(deltas).toEqual([tool.arguments]);
  expect(final.output).toMatchObject([tool]);
});

test('unfinished index cannot be reused after omission', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: tool },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: message },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/duplicate.*index/iu);
});

test.each([false, true])('omitted sparse output can continue directly with delta %s', async (withDelta) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: { ...tool, arguments: '' } },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    ...(withDelta
      ? [
          {
            type: 'response.function_call_arguments.delta',
            output_index: 99,
            item_id: tool.id,
            delta: tool.arguments,
          },
        ]
      : []),
    { type: 'response.output_item.done', output_index: 99, item: tool },
    { type: 'response.completed', response: { id: 'resp_test', output: null } },
  ]);
  const lifecycle: unknown[] = [];
  const deltas: string[] = [];
  stream.on('response.in_progress', (event) => lifecycle.push(event.response.output));
  stream.on('response.function_call_arguments.delta', (event) => deltas.push(event.snapshot));
  const final = await stream.finalResponse();
  expect(lifecycle).toEqual([[]]);
  expect(deltas).toEqual(withDelta ? [tool.arguments] : []);
  expect(final.output).toMatchObject([tool]);
});

test.each(['id', 'call_id'])('completion after omission must preserve the original %s', async (field) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 99, item: { ...tool, arguments: '' } },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.done', output_index: 99, item: { ...tool, [field]: 'other' } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/expected output item/iu);
});

test.each([false, true])('typed lifecycle responses normalize omitted output %s', async (missing) => {
  const empty = { id: 'resp_test', ...(missing ? {} : { output: null }) };
  const stream = streamEvents([
    { type: 'response.created', response: empty },
    { type: 'response.queued', response: empty },
    { type: 'response.in_progress', response: empty },
    { type: 'response.incomplete', response: empty },
    { type: 'response.failed', response: empty },
    { type: 'response.output_item.added', output_index: 99, item: tool },
    { type: 'response.output_item.done', output_index: 99, item: tool },
    { type: 'response.completed', response: empty },
  ]);
  const named: string[][] = [];
  stream.on('response.created', (event) => named.push(event.response.output.map((item) => item.type)));
  stream.on('response.queued', (event) => named.push(event.response.output.map((item) => item.type)));
  stream.on('response.in_progress', (event) => named.push(event.response.output.map((item) => item.type)));
  stream.on('response.incomplete', (event) => named.push(event.response.output.map((item) => item.type)));
  stream.on('response.failed', (event) => named.push(event.response.output.map((item) => item.type)));
  stream.on('response.completed', (event) => named.push(event.response.output.map((item) => item.type)));
  const received: string[][] = [];
  for await (const event of stream) {
    if ('response' in event) {
      received.push(event.response.output.map((item) => item.type));
    }
  }
  expect(named).toEqual([[], [], [], [], [], ['function_call']]);
  expect(received).toEqual(named);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([tool]);
});

test('low-level streaming retains raw lifecycle placeholders', async () => {
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(
        [
          { type: 'response.created', sequence_number: 0, response: { id: 'resp_test' } },
          { type: 'response.completed', sequence_number: 1, response: { id: 'resp_test', output: null } },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  const raw = await client.responses.create({ model: '', input: 'read', stream: true });
  const received = [];
  for await (const event of raw) {
    if ('response' in event) {
      received.push(event.response);
    }
  }
  expect(received).toEqual([{ id: 'resp_test' }, { id: 'resp_test', output: null }]);
});

test.each(
  (['response.failed', 'response.incomplete'] as const).flatMap((type) =>
    (['missing', 'null', 'empty', 'provided'] as const).map((output) => ({ type, output })),
  ),
)('$type preserves partial output when terminal output is $output', async ({ type, output }) => {
  const terminalOutputs = { null: null, empty: [], provided: [tool] };
  const terminal = {
    id: 'resp_test',
    status: type === 'response.failed' ? 'failed' : 'incomplete',
    ...(output === 'missing' ? {} : { output: terminalOutputs[output] }),
  };
  const stream = streamEvents([
    ...eventsAt(99, true, false).filter(
      (event) => event.type !== 'response.output_item.done' && event.type !== 'response.completed',
    ),
    { type, response: terminal },
  ]);
  const named: unknown[] = [];
  stream.on('response.failed', (event) => named.push(event.response.output));
  stream.on('response.incomplete', (event) => named.push(event.response.output));
  const received: unknown[] = [];
  for await (const event of stream) {
    if (event.type === type) {
      received.push(event.response.output);
    }
  }
  const partial = [
    { ...message, status: 'in_progress' },
    { ...tool, status: 'in_progress' },
  ];
  const expected = output === 'missing' ? partial : (terminalOutputs[output] ?? partial);
  expect(named).toMatchObject([expected]);
  expect(received).toMatchObject([expected]);
  const final = await stream.finalResponse();
  expect(final.status).toBe(terminal.status);
  expect(final.output).toMatchObject(expected);
});

test.each(
  (['response.failed', 'response.incomplete'] as const).flatMap((type) =>
    [false, true].map((nullOutput) => ({ type, nullOutput })),
  ),
)('$type orders retained partial output by wire index (null=$nullOutput)', async ({ type, nullOutput }) => {
  const early = { ...tool, id: 'fc_early', call_id: 'call_early', status: 'in_progress', arguments: '{' };
  const late = { ...message, id: 'msg_late' };
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item: { ...late, content: [] } },
    { type: 'response.output_item.added', output_index: 3, item: early },
    { type: 'response.output_item.done', output_index: 7, item: late },
    { type, response: { id: 'resp_test', status: type.slice(9), ...(nullOutput ? { output: null } : {}) } },
  ]);
  const named: unknown[] = [];
  stream.on('response.failed', (event) => named.push(event.response.output));
  stream.on('response.incomplete', (event) => named.push(event.response.output));
  const received: unknown[] = [];
  for await (const event of stream) {
    if (event.type === type) {
      received.push(event.response.output);
    }
  }
  expect(named).toEqual([[early, late]]);
  expect(received).toEqual([[early, late]]);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([early, late]);
  expect(final.output_text).toBe('{"answer":4}');
});

test('conflicting dense and retained sparse indexes reject before routing another item', async () => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 1, item: message },
    { type: 'response.in_progress', response: { id: 'resp_test', output: [message, tool] } },
  ]);
  await expect(stream.finalResponse()).rejects.toThrow(/conflicting output/iu);
});

test('requires response.created before an empty addition', async () => {
  const stream = streamEvents([{ type: 'response.output_item.added', output_index: 0, item: null }]);
  await expect(stream.finalResponse()).rejects.toThrow(/response.created/u);
});

test.each([
  { name: 'null final', terminal: null, finished: false, accepted: false },
  { name: 'partial final', terminal: [message], finished: false, accepted: false },
  {
    name: 'wrong identity in final',
    terminal: [message, { ...tool, call_id: 'other' }],
    finished: false,
    accepted: false,
  },
  { name: 'whole final', terminal: [message, tool], finished: false, accepted: true },
  { name: 'done before omission', terminal: null, finished: true, accepted: true },
  { name: 'authoritative final omits done item', terminal: [message], finished: true, accepted: true },
])(
  'handles unfinished output across lifecycle replacement: $name',
  async ({ terminal, finished, accepted }) => {
    const initial = { ...message, content: [{ ...part, text: '' }], status: 'in_progress' };
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [initial] } },
      { type: 'response.output_item.added', output_index: 99, item: { ...tool, arguments: '' } },
      ...(finished ? [{ type: 'response.output_item.done', output_index: 99, item: tool }] : []),
      { type: 'response.in_progress', response: { id: 'resp_test', output: [initial] } },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        item_id: message.id,
        delta: '{"answer":4}',
        logprobs: [],
      },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: terminal } },
    ]);
    if (accepted) {
      const final = await stream.finalResponse();
      expect(final.output).toMatchObject(terminal ?? [message, tool]);
    } else {
      await expect(stream.finalResponse()).rejects.toThrow(/unfinished.*output/iu);
    }
  },
);

test.each([false, true])('accepts an empty created response with omitted output %s', async (missing) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', ...(missing ? {} : { output: null }) } },
    { type: 'response.output_item.added', output_index: 0, item: null },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
  ]);
  const final = await stream.finalResponse();
  expect(final.output).toEqual([]);
  expect(final.output_text).toBe('');
});

test.each([
  [
    'unknown index',
    {
      type: 'response.output_text.delta',
      output_index: 9,
      item_id: message.id,
      delta: 'x',
      content_index: 0,
    },
  ],
  [
    'wrong identity',
    { type: 'response.output_text.delta', output_index: 7, item_id: 'other', delta: 'x', content_index: 0 },
  ],
  [
    'wrong type',
    { type: 'response.function_call_arguments.delta', output_index: 7, item_id: message.id, delta: 'x' },
  ],
  [
    'changed call',
    { type: 'response.output_item.done', output_index: 8, item: { ...tool, call_id: 'other' } },
  ],
  [
    'duplicate index',
    { type: 'response.output_item.added', output_index: 7, item: { ...message, id: 'other' } },
  ],
  ['duplicate identity', { type: 'response.output_item.added', output_index: 9, item: message }],
] as const)('preserves identity checks for a sparse stream: %s', async (_name, invalid) => {
  const stream = streamEvents([
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item: message },
    { type: 'response.output_item.added', output_index: 8, item: tool },
    invalid,
  ]);
  await expect(stream.finalResponse()).rejects.toThrow();
});

test('raw listeners share non-delta payloads without changing sparse routing or completion fallback', async () => {
  const stream = streamEvents(eventsAt(7, true, false));
  const seen: [string, number][] = [];
  stream.on('event', (event) => {
    if (event.type === 'response.content_part.added' || event.type === 'response.output_text.delta') {
      event.output_index = 999;
      if (event.type === 'response.content_part.added' && event.part.type === 'output_text') {
        event.part.text = 'listener-edit';
      }
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      event.output_index = 999;
      if (event.item?.type === 'message') {
        event.item.id = 'listener-edit';
        event.item.content.length = 0;
      }
    }
  });
  stream.on('response.content_part.added', (event) => seen.push([event.type, event.output_index]));
  stream.on('response.output_text.delta', (event) => seen.push([event.type, event.output_index]));
  const final = await stream.finalResponse();
  expect(final.output_text).toBe('{"answer":4}');
  expect(final.output).toMatchObject([message, tool]);
  expect(seen).toEqual([
    ['response.content_part.added', 999],
    ['response.output_text.delta', 7],
    ['response.output_text.delta', 7],
  ]);
});

test('replayed sparse events accumulate before the sequence filter', async () => {
  const stream = streamEvents(eventsAt(7, true, false), 6);
  const received = [];
  for await (const event of stream) {
    received.push(event.sequence_number);
  }
  expect(received).toEqual([7, 8, 9, 10, 11, 12]);
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([message, tool]);
  expect(final.output_text).toBe('{"answer":4}');
});

test('readable streams use the same sparse output mapping', async () => {
  const body = eventsAt(7, true, false)
    .map((event, sequence_number) => JSON.stringify({ ...event, sequence_number }))
    .join('\n');
  const stream = ResponseStream.fromReadableStream(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${body}\n`));
        controller.close();
      },
    }),
  );
  const final = await stream.finalResponse();
  expect(final.output).toMatchObject([message, tool]);
  expect(final.output_text).toBe('{"answer":4}');
});

test.each(['function_call', 'custom_tool_call'] as const)(
  'lifecycle enrichment preserves the stable call ID for %s',
  async (type) => {
    const initial = {
      type,
      call_id: 'call_enriched',
      name: 'lookup',
      status: 'completed',
      ...(type === 'function_call' ? { arguments: '{}' } : { input: 'original' }),
    };
    const enriched = { ...initial, id: 'item_enriched' };
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      { type: 'response.output_item.added', output_index: 7, item: initial },
      { type: 'response.output_item.done', output_index: 7, item: initial },
      { type: 'response.in_progress', response: { id: 'resp_test', output: [enriched] } },
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
    ]);
    const final = await stream.finalResponse();
    expect(final.output).toHaveLength(1);
    expect(final.output).toMatchObject([enriched]);
  },
);

test.each(['existing', 'later'] as const)(
  'an enriched platform ID cannot collide with an %s item',
  async (when) => {
    const initial = { type: 'function_call', call_id: 'call_enriched', name: 'lookup', arguments: '{}' };
    const conflicting = { ...message, id: 'shared_id' };
    const add = { type: 'response.output_item.added', output_index: 8, item: conflicting };
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      { type: 'response.output_item.added', output_index: 7, item: initial },
      { type: 'response.output_item.done', output_index: 7, item: initial },
      ...(when === 'existing' ? [add] : []),
      {
        type: 'response.in_progress',
        response: { id: 'resp_test', output: [{ ...initial, id: 'shared_id' }] },
      },
      ...(when === 'later' ? [add] : []),
    ]);
    await expect(stream.finalResponse()).rejects.toThrow(/duplicate output item identity/iu);
  },
);

test.each(['changed', 'dropped'] as const)(
  'unfinished terminal output rejects a %s assigned ID',
  async (kind) => {
    const replacement = { ...tool, id: 'changed_id' };
    if (kind === 'dropped') {
      Reflect.deleteProperty(replacement, 'id');
    }
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      { type: 'response.output_item.added', output_index: 7, item: tool },
      {
        type: 'response.completed',
        response: { id: 'resp_test', status: 'completed', output: [replacement] },
      },
    ]);
    await expect(stream.finalResponse()).rejects.toThrow(/expected output item id/iu);
  },
);

test.each(['changed', 'dropped'] as const)(
  'mixed lifecycle output rejects a %s assigned ID',
  async (kind) => {
    const replacement = { ...tool, id: 'changed_id' };
    if (kind === 'dropped') {
      Reflect.deleteProperty(replacement, 'id');
    }
    const stream = streamEvents([
      { type: 'response.created', response: { id: 'resp_test', output: [] } },
      { type: 'response.output_item.added', output_index: 7, item: tool },
      { type: 'response.output_item.done', output_index: 7, item: tool },
      { type: 'response.in_progress', response: { id: 'resp_test', output: [replacement, message] } },
    ]);
    await expect(stream.finalResponse()).rejects.toThrow(/expected output item id/iu);
  },
);

test.each([
  {
    item: { type: 'image_generation_call', id: 'image_fixture', status: 'completed', result: 'c3ludGhldGlj' },
    progress: {
      type: 'response.image_generation_call.partial_image',
      item_id: 'image_fixture',
      partial_image_index: 0,
      partial_image_b64: 'c3ludGhldGlj',
    },
  },
  {
    item: { type: 'compaction', id: 'compaction_fixture', encrypted_content: 'encrypted' },
    progress: { type: 'response.compaction.compacting', item_id: 'compaction_fixture' },
  },
  {
    item: { type: 'mcp_list_tools', id: 'mcp_fixture', server_label: 'fixture', tools: [] },
    progress: { type: 'response.mcp_list_tools.in_progress', item_id: 'mcp_fixture' },
  },
])('sparse status $progress.type keeps its public wire index', async ({ item, progress }) => {
  const events = [
    { type: 'response.created', response: { id: 'resp_test', output: [] } },
    { type: 'response.output_item.added', output_index: 7, item },
    { ...progress, output_index: 7 },
    { type: 'response.output_item.done', output_index: 7, item },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: null } },
  ];
  const serialized = events
    .map((event, sequence_number) => JSON.stringify({ ...event, sequence_number }))
    .join('\n');
  const readable = ResponseStream.fromReadableStream(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${serialized}\n`));
        controller.close();
      },
    }),
  );
  await Promise.all(
    [streamEvents(events), readable].map(async (stream) => {
      const received = [];
      for await (const event of stream) {
        received.push(event);
      }
      expect(received).toContainEqual({ ...progress, output_index: 7, sequence_number: 2 });
      const final = await stream.finalResponse();
      expect(final.output).toEqual([item]);
    }),
  );
});
