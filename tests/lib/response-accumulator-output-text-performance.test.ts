import { expect, vi } from 'vitest';
import { ReadableStreamFrom } from 'openai/internal/shims';
import * as ResponsesParser from 'openai/lib/ResponsesParser';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseOutputMessage,
  ResponseOutputRefusal,
  ResponseOutputText,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

type OutputItem = Response['output'][number];
type MessageContent = ResponseOutputMessage['content'][number];

function makeResponse(overrides: Partial<Response> = {}): Response {
  const output = overrides.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    if (item.type === 'message') {
      for (const content of item.content) {
        if (content.type === 'output_text') {
          parts.push(content.text);
        }
      }
    }
  }

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
    output_text: parts.join(''),
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    ...overrides,
  } as Response;
}

function message(
  id: string,
  content: MessageContent[] = [],
  status: ResponseOutputMessage['status'] = 'in_progress',
): ResponseOutputMessage {
  return { id, type: 'message', role: 'assistant', status, content };
}

function textPart(text: string): ResponseOutputText {
  return { type: 'output_text', annotations: [], text };
}

function refusalPart(refusal = 'refused'): ResponseOutputRefusal {
  return { type: 'refusal', refusal };
}

function functionCall(id: string): ResponseFunctionToolCall {
  return {
    id,
    type: 'function_call',
    call_id: `call_${id}`,
    name: 'lookup',
    arguments: '{}',
    status: 'completed',
  };
}

function createdEvent(response: Response): ResponseStreamEvent {
  return { type: 'response.created', sequence_number: 0, response };
}

function outputAddedEvent(
  item: OutputItem,
  outputIndex: number,
  sequenceNumber: number,
): ResponseStreamEvent {
  return {
    type: 'response.output_item.added',
    sequence_number: sequenceNumber,
    output_index: outputIndex,
    item,
  };
}

function outputDoneEvent(item: OutputItem, outputIndex: number, sequenceNumber: number): ResponseStreamEvent {
  return {
    type: 'response.output_item.done',
    sequence_number: sequenceNumber,
    output_index: outputIndex,
    item,
  };
}

function contentAddedEvent(
  outputIndex: number,
  contentIndex: number,
  part: MessageContent,
  sequenceNumber: number,
): ResponseStreamEvent {
  return {
    type: 'response.content_part.added',
    sequence_number: sequenceNumber,
    item_id: `msg_${outputIndex}`,
    output_index: outputIndex,
    content_index: contentIndex,
    part,
  };
}

function contentDoneEvent(
  outputIndex: number,
  contentIndex: number,
  part: MessageContent,
  sequenceNumber: number,
): ResponseStreamEvent {
  return {
    type: 'response.content_part.done',
    sequence_number: sequenceNumber,
    item_id: `msg_${outputIndex}`,
    output_index: outputIndex,
    content_index: contentIndex,
    part,
  };
}

function textDeltaEvent(
  outputIndex: number,
  contentIndex: number,
  delta: string,
  sequenceNumber: number,
): ResponseStreamEvent {
  return {
    type: 'response.output_text.delta',
    sequence_number: sequenceNumber,
    item_id: `msg_${outputIndex}`,
    output_index: outputIndex,
    content_index: contentIndex,
    delta,
    logprobs: [],
  };
}

function textDoneEvent(
  outputIndex: number,
  contentIndex: number,
  text: string,
  sequenceNumber: number,
): ResponseStreamEvent {
  return {
    type: 'response.output_text.done',
    sequence_number: sequenceNumber,
    item_id: `msg_${outputIndex}`,
    output_index: outputIndex,
    content_index: contentIndex,
    text,
    logprobs: [],
  };
}

function accumulateEvents(events: ResponseStreamEvent[]): Response {
  let snapshot: Response | undefined;
  for (const event of events) {
    snapshot = accumulateResponse(event, snapshot);
  }
  if (!snapshot) {
    throw new Error('expected at least one response event');
  }
  return snapshot;
}

async function streamResponse(events: ResponseStreamEvent[]) {
  const encoder = new TextEncoder();
  const readable = ReadableStreamFrom(events.map((event) => encoder.encode(`${JSON.stringify(event)}\n`)));
  return ResponseStream.fromReadableStream(readable).finalResponse();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResponseStream output_text accumulation', () => {
  test('aggregates 4,096 one-character content parts with linear canonical work', async () => {
    const partCount = 4096;
    let canonicalVisits = 0;
    let textReads = 0;
    const originalAddOutputText = ResponsesParser.addOutputText;
    const originalStructuredClone = globalThis.structuredClone;

    vi.spyOn(ResponsesParser, 'addOutputText').mockImplementation((response) => {
      for (const output of response.output) {
        if (output.type === 'message') {
          canonicalVisits += output.content.length;
        }
      }
      originalAddOutputText(response);
    });

    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const cloned = originalStructuredClone(value, options);
      if (
        typeof cloned === 'object' &&
        cloned !== null &&
        'type' in cloned &&
        cloned.type === 'output_text'
      ) {
        const part = cloned as ResponseOutputText;
        let currentText = part.text;
        Object.defineProperty(part, 'text', {
          configurable: true,
          enumerable: true,
          get(): string {
            textReads += 1;
            return currentText;
          },
          set(nextText: string): void {
            currentText = nextText;
          },
        });
      }
      return cloned;
    });

    const events: ResponseStreamEvent[] = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0'), 0, 1),
    ];
    let expectedText = '';

    for (let index = 0; index < partCount; index += 1) {
      const character = String.fromCodePoint(97 + (index % 26));
      expectedText += character;
      events.push(contentAddedEvent(0, index, textPart(character), index + 2));
    }

    const final = await streamResponse(events);

    expect(final.output_text).toBe(expectedText);
    expect(final.output).toHaveLength(1);
    expect(
      canonicalVisits,
      `canonical content visits: ${canonicalVisits}; tracked text reads: ${textReads}`,
    ).toBeLessThanOrEqual(partCount * 4);
    expect(textReads).toBeLessThanOrEqual(partCount * 8);
  });

  test.each([
    {
      label: 'a later message already contains text',
      laterOutput: message('msg_1', [textPart('B')]),
      suffix: 'B',
    },
    { label: 'a later tool contributes no text', laterOutput: functionCall('tool_1'), suffix: '' },
  ])('keeps 4,096 earlier-message part appends linear when $label', async (scenario) => {
    const partCount = 4096;
    let textReads = 0;
    const originalStructuredClone = globalThis.structuredClone;

    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const cloned = originalStructuredClone(value, options);
      if (
        typeof cloned === 'object' &&
        cloned !== null &&
        'type' in cloned &&
        cloned.type === 'output_text'
      ) {
        const part = cloned as ResponseOutputText;
        let currentText = part.text;
        Object.defineProperty(part, 'text', {
          configurable: true,
          enumerable: true,
          get(): string {
            textReads += 1;
            return currentText;
          },
          set(nextText: string): void {
            currentText = nextText;
          },
        });
      }
      return cloned;
    });

    const events: ResponseStreamEvent[] = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0'), 0, 1),
      outputAddedEvent(scenario.laterOutput, 1, 2),
    ];

    for (let index = 0; index < partCount; index += 1) {
      events.push(contentAddedEvent(0, index, textPart('A'), index + 3));
    }

    const final = await streamResponse(events);

    expect(final.output_text).toBe('A'.repeat(partCount) + scenario.suffix);
    expect(textReads).toBeLessThanOrEqual(partCount * 8);
  });

  test.each([
    { label: 'the later message is populated first', alternating: false },
    { label: 'both messages receive alternating parts', alternating: true },
  ])('keeps two 1,024-part output messages linear when $label', async (scenario) => {
    const partCount = 1024;
    let textReads = 0;
    const originalStructuredClone = globalThis.structuredClone;

    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const cloned = originalStructuredClone(value, options);
      if (
        typeof cloned === 'object' &&
        cloned !== null &&
        'type' in cloned &&
        cloned.type === 'output_text'
      ) {
        const part = cloned as ResponseOutputText;
        let currentText = part.text;
        Object.defineProperty(part, 'text', {
          configurable: true,
          enumerable: true,
          get(): string {
            textReads += 1;
            return currentText;
          },
          set(nextText: string): void {
            currentText = nextText;
          },
        });
      }
      return cloned;
    });

    const events: ResponseStreamEvent[] = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0'), 0, 1),
      outputAddedEvent(message('msg_1'), 1, 2),
    ];
    let sequenceNumber = 3;

    if (scenario.alternating) {
      for (let index = 0; index < partCount; index += 1) {
        events.push(contentAddedEvent(1, index, textPart('B'), sequenceNumber));
        sequenceNumber += 1;
        events.push(contentAddedEvent(0, index, textPart('A'), sequenceNumber));
        sequenceNumber += 1;
      }
    } else {
      for (let index = 0; index < partCount; index += 1) {
        events.push(contentAddedEvent(1, index, textPart('B'), sequenceNumber));
        sequenceNumber += 1;
      }
      for (let index = 0; index < partCount; index += 1) {
        events.push(contentAddedEvent(0, index, textPart('A'), sequenceNumber));
        sequenceNumber += 1;
      }
    }

    const final = await streamResponse(events);

    expect(final.output_text).toBe('A'.repeat(partCount) + 'B'.repeat(partCount));
    expect(textReads).toBeLessThanOrEqual(partCount * 16);
  });

  test.each([
    { label: 'an earlier content part follows a large preceding message', precedingOutput: true },
    { label: 'the penultimate content part follows many parts in the same message', precedingOutput: false },
  ])('keeps 1,024 interleaved token deltas linear when $label', async (scenario) => {
    const tokenCount = 1024;
    let textReads = 0;
    const originalStructuredClone = globalThis.structuredClone;

    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const cloned = originalStructuredClone(value, options);
      if (
        typeof cloned === 'object' &&
        cloned !== null &&
        'type' in cloned &&
        cloned.type === 'output_text'
      ) {
        const part = cloned as ResponseOutputText;
        let currentText = part.text;
        Object.defineProperty(part, 'text', {
          configurable: true,
          enumerable: true,
          get(): string {
            textReads += 1;
            return currentText;
          },
          set(nextText: string): void {
            currentText = nextText;
          },
        });
      }
      return cloned;
    });

    const events: ResponseStreamEvent[] = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0'), 0, 1),
    ];
    let sequenceNumber = 2;
    if (scenario.precedingOutput) {
      events.push(outputAddedEvent(message('msg_1', [textPart(''), textPart('B')]), 1, sequenceNumber));
      sequenceNumber += 1;
    }

    for (let index = 0; index < tokenCount; index += 1) {
      events.push(contentAddedEvent(0, index, textPart('A'), sequenceNumber));
      sequenceNumber += 1;
    }

    let outputIndex = 1;
    let contentIndex = 0;
    if (!scenario.precedingOutput) {
      events.push(contentAddedEvent(0, tokenCount, textPart(''), sequenceNumber));
      sequenceNumber += 1;
      events.push(contentAddedEvent(0, tokenCount + 1, textPart('B'), sequenceNumber));
      sequenceNumber += 1;
      outputIndex = 0;
      contentIndex = tokenCount;
    }

    for (let index = 0; index < tokenCount; index += 1) {
      events.push(textDeltaEvent(outputIndex, contentIndex, 'X', sequenceNumber));
      sequenceNumber += 1;
    }

    const final = await streamResponse(events);

    expect(final.output_text).toBe(`${'A'.repeat(tokenCount)}${'X'.repeat(tokenCount)}B`);
    expect(textReads).toBeLessThanOrEqual(tokenCount * 24);
  });

  test('preserves canonical text across multiple messages and intervening tool outputs', async () => {
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0', [textPart('A'), refusalPart(), textPart('B')]), 0, 1),
      outputAddedEvent(functionCall('tool_1'), 1, 2),
      outputAddedEvent(message('msg_2', [textPart('C')]), 2, 3),
    ];

    const final = await streamResponse(events);

    expect(final.output_text).toBe('ABC');
    expect(final.output.map((output) => output.type)).toEqual(['message', 'function_call', 'message']);
  });

  test('inserts a delta into an earlier output message before later message text', async () => {
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0', [textPart('A')]), 0, 1),
      outputAddedEvent(message('msg_1', [textPart('B')]), 1, 2),
      textDeltaEvent(0, 0, 'X', 3),
    ];

    const final = await streamResponse(events);

    expect(final.status).toBe('in_progress');
    expect(final.output_text).toBe('AXB');
  });

  test('inserts a delta into an earlier content part before later content', async () => {
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0', [textPart('A'), textPart('B')]), 0, 1),
      textDeltaEvent(0, 0, 'X', 2),
    ];

    const final = await streamResponse(events);

    expect(final.output_text).toBe('AXB');
  });

  test('inserts a new content part into an earlier output before later messages', async () => {
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0', [textPart('A')]), 0, 1),
      outputAddedEvent(message('msg_1', [textPart('B')]), 1, 2),
      contentAddedEvent(0, 1, textPart('X'), 3),
    ];

    const final = await streamResponse(events);

    expect(final.output_text).toBe('AXB');
  });

  test('uses canonical offsets for repeated text and astral Unicode characters', async () => {
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0', [textPart('😀'), textPart('same'), textPart('same')]), 0, 1),
      outputAddedEvent(functionCall('tool_1'), 1, 2),
      outputAddedEvent(message('msg_2', [textPart('same'), textPart('🚀')]), 2, 3),
      textDeltaEvent(0, 0, '🙂', 4),
      contentDoneEvent(0, 1, textPart('🌍'), 5),
      textDoneEvent(0, 2, 'x', 6),
    ];

    const final = await streamResponse(events);

    expect(final.output_text).toBe('😀🙂🌍xsame🚀');
  });

  test.each(['completed', 'incomplete'] as const)(
    'preserves the authoritative %s terminal response and its canonical text',
    async (status) => {
      const authoritative = makeResponse({
        status,
        output: [message('msg_0', [textPart('AX')], status), message('msg_1', [textPart('B')], status)],
      });
      delete (authoritative as Partial<Response>).output_text;

      const terminal: ResponseStreamEvent =
        status === 'completed'
          ? { type: 'response.completed', sequence_number: 4, response: authoritative }
          : { type: 'response.incomplete', sequence_number: 4, response: authoritative };
      const events = [
        createdEvent(makeResponse()),
        outputAddedEvent(message('msg_0', [textPart('A')]), 0, 1),
        outputAddedEvent(message('msg_1', [textPart('B')]), 1, 2),
        textDeltaEvent(0, 0, 'X', 3),
        terminal,
      ];

      const final = await streamResponse(events);

      expect(final.status).toBe(status);
      expect(final.output_text).toBe('AXB');
      expect(final.output).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'msg_0', status }),
          expect.objectContaining({ id: 'msg_1', status }),
        ]),
      );
    },
  );

  test('keeps clean nonterminal streams intact without adding public snapshot fields', async () => {
    const initial = accumulateResponse(createdEvent(makeResponse()));
    const initialKeys = Object.keys(initial);
    const events = [
      createdEvent(makeResponse()),
      outputAddedEvent(message('msg_0'), 0, 1),
      contentAddedEvent(0, 0, textPart('plain'), 2),
    ];

    const direct = accumulateEvents(events);
    const streamed = await streamResponse(events);

    expect(direct.output_text).toBe('plain');
    expect(Object.keys(direct)).toEqual(initialKeys);
    expect(Object.getOwnPropertySymbols(direct)).toHaveLength(0);
    expect(streamed.status).toBe('in_progress');
    expect(streamed.output_text).toBe('plain');
    expect(Object.keys(streamed)).toEqual([...initialKeys, 'output_parsed']);
  });
});

describe('ResponseAccumulator output_text replacements', () => {
  const staleAggregateCases: {
    label: string;
    event: ResponseStreamEvent;
    expected: string;
  }[] = [
    {
      label: 'a text content part is added',
      event: contentAddedEvent(0, 1, textPart('B'), 1),
      expected: 'AB',
    },
    {
      label: 'an empty text content part is added',
      event: contentAddedEvent(0, 1, textPart(''), 1),
      expected: 'A',
    },
    {
      label: 'a message output is added',
      event: outputAddedEvent(message('msg_1', [textPart('B')]), 1, 1),
      expected: 'AB',
    },
    {
      label: 'an empty message output is added',
      event: outputAddedEvent(message('msg_1'), 1, 1),
      expected: 'A',
    },
    {
      label: 'identical output text is marked done',
      event: textDoneEvent(0, 0, 'A', 1),
      expected: 'A',
    },
    {
      label: 'an identical text content part is marked done',
      event: contentDoneEvent(0, 0, textPart('A'), 1),
      expected: 'A',
    },
    {
      label: 'an unchanged message output is marked done',
      event: outputDoneEvent(message('msg_0', [textPart('A')], 'completed'), 0, 1),
      expected: 'A',
    },
  ];

  test.each(staleAggregateCases)(
    'repairs an explicitly noncanonical lifecycle aggregate when $label',
    (scenario) => {
      for (const staleText of ['', 'not canonical']) {
        const snapshot = accumulateResponse(
          createdEvent(makeResponse({ output: [message('msg_0', [textPart('A')])], output_text: staleText })),
        );

        expect(snapshot.output_text).toBe(staleText);

        accumulateResponse(scenario.event, snapshot);

        expect(snapshot.output_text).toBe(scenario.expected);
      }
    },
  );

  test('skips canonical rescans for empty text, refusals, tools, and reasoning', () => {
    const snapshot = accumulateResponse(createdEvent(makeResponse()));
    const rebuild = vi.spyOn(ResponsesParser, 'addOutputText');

    accumulateResponse(outputAddedEvent(message('msg_0', [refusalPart()]), 0, 1), snapshot);
    accumulateResponse(contentAddedEvent(0, 1, textPart(''), 2), snapshot);
    accumulateResponse(contentAddedEvent(0, 2, refusalPart('still refused'), 3), snapshot);
    accumulateResponse(outputAddedEvent(functionCall('tool_1'), 1, 4), snapshot);
    accumulateResponse(
      outputAddedEvent({ type: 'reasoning', id: 'reasoning_2', summary: [] }, 2, 5),
      snapshot,
    );
    accumulateResponse(
      {
        type: 'response.content_part.added',
        sequence_number: 6,
        item_id: 'reasoning_2',
        output_index: 2,
        content_index: 0,
        part: { type: 'reasoning_text', text: 'hidden reasoning' },
      },
      snapshot,
    );

    expect(snapshot.output_text).toBe('');
    expect(snapshot.output.map((output) => output.type)).toEqual(['message', 'function_call', 'reasoning']);
    expect(rebuild).not.toHaveBeenCalled();
  });

  const outputReplacementCases: {
    label: string;
    output: OutputItem[];
    index: number;
    replacement: OutputItem;
    expected: string;
  }[] = [
    {
      label: 'an earlier message becomes a tool',
      output: [message('msg_0', [textPart('A')]), message('msg_1', [textPart('B')])],
      index: 0,
      replacement: functionCall('tool_0'),
      expected: 'B',
    },
    {
      label: 'the final message becomes a tool',
      output: [message('msg_0', [textPart('A')]), message('msg_1', [textPart('B')])],
      index: 1,
      replacement: functionCall('tool_1'),
      expected: 'A',
    },
    {
      label: 'an earlier tool becomes a message',
      output: [functionCall('tool_0'), message('msg_1', [textPart('B')])],
      index: 0,
      replacement: message('msg_0', [textPart('A')], 'completed'),
      expected: 'AB',
    },
    {
      label: 'the final tool becomes a message',
      output: [message('msg_0', [textPart('A')]), functionCall('tool_1')],
      index: 1,
      replacement: message('msg_1', [textPart('B')], 'completed'),
      expected: 'AB',
    },
    {
      label: 'an earlier completed message changes its text',
      output: [message('msg_0', [textPart('long')]), message('msg_1', [textPart('B')])],
      index: 0,
      replacement: message('msg_0', [textPart('X')], 'completed'),
      expected: 'XB',
    },
  ];

  test.each(outputReplacementCases)('maintains canonical text when $label', (scenario) => {
    const snapshot = accumulateResponse(createdEvent(makeResponse({ output: scenario.output })));

    accumulateResponse(outputDoneEvent(scenario.replacement, scenario.index, 1), snapshot);

    expect(snapshot.output_text).toBe(scenario.expected);
    expect(snapshot.output[scenario.index]).toEqual(scenario.replacement);
    expect(snapshot.output[scenario.index]).not.toBe(scenario.replacement);
  });

  const contentReplacementCases: {
    label: string;
    output: OutputItem[];
    outputIndex: number;
    contentIndex: number;
    replacement: MessageContent;
    expected: string;
  }[] = [
    {
      label: 'an earlier text part becomes a refusal',
      output: [message('msg_0', [textPart('A'), textPart('B')])],
      outputIndex: 0,
      contentIndex: 0,
      replacement: refusalPart(),
      expected: 'B',
    },
    {
      label: 'the final text part becomes a refusal',
      output: [message('msg_0', [textPart('A'), textPart('B')])],
      outputIndex: 0,
      contentIndex: 1,
      replacement: refusalPart(),
      expected: 'A',
    },
    {
      label: 'text in an earlier output becomes a refusal',
      output: [message('msg_0', [textPart('A')]), message('msg_1', [textPart('B')])],
      outputIndex: 0,
      contentIndex: 0,
      replacement: refusalPart(),
      expected: 'B',
    },
    {
      label: 'an earlier refusal becomes text',
      output: [message('msg_0', [refusalPart()]), message('msg_1', [textPart('B')])],
      outputIndex: 0,
      contentIndex: 0,
      replacement: textPart('A'),
      expected: 'AB',
    },
    {
      label: 'the final refusal becomes text',
      output: [message('msg_0', [textPart('A'), refusalPart()])],
      outputIndex: 0,
      contentIndex: 1,
      replacement: textPart('B'),
      expected: 'AB',
    },
    {
      label: 'existing text is replaced with empty text',
      output: [message('msg_0', [textPart('A'), textPart('B')])],
      outputIndex: 0,
      contentIndex: 0,
      replacement: textPart(''),
      expected: 'B',
    },
  ];

  test.each(contentReplacementCases)('maintains canonical text when $label', (scenario) => {
    const snapshot = accumulateResponse(createdEvent(makeResponse({ output: scenario.output })));

    accumulateResponse(
      contentDoneEvent(scenario.outputIndex, scenario.contentIndex, scenario.replacement, 1),
      snapshot,
    );

    expect(snapshot.output_text).toBe(scenario.expected);
    const output = snapshot.output[scenario.outputIndex];
    expect(output).toMatchObject({ type: 'message' });
    if (output?.type === 'message') {
      expect(output.content[scenario.contentIndex]).toEqual(scenario.replacement);
      expect(output.content[scenario.contentIndex]).not.toBe(scenario.replacement);
    }
  });

  test.each([
    { replacement: 'expanded text', expected: 'expanded textB' },
    { replacement: 'X', expected: 'XB' },
    { replacement: '', expected: 'B' },
  ])('handles earlier output_text.done replacement with "$replacement"', (scenario) => {
    const snapshot = accumulateResponse(
      createdEvent(
        makeResponse({ output: [message('msg_0', [textPart('before')]), message('msg_1', [textPart('B')])] }),
      ),
    );

    accumulateResponse(textDoneEvent(0, 0, scenario.replacement, 1), snapshot);

    expect(snapshot.output_text).toBe(scenario.expected);
  });

  test('skips canonical rescans when done events change only annotations or status', () => {
    const snapshot = accumulateResponse(
      createdEvent(makeResponse({ output: [message('msg_0', [textPart('unchanged')])] })),
    );
    const rebuild = vi.spyOn(ResponsesParser, 'addOutputText');

    accumulateResponse(contentDoneEvent(0, 0, textPart('unchanged'), 1), snapshot);
    accumulateResponse(textDoneEvent(0, 0, 'unchanged', 2), snapshot);
    accumulateResponse(
      outputDoneEvent(message('msg_0', [textPart('unchanged')], 'completed'), 0, 3),
      snapshot,
    );

    expect(snapshot.output_text).toBe('unchanged');
    expect(snapshot.output[0]).toMatchObject({ status: 'completed' });
    expect(rebuild).not.toHaveBeenCalled();
  });

  test('keeps ordinary tail token deltas constant-work without rebuilding prior text', () => {
    const tokenCount = 4096;
    const snapshot = accumulateResponse(
      createdEvent(makeResponse({ output: [message('msg_0', [textPart('')])] })),
    );
    const [output] = snapshot.output;
    if (output?.type !== 'message') {
      throw new Error('expected an output message');
    }
    const [content] = output.content;
    if (content?.type !== 'output_text') {
      throw new Error('expected an output text part');
    }

    let textReads = 0;
    let currentText = content.text;
    Object.defineProperty(content, 'text', {
      configurable: true,
      enumerable: true,
      get(): string {
        textReads += 1;
        return currentText;
      },
      set(nextText: string): void {
        currentText = nextText;
      },
    });
    const rebuild = vi.spyOn(ResponsesParser, 'addOutputText');

    for (let index = 0; index < tokenCount; index += 1) {
      accumulateResponse(textDeltaEvent(0, 0, 'x', index + 1), snapshot);
    }

    expect(snapshot.output_text).toBe('x'.repeat(tokenCount));
    expect(textReads).toBeLessThanOrEqual(tokenCount * 4);
    expect(rebuild).not.toHaveBeenCalled();
  });

  test('rejects inherited sparse output and content indices before mutating output_text', () => {
    const sparseOutput: OutputItem[] = [];
    sparseOutput.length = 1;
    const outputPrototype = Object.create(Array.prototype) as Record<number, OutputItem>;
    outputPrototype[0] = message('inherited', [textPart('inherited')]);
    Object.setPrototypeOf(sparseOutput, outputPrototype);
    const outputSnapshot = makeResponse({ output: [], output_text: 'unchanged' });
    outputSnapshot.output = sparseOutput;

    expect(() => accumulateResponse(outputDoneEvent(functionCall('tool_0'), 0, 1), outputSnapshot)).toThrow(
      'missing output at index 0',
    );
    expect(outputSnapshot.output_text).toBe('unchanged');

    const contentSnapshot = accumulateResponse(
      createdEvent(makeResponse({ output: [message('msg_0', [textPart('A')])] })),
    );
    const [output] = contentSnapshot.output;
    if (output?.type !== 'message') {
      throw new Error('expected an output message');
    }
    const [inheritedContent] = output.content;
    if (!inheritedContent) {
      throw new Error('expected output content');
    }
    const contentPrototype = Object.create(Array.prototype) as Record<number, MessageContent>;
    contentPrototype[0] = inheritedContent;
    Reflect.deleteProperty(output.content, 0);
    Object.setPrototypeOf(output.content, contentPrototype);

    expect(() => accumulateResponse(contentDoneEvent(0, 0, refusalPart(), 1), contentSnapshot)).toThrow(
      'missing content at index 0',
    );
    expect(contentSnapshot.output_text).toBe('A');
  });
});
