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

  test.each(['added', 'delta'] as const)(
    'visits surrounding tool outputs only linearly across middle-message %s updates',
    async (kind) => {
      const count = 256;
      const middleIndex = count / 2;
      const work = measureLaterOutputVisits();
      const events = [created()];

      for (let index = 0; index < middleIndex; index += 1) {
        events.push(outputFrame('added', index, tool(index)));
      }
      events.push(
        outputFrame('added', middleIndex, message(middleIndex, kind === 'delta' ? [text('')] : [])),
      );
      for (let index = middleIndex + 1; index <= count; index += 1) {
        events.push(outputFrame('added', index, tool(index)));
      }
      for (let index = 0; index < count; index += 1) {
        const event =
          kind === 'added'
            ? contentFrame('added', middleIndex, index, text('x'))
            : textFrame('delta', middleIndex, 0, 'x');
        events.push(event);
      }

      const final = await stream(events);

      expect(final.output_text).toBe('x'.repeat(count));
      expect(work.visits).toBeLessThanOrEqual(count * 8);
    },
  );

  test.each(
    [2, 8, 32].flatMap((messageCount) =>
      (['added', 'delta'] as const).map((kind) => ({ messageCount, kind })),
    ),
  )('indexes $messageCount alternating middle messages for $kind updates', async ({ messageCount, kind }) => {
    const outputCount = 257;
    const middleIndex = Math.floor((outputCount - messageCount) / 2);
    const earlierIndex = 16;
    const lastIndex = messageCount - 1;
    const parts = Array.from({ length: messageCount }, (_, index) => [String.fromCodePoint(65 + index)]);
    const contentLengths = Array.from({ length: messageCount }, () => 2);
    const expected = new Map<number, string>();
    const events = [created()];
    let prefix = '';
    let tailContentIndex = 0;
    let tailPartIndex = 0;

    for (let index = 0; index < middleIndex; index += 1) {
      events.push(outputFrame('added', index, tool(index)));
    }
    for (let index = 0; index < messageCount; index += 1) {
      const firstPart = requiredAt(requiredAt(parts, index), 0);
      events.push(
        outputFrame('added', middleIndex + index, message(middleIndex + index, [text(firstPart), refusal()])),
      );
    }
    for (let index = middleIndex + messageCount; index < outputCount; index += 1) {
      events.push(outputFrame('added', index, tool(index)));
    }

    const record = (event: ResponseStreamEvent): void => {
      events.push(event);
      expected.set(events.length - 1, prefix + parts.map((content) => content.join('')).join(''));
    };

    const replaceEarlierOutput = (value: string): void => {
      prefix = value;
      record(outputFrame('done', earlierIndex, message(earlierIndex, [refusal(), text(prefix)])));
    };
    const replaceEarlierContent = (value: string): void => {
      prefix = value;
      record(contentFrame('done', earlierIndex, 1, prefix ? text(prefix) : refusal()));
    };
    const replaceActiveContent = (index: number, value: string): void => {
      requiredAt(parts, index)[0] = value;
      record(textFrame('done', middleIndex + index, 0, value));
    };
    const mutations = new Map<number, () => void>([
      [32, () => replaceEarlierOutput('early')],
      [64, () => replaceEarlierContent('a much longer earlier prefix')],
      [
        80,
        () => {
          const content = requiredAt(parts, lastIndex);
          tailPartIndex = content.length;
          tailContentIndex = requiredAt(contentLengths, lastIndex);
          content.push('tail');
          contentLengths[lastIndex] = tailContentIndex + 1;
          record(contentFrame('added', middleIndex + lastIndex, tailContentIndex, text('tail')));
        },
      ],
      [
        88,
        () => {
          const content = requiredAt(parts, lastIndex);
          content[tailPartIndex] = `${requiredAt(content, tailPartIndex)}++`;
          record(textFrame('delta', middleIndex + lastIndex, tailContentIndex, '++'));
        },
      ],
      [96, () => replaceActiveContent(0, 'first replacement')],
      [112, () => replaceActiveContent(lastIndex, 'a much longer last replacement')],
      [
        128,
        () => {
          prefix = '';
          record(outputFrame('done', earlierIndex, tool(earlierIndex)));
        },
      ],
      [160, () => replaceEarlierOutput('back')],
      [
        176,
        () => {
          parts[1] = ['middle replacement'];
          contentLengths[1] = 2;
          record(
            outputFrame(
              'done',
              middleIndex + 1,
              message(middleIndex + 1, [text('middle replacement'), refusal()]),
            ),
          );
        },
      ],
      [
        192,
        () => {
          prefix += '!';
          record(textFrame('delta', earlierIndex, 1, '!'));
        },
      ],
      [224, () => replaceEarlierContent('')],
      [240, () => replaceEarlierContent('return')],
    ]);

    for (let index = 0; index < 256; index += 1) {
      mutations.get(index)?.();

      const messageIndex = index % messageCount;
      const delta = String.fromCodePoint(97 + (index % 26));
      const content = requiredAt(parts, messageIndex);
      if (kind === 'added') {
        const contentIndex = requiredAt(contentLengths, messageIndex);
        content.push(delta);
        contentLengths[messageIndex] = contentIndex + 1;
        record(contentFrame('added', middleIndex + messageIndex, contentIndex, text(delta)));
      } else {
        content[0] = requiredAt(content, 0) + delta;
        record(textFrame('delta', middleIndex + messageIndex, 0, delta));
      }
    }

    const work = measureLaterOutputVisits();
    const reducer = responseAccumulator.accumulateResponseWithContext;
    vi.spyOn(responseAccumulator, 'accumulateResponseWithContext').mockImplementation(
      (event, snapshot, context) => {
        const next = reducer(event, snapshot, context);
        const canonical = expected.get(event.sequence_number);
        if (canonical !== undefined) {
          expect(next.output_text).toBe(canonical);
        }
        return next;
      },
    );

    const final = await stream(events);

    expect(final.output_text).toBe(prefix + parts.map((content) => content.join('')).join(''));
    expect(work.visits).toBeLessThanOrEqual(events.length * 12);
  });

  test.each([
    ['an earlier message becomes a tool', message(0, [text('A')]), outputFrame('done', 0, tool(0)), 'M12Z'],
    [
      'an earlier tool becomes a message',
      tool(0),
      outputFrame('done', 0, message(0, [text('longer')])),
      'longerM12Z',
    ],
    [
      'an earlier message is replaced with longer text',
      message(0, [text('A')]),
      outputFrame('done', 0, message(0, [text('longer')])),
      'longerM12Z',
    ],
    [
      'an earlier message receives a text delta',
      message(0, [text('A')]),
      textFrame('delta', 0, 0, '++'),
      'A++M12Z',
    ],
    [
      'an earlier message receives authoritative text',
      message(0, [text('A')]),
      textFrame('done', 0, 0, 'longer'),
      'longerM12Z',
    ],
  ] as [string, Output, ResponseStreamEvent, string][])(
    'updates a cached middle-message offset when %s',
    async (_label, earlierOutput, earlierUpdate, expected) => {
      const events = [
        created(),
        outputFrame('added', 0, earlierOutput),
        outputFrame('added', 1, message(1, [text('M')])),
        outputFrame('added', 2, message(2, [text('Z')])),
        textFrame('delta', 1, 0, '1'),
        earlierUpdate,
        textFrame('delta', 1, 0, '2'),
      ];

      const final = await stream(events);

      expect(final.output_text).toBe(expected);
    },
  );

  test('keeps a suffix-seeded middle-message cursor relative to its entire output', async () => {
    const middleIndex = 4;
    const events = [created()];

    for (let index = 0; index < middleIndex; index += 1) {
      events.push(outputFrame('added', index, tool(index)));
    }
    events.push(
      outputFrame('added', middleIndex, message(middleIndex, [text('A'), text('B')])),
      outputFrame('added', middleIndex + 1, tool(middleIndex + 1)),
      outputFrame('added', middleIndex + 2, tool(middleIndex + 2)),
      textFrame('delta', middleIndex, 1, 'x'),
      textFrame('delta', middleIndex, 1, 'y'),
    );

    const final = await stream(events);

    expect(final.output_text).toBe('ABxy');
  });

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

  test('releases the request-owned accumulator context when the stream ends', async () => {
    const createContext = vi.spyOn(responseAccumulator, 'createResponseContext');

    const final = await stream([created([first()]), textFrame('delta', 0, 0, '!')]);

    expect(final.output_text).toBe('A!');
    expect(createContext).toHaveBeenCalledTimes(3);
    const [, requestContext, releasedContext] = createContext.mock.results.map(({ value }) => value);
    expect(requestContext?.canonicalSnapshot?.output_text).toBe('A!');
    expect(releasedContext?.canonicalSnapshot).toBeUndefined();
    expect(releasedContext?.outputTextLengths).not.toBe(requestContext?.outputTextLengths);
    expect(requestContext?.outputTextIndex.length).toBeGreaterThan(0);
    expect(releasedContext?.outputTextIndex).not.toBe(requestContext?.outputTextIndex);
    expect(releasedContext?.outputTextIndex.length).toBe(0);
  });

  test('releases the request-owned accumulator context before response parsing fails', async () => {
    const createContext = vi.spyOn(responseAccumulator, 'createResponseContext');
    const parsingFailure = new OpenAIError('response parsing failed');
    const parseResponse = vi.spyOn(responseParser, 'maybeParseResponse').mockImplementation(() => {
      expect(createContext).toHaveBeenCalledTimes(3);
      throw parsingFailure;
    });

    await expect(stream([created([first()]), textFrame('delta', 0, 0, '!')])).rejects.toBe(parsingFailure);

    expect(parseResponse).toHaveBeenCalledOnce();
    const [, requestContext, releasedContext] = createContext.mock.results.map(({ value }) => value);
    expect(requestContext?.canonicalSnapshot?.output_text).toBe('A!');
    expect(releasedContext?.canonicalSnapshot).toBeUndefined();
    expect(releasedContext?.outputTextLengths).not.toBe(requestContext?.outputTextLengths);
    expect(requestContext?.outputTextIndex.length).toBeGreaterThan(0);
    expect(releasedContext?.outputTextIndex).not.toBe(requestContext?.outputTextIndex);
    expect(releasedContext?.outputTextIndex.length).toBe(0);
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
