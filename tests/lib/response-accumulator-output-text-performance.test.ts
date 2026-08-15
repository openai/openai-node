import { expect, vi } from 'vitest';
import { OpenAIError } from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type {
  Response,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import * as responseAccumulator from '../../src/internal/responses/response-accumulator';
import * as responseParser from '../../src/lib/ResponsesParser';

type Output = Response['output'][number];
type Content = ResponseOutputMessage['content'][number];

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`missing test value at index ${index}`);
  }
  return value;
}

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

function measureWork(kind: 'text' | 'output'): { count: number } {
  const work = { count: 0 };
  const clone = globalThis.structuredClone;
  const instrument = <T extends object>(target: T, matches: (property: PropertyKey) => boolean) =>
    new Proxy(target, {
      get(current, property, receiver) {
        work.count += Number(matches(property));
        return Reflect.get(current, property, receiver);
      },
    });
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const cloned = clone(value, options);
    if (typeof cloned !== 'object' || cloned === null) {
      return cloned;
    }
    if (kind === 'text' && 'type' in cloned && cloned.type === 'output_text') {
      return instrument(cloned, (property) => property === 'text');
    }
    if (kind === 'output' && 'object' in cloned && cloned.object === 'response') {
      const snapshot = cloned as Response;
      snapshot.output = instrument(
        snapshot.output,
        (property) => typeof property === 'string' && /^[1-9][0-9]*$/u.test(property),
      );
    }
    return cloned;
  });
  return work;
}

function middleEvents(count: number, kind: 'added' | 'delta') {
  const middle = Math.floor((257 - count) / 2);
  const earlier = 16;
  const last = count - 1;
  const parts = Array.from({ length: count }, (_, index) => [String.fromCodePoint(65 + index)]);
  const events = [
    created(),
    ...Array.from({ length: 257 }, (_, index) =>
      outputFrame(
        'added',
        index,
        index >= middle && index < middle + count
          ? message(index, [text(requiredAt(requiredAt(parts, index - middle), 0)), refusal()])
          : tool(index),
      ),
    ),
  ];
  const expected = new Map<number, string>();
  let prefix = '';
  const canonical = () => prefix + parts.flat().join('');
  const record = (event: ResponseStreamEvent) => {
    events.push(event);
    expected.set(events.length - 1, canonical());
  };
  const replaceEarlier = (value: string, type: 'output' | 'content' | 'tool' | 'delta') => {
    prefix = type === 'delta' ? prefix + value : value;
    const item = type === 'tool' ? tool(earlier) : message(earlier, [refusal(), text(value)]);
    let event: ResponseStreamEvent;
    if (type === 'output' || type === 'tool') {
      event = outputFrame('done', earlier, item);
    } else if (type === 'delta') {
      event = textFrame('delta', earlier, 1, value);
    } else {
      event = contentFrame('done', earlier, 1, value ? text(value) : refusal());
    }
    record(event);
  };
  const replaceMiddle = (index: number, value: string, output = false) => {
    if (output) {
      parts[index] = [value];
    } else {
      requiredAt(parts, index)[0] = value;
    }
    record(
      output
        ? outputFrame('done', middle + index, message(middle + index, [text(value), refusal()]))
        : textFrame('done', middle + index, 0, value),
    );
  };
  const appendPart = (index: number, value: string, type: 'added' | 'delta', tail = false) => {
    const content = requiredAt(parts, index);
    if (type === 'added') {
      content.push(value);
      record(contentFrame('added', middle + index, content.length, text(value)));
    } else {
      const partIndex = tail ? content.length - 1 : 0;
      content[partIndex] = requiredAt(content, partIndex) + value;
      record(textFrame('delta', middle + index, tail ? content.length : 0, value));
    }
  };
  const mutations = new Map<number, () => void>([
    [32, () => replaceEarlier('early', 'output')],
    [64, () => replaceEarlier('a much longer earlier prefix', 'content')],
    [80, () => appendPart(last, 'tail', 'added')],
    [88, () => appendPart(last, '++', 'delta', true)],
    [96, () => replaceMiddle(0, 'first replacement')],
    [112, () => replaceMiddle(last, 'a much longer last replacement')],
    [128, () => replaceEarlier('', 'tool')],
    [160, () => replaceEarlier('back', 'output')],
    [176, () => replaceMiddle(1, 'middle replacement', true)],
    [192, () => replaceEarlier('!', 'delta')],
    [224, () => replaceEarlier('', 'content')],
    [240, () => replaceEarlier('return', 'content')],
  ]);
  for (let index = 0; index < 256; index += 1) {
    mutations.get(index)?.();
    appendPart(index % count, String.fromCodePoint(97 + (index % 26)), kind);
  }
  return { events, expected, canonical };
}

function firstText(snapshot: Response): ResponseOutputText {
  const output = requiredAt(snapshot.output, 0);
  const part = output.type === 'message' ? requiredAt(output.content, 0) : undefined;
  if (part?.type !== 'output_text') {
    throw new Error('expected output text');
  }
  return part;
}

afterEach(() => vi.restoreAllMocks());

describe('canonical streamed response output text', () => {
  const first = () => message(0, [text('A')]);
  const second = () => message(1, [text('B')]);
  const both = () => message(0, [text('A'), text('B')]);

  test.each(
    [2, 8, 32].flatMap((messageCount) =>
      (['delta', 'added'] as const).map((kind) => ({ messageCount, kind })),
    ),
  )('indexes $messageCount middle messages for $kind updates', async ({ messageCount, kind }) => {
    const { events, expected, canonical } = middleEvents(messageCount, kind);
    const work = measureWork('output');
    const reduce = responseAccumulator.accumulateResponseWithContext;
    vi.spyOn(responseAccumulator, 'accumulateResponseWithContext').mockImplementation(
      (event, snapshot, context) => {
        const next = reduce(event, snapshot, context);
        const value = expected.get(event.sequence_number);
        if (value !== undefined) {
          expect(next.output_text).toBe(value);
        }
        return next;
      },
    );
    const final = await stream(events);
    expect(final.output_text).toBe(canonical());
    expect(work.count).toBeLessThanOrEqual(events.length * 12);
  });

  test('keeps 4,096 ordinary streamed token deltas linear', async () => {
    const count = 4096;
    const work = measureWork('text');
    const events = [
      created(),
      outputFrame('added', 0, message(0)),
      contentFrame('added', 0, 0, text('')),
      ...Array.from({ length: count }, () => textFrame('delta', 0, 0, 'x')),
    ];
    const final = await stream(events);
    expect(final.output_text).toBe('x'.repeat(count));
    expect(work.count).toBeLessThanOrEqual(count * 8);
  });

  test.each([false, true])('releases the accumulator context when parsing fails: %s', async (fails) => {
    const createContext = vi.spyOn(responseAccumulator, 'createResponseContext');
    const failure = new OpenAIError('response parsing failed');
    if (fails) {
      vi.spyOn(responseParser, 'maybeParseResponse').mockImplementation(() => {
        expect(createContext).toHaveBeenCalledTimes(3);
        throw failure;
      });
    }
    const result = stream([created([first()]), textFrame('delta', 0, 0, '!')]);
    if (fails) {
      await expect(result).rejects.toBe(failure);
    } else {
      const final = await result;
      expect(final.output_text).toBe('A!');
    }
    expect(createContext).toHaveBeenCalledTimes(3);
    const [, request, released] = createContext.mock.results.map(({ value }) => value);
    expect(request?.canonicalSnapshot?.output_text).toBe('A!');
    expect(released?.canonicalSnapshot).toBeUndefined();
    expect(released?.outputTextLengths).not.toBe(request?.outputTextLengths);
    expect(request?.outputTextIndex.length).toBeGreaterThan(0);
    expect(released?.outputTextIndex).not.toBe(request?.outputTextIndex);
    expect(released?.outputTextIndex.length).toBe(0);
  });

  test.each([
    ['ordinary accumulation', (snapshot: Response) => snapshot, 'AXY'],
    ['aggregate overwrite', (snapshot: Response) => (snapshot.output_text = 'corrupted'), 'AXY'],
    ['same-length content', (snapshot: Response) => (firstText(snapshot).text = 'ZZ'), 'ZZY'],
    ['different-length content', (snapshot: Response) => (firstText(snapshot).text = 'longer'), 'longerY'],
    [
      'existing output replacement',
      (snapshot: Response) => (snapshot.output[0] = message(0, [text('B')])),
      'BY',
    ],
    ['output append', (snapshot: Response) => snapshot.output.push(second()), 'AXYB'],
  ])('repairs public snapshot mutation after %s in place', (_label, mutate, expected) => {
    const snapshot = accumulateResponse(created([first()]));
    accumulateResponse(textFrame('delta', 0, 0, 'X'), snapshot);
    mutate(snapshot);
    expect(accumulateResponse(textFrame('delta', 0, 0, 'Y'), snapshot)).toBe(snapshot);
    expect(snapshot.output_text).toBe(expected);
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
    ['authoritative length shift', [first(), second()], textFrame('done', 0, 0, 'longer'), 'longerB'],
    [
      'UTF-16 offsets across a tool',
      [message(0, [text('😀')]), tool(1), message(2, [text('🚀')])],
      textFrame('delta', 0, 0, '🙂'),
      '😀🙂🚀',
    ],
  ] as [string, Output[], ResponseStreamEvent, string][])(
    'preserves canonical order and detached payloads for %s',
    async (_label, outputs, update, expected) => {
      const events = [created(), ...outputs.map((item, index) => outputFrame('added', index, item)), update];
      const original = structuredClone(events);
      let direct: Response | undefined;
      for (const event of events) {
        direct = accumulateResponse(event, direct);
      }
      expect(direct?.output_text).toBe(expected);
      const final = await stream(events);
      expect(final.output_text).toBe(expected);
      expect(events).toEqual(original);
    },
  );

  test('keeps lifecycle replacements and parallel stream contexts independent', async () => {
    const replaced = stream([
      created([message(0, [text('old')])]),
      textFrame('delta', 0, 0, '!'),
      frame('response.in_progress', { response: response([message(0, [text('replacement')])], 'stale') }),
      textFrame('delta', 0, 0, '?'),
    ]);
    const separate = stream([created([first()], 'poisoned'), textFrame('delta', 0, 0, '!')]);
    const results = await Promise.all([replaced, separate]);
    expect(results.map(({ output_text }) => output_text)).toEqual(['replacement?', 'A!']);
  });

  test.each([
    ['text appended', contentFrame('added', 0, 1, text('B')), 'AB'],
    ['empty text appended', contentFrame('added', 0, 1, text('')), 'A'],
    ['message appended', outputFrame('added', 1, second()), 'AB'],
    ['identical output finalized', outputFrame('done', 0, first()), 'A'],
  ])('repairs stale lifecycle aggregates when %s', (_label, event, expected) => {
    for (const stale of ['', 'not canonical']) {
      const snapshot = accumulateResponse(created([first()], stale));
      accumulateResponse(event, snapshot);
      expect(snapshot.output_text).toBe(expected);
    }
  });
});
