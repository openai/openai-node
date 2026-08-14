import { expect, vi } from 'vitest';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type {
  Response,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

type Output = Response['output'][number];
type Content = ResponseOutputMessage['content'][number];

const text = (value: string): ResponseOutputText => ({ type: 'output_text', text: value, annotations: [] });
const refusal = (): Content => ({ type: 'refusal', refusal: 'refused' });
const message = (index: number, content: Content[] = []): ResponseOutputMessage => ({
  id: `msg_${index}`,
  type: 'message',
  role: 'assistant',
  status: 'in_progress',
  content,
});
const tool = (index: number): Output => ({
  id: `tool_${index}`,
  type: 'function_call',
  call_id: `call_${index}`,
  name: 'lookup',
  arguments: '{}',
  status: 'completed',
});

function response(output: Output[] = [], outputText?: string): Response {
  const canonical = output.flatMap((item) =>
    item.type === 'message'
      ? item.content.flatMap((part) => (part.type === 'output_text' ? [part.text] : []))
      : [],
  );
  return {
    id: 'resp_123',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output,
    output_text: outputText ?? canonical.join(''),
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  } as Response;
}

function frame(type: ResponseStreamEvent['type'], fields: Record<string, unknown> = {}): ResponseStreamEvent {
  return { type, sequence_number: 0, ...fields } as ResponseStreamEvent;
}
const created = (output: Output[] = [], outputText?: string): ResponseStreamEvent =>
  frame('response.created', { response: response(output, outputText) });
const outputFrame = (type: 'added' | 'done', index: number, item: Output): ResponseStreamEvent =>
  frame(`response.output_item.${type}`, { output_index: index, item });
const contentFrame = (
  type: 'added' | 'done',
  outputIndex: number,
  contentIndex: number,
  part: Content,
): ResponseStreamEvent =>
  frame(`response.content_part.${type}`, {
    output_index: outputIndex,
    content_index: contentIndex,
    item_id: `msg_${outputIndex}`,
    part,
  });
const textFrame = (
  type: 'delta' | 'done',
  outputIndex: number,
  contentIndex: number,
  value: string,
): ResponseStreamEvent =>
  frame(`response.output_text.${type}`, {
    output_index: outputIndex,
    content_index: contentIndex,
    item_id: `msg_${outputIndex}`,
    logprobs: [],
    ...(type === 'delta' ? { delta: value } : { text: value }),
  });

async function stream(events: ResponseStreamEvent[]): Promise<Response> {
  const encoder = new TextEncoder();
  const chunks = events.map((event, index) =>
    encoder.encode(`${JSON.stringify({ ...event, sequence_number: index })}\n`),
  );
  return ResponseStream.fromReadableStream(ReadableStreamFrom(chunks)).finalResponse();
}

function measureTextWork(): { reads: number } {
  const work = { reads: 0 };
  const clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const cloned = clone(value, options);
    if (typeof cloned === 'object' && cloned !== null && 'type' in cloned && cloned.type === 'output_text') {
      let current = (cloned as ResponseOutputText).text;
      Object.defineProperty(cloned, 'text', {
        configurable: true,
        enumerable: true,
        get(): string {
          work.reads += 1;
          return current;
        },
        set(next: string): void {
          current = next;
        },
      });
    }
    return cloned;
  });
  return work;
}

function measureLaterOutputVisits(): { visits: number } {
  const work = { visits: 0 };
  const clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const cloned = clone(value, options);
    if (typeof cloned === 'object' && cloned !== null && 'object' in cloned && cloned.object === 'response') {
      const snapshot = cloned as Response;
      snapshot.output = new Proxy(snapshot.output, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^[1-9][0-9]*$/u.test(property)) {
            work.visits += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
    }
    return cloned;
  });
  return work;
}

afterEach(() => vi.restoreAllMocks());

describe('canonical streamed response output text', () => {
  const first = () => message(0, [text('A')]);
  const second = () => message(1, [text('B')]);
  const both = () => message(0, [text('A'), text('B')]);
  const unicode = () => [message(0, [text('😀')]), tool(1), message(2, [text('🚀')])];

  test.each([
    { label: 'one message', later: 'none', order: 'single' },
    { label: 'an existing later message', later: 'message', order: 'single' },
    { label: 'an existing later tool', later: 'tool', order: 'single' },
    { label: 'a later message populated first', later: 'parallel', order: 'later-first' },
    { label: 'alternating output messages', later: 'parallel', order: 'alternating' },
  ])('keeps public streaming linear with $label', async ({ later, order }) => {
    const count = 1024;
    const work = measureTextWork();
    const laterOutput = { none: null, message: second(), tool: tool(1), parallel: message(1) }[later];
    const outputs: Output[] = [message(0), ...(laterOutput ? [laterOutput] : [])];
    const events = [created(), ...outputs.map((item, index) => outputFrame('added', index, item))];
    if (order === 'later-first') {
      for (let index = 0; index < count; index += 1) {
        events.push(contentFrame('added', 1, index, text('B')));
      }
    }
    for (let index = 0; index < count; index += 1) {
      if (order === 'alternating') {
        events.push(contentFrame('added', 1, index, text('B')));
      }
      events.push(contentFrame('added', 0, index, text('A')));
    }
    const suffix = { none: '', message: 'B', tool: '', parallel: 'B'.repeat(count) }[later];
    const final = await stream(events);
    expect(final.output_text).toBe('A'.repeat(count) + suffix);
    expect(work.reads).toBeLessThanOrEqual(count * 16);
  });

  test.each(['added', 'delta'] as const)(
    'visits later tool outputs only linearly across adversarial %s updates',
    async (kind) => {
      const count = 384;
      const work = measureLaterOutputVisits();
      const events = [created(), outputFrame('added', 0, message(0, kind === 'delta' ? [text('')] : []))];
      for (let index = 1; index <= count; index += 1) {
        events.push(outputFrame('added', index, tool(index)));
      }
      for (let index = 0; index < count; index += 1) {
        const event =
          kind === 'added' ? contentFrame('added', 0, index, text('x')) : textFrame('delta', 0, 0, 'x');
        events.push(event);
      }
      const final = await stream(events);
      expect(final.output_text).toBe('x'.repeat(count));
      expect(work.visits).toBeLessThanOrEqual(count * 4);
    },
  );

  test('keeps 4,096 ordinary streamed token deltas linear', async () => {
    const count = 4096;
    const work = measureTextWork();
    const events = [created(), outputFrame('added', 0, message(0)), contentFrame('added', 0, 0, text(''))];
    for (let index = 0; index < count; index += 1) {
      events.push(textFrame('delta', 0, 0, 'x'));
    }

    const final = await stream(events);

    expect(final.output_text).toBe('x'.repeat(count));
    expect(work.reads).toBeLessThanOrEqual(count * 8);
  });

  test('keeps lifecycle replacements and parallel stream contexts independent', async () => {
    const resumed = stream([
      created([message(0, [text('old')])]),
      textFrame('delta', 0, 0, '!'),
      frame('response.in_progress', { response: response([message(0, [text('replacement')])], 'stale') }),
      textFrame('delta', 0, 0, '?'),
    ]);
    const independent = stream([
      created([message(0, [text('separate')])], 'poisoned'),
      textFrame('delta', 0, 0, '!'),
    ]);

    const [replaced, separate] = await Promise.all([resumed, independent]);

    expect(replaced.output_text).toBe('replacement?');
    expect(separate.output_text).toBe('separate!');
  });

  test.each([
    ['earlier output delta', [first(), second()], textFrame('delta', 0, 0, 'X'), 'AXB'],
    ['earlier content delta', [both()], textFrame('delta', 0, 0, 'X'), 'AXB'],
    ['earlier content append', [first(), second()], contentFrame('added', 0, 1, text('X')), 'AXB'],
    ['message becomes tool', [first(), second()], outputFrame('done', 0, tool(0)), 'B'],
    ['tool becomes message', [tool(0), second()], outputFrame('done', 0, first()), 'AB'],
    ['text becomes refusal', [both()], contentFrame('done', 0, 0, refusal()), 'B'],
    [
      'refusal becomes text',
      [message(0, [refusal()]), second()],
      contentFrame('done', 0, 0, text('A')),
      'AB',
    ],
    ['authoritative replacement', [first(), second()], textFrame('done', 0, 0, 'longer'), 'longerB'],
    ['unicode across a tool', unicode(), textFrame('delta', 0, 0, '🙂'), '😀🙂🚀'],
  ] as [string, Output[], ResponseStreamEvent, string][])(
    'preserves canonical order and detached event payloads for %s',
    async (_label, outputs, update, expected) => {
      const events = [created(), ...outputs.map((item, index) => outputFrame('added', index, item)), update];
      const original = structuredClone(events);
      let direct: Response | undefined;
      for (const event of events) {
        direct = accumulateResponse(event, direct);
      }
      const streamed = await stream(events);
      expect(direct?.output_text).toBe(expected);
      expect(streamed.output_text).toBe(expected);
      expect(events).toEqual(original);
    },
  );

  test.each([
    ['a text part is appended', contentFrame('added', 0, 1, text('B')), 'AB'],
    ['an empty part is appended', contentFrame('added', 0, 1, text('')), 'A'],
    ['a message is appended', outputFrame('added', 1, message(1, [text('B')])), 'AB'],
    ['an identical output is finalized', outputFrame('done', 0, message(0, [text('A')])), 'A'],
  ] as [string, ResponseStreamEvent, string][])(
    'repairs stale lifecycle aggregates when %s',
    (_label, event, expected) => {
      for (const stale of ['', 'not canonical']) {
        const snapshot = accumulateResponse(created([first()], stale));
        accumulateResponse(event, snapshot);
        expect(snapshot.output_text).toBe(expected);
      }
    },
  );

  test.each([
    ['missing output', [], outputFrame('done', 0, tool(0))],
    ['output gap', [message(0)], outputFrame('added', 2, message(2))],
    ['content append gap', [message(0, [text('A')])], contentFrame('added', 0, 2, text('B'))],
    ['content replacement gap', [message(0, [text('A')])], contentFrame('done', 0, 1, refusal())],
  ] as [string, Output[], ResponseStreamEvent][])(
    'rejects %s without mutating the aggregate',
    (_label, outputs, event) => {
      const snapshot = accumulateResponse(created(outputs));
      const previous = snapshot.output_text;
      expect(() => accumulateResponse(event, snapshot)).toThrow();
      expect(snapshot.output_text).toBe(previous);
    },
  );
});
