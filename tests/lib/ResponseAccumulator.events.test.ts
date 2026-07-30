import { OpenAIError } from 'openai/core/error';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';

type OutputItem = Response['output'][number];

function makeResponse(output: OutputItem[] = []): Response {
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
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  } as Response;
}

function outputItem(value: Record<string, unknown>): OutputItem {
  return value as unknown as OutputItem;
}

function snapshotFor(item: Record<string, unknown>): Response {
  return accumulateResponse({
    type: 'response.created',
    sequence_number: 0,
    response: makeResponse([outputItem(item)]),
  });
}

function applyEvent(snapshot: Response, event: Record<string, unknown>): Response {
  return accumulateResponse({ sequence_number: 1, ...event } as ResponseStreamEvent, snapshot);
}

describe('ResponseAccumulator output and content events', () => {
  test('replaces completed output items with detached authoritative copies', () => {
    const snapshot = snapshotFor({
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    });
    const completed = {
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'complete', annotations: [] }],
    };

    applyEvent(snapshot, {
      type: 'response.output_item.done',
      output_index: 0,
      item: completed,
    });

    expect(snapshot.output[0]).toEqual(completed);
    expect(snapshot.output[0]).not.toBe(completed);
    expect(snapshot.output_text).toBe('complete');
  });

  test('accumulates and finalizes text, annotations, and refusals', () => {
    const snapshot = snapshotFor({
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      status: 'in_progress',
      content: [
        { type: 'output_text', text: '', annotations: [] },
        { type: 'refusal', refusal: '' },
      ],
    });

    applyEvent(snapshot, {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      delta: 'draft',
    });
    expect(snapshot.output_text).toBe('draft');

    applyEvent(snapshot, {
      type: 'response.output_text.done',
      output_index: 0,
      content_index: 0,
      text: 'final answer',
    });
    applyEvent(snapshot, {
      type: 'response.output_text.annotation.added',
      output_index: 0,
      content_index: 0,
      annotation_index: 0,
      annotation: { type: 'url_citation', url: 'https://example.com', title: 'Example' },
    });
    applyEvent(snapshot, {
      type: 'response.refusal.delta',
      output_index: 0,
      content_index: 1,
      delta: 'draft refusal',
    });
    applyEvent(snapshot, {
      type: 'response.refusal.done',
      output_index: 0,
      content_index: 1,
      refusal: 'final refusal',
    });

    expect(snapshot.output_text).toBe('final answer');
    expect(snapshot.output[0]).toMatchObject({
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'final answer',
          annotations: [{ type: 'url_citation', url: 'https://example.com' }],
        },
        { type: 'refusal', refusal: 'final refusal' },
      ],
    });
  });

  test('adds and replaces detached message content parts', () => {
    const snapshot = snapshotFor({
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    });
    const part = { type: 'output_text', text: 'draft', annotations: [] };
    const finalPart = { type: 'output_text', text: 'final', annotations: [] };

    applyEvent(snapshot, {
      type: 'response.content_part.added',
      output_index: 0,
      content_index: 0,
      part,
    });
    expect(snapshot.output_text).toBe('draft');

    applyEvent(snapshot, {
      type: 'response.content_part.done',
      output_index: 0,
      content_index: 0,
      part: finalPart,
    });

    expect(snapshot.output_text).toBe('final');
    expect((snapshot.output[0] as { content: unknown[] }).content[0]).toEqual(finalPart);
    expect((snapshot.output[0] as { content: unknown[] }).content[0]).not.toBe(finalPart);
  });
});

describe('ResponseAccumulator tool-call deltas', () => {
  test.each([
    [
      'function_call',
      'arguments',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
    ],
    [
      'custom_tool_call',
      'input',
      'response.custom_tool_call_input.delta',
      'response.custom_tool_call_input.done',
    ],
    ['mcp_call', 'arguments', 'response.mcp_call_arguments.delta', 'response.mcp_call_arguments.done'],
    [
      'code_interpreter_call',
      'code',
      'response.code_interpreter_call_code.delta',
      'response.code_interpreter_call_code.done',
    ],
  ] as const)('accumulates and finalizes %s %s', (itemType, field, deltaEvent, doneEvent) => {
    const snapshot = snapshotFor({
      type: itemType,
      id: 'item_123',
      [field]: itemType === 'code_interpreter_call' ? null : '',
    });

    applyEvent(snapshot, { type: deltaEvent, output_index: 0, delta: 'draft' });
    expect(snapshot.output[0]).toMatchObject({ [field]: 'draft' });

    applyEvent(snapshot, { type: doneEvent, output_index: 0, [field]: 'final' });
    expect(snapshot.output[0]).toMatchObject({ [field]: 'final' });
  });

  test.each([
    ['response.code_interpreter_call.in_progress', 'code_interpreter_call', 'in_progress'],
    ['response.code_interpreter_call.interpreting', 'code_interpreter_call', 'interpreting'],
    ['response.code_interpreter_call.completed', 'code_interpreter_call', 'completed'],
    ['response.file_search_call.in_progress', 'file_search_call', 'in_progress'],
    ['response.file_search_call.searching', 'file_search_call', 'searching'],
    ['response.file_search_call.completed', 'file_search_call', 'completed'],
    ['response.web_search_call.in_progress', 'web_search_call', 'in_progress'],
    ['response.web_search_call.searching', 'web_search_call', 'searching'],
    ['response.web_search_call.completed', 'web_search_call', 'completed'],
    ['response.image_generation_call.in_progress', 'image_generation_call', 'in_progress'],
    ['response.image_generation_call.generating', 'image_generation_call', 'generating'],
    ['response.image_generation_call.completed', 'image_generation_call', 'completed'],
    ['response.mcp_call.in_progress', 'mcp_call', 'in_progress'],
    ['response.mcp_call.completed', 'mcp_call', 'completed'],
    ['response.mcp_call.failed', 'mcp_call', 'failed'],
  ] as const)('applies %s lifecycle status', (eventType, outputType, expectedStatus) => {
    const snapshot = snapshotFor({ type: outputType, id: 'item_123', status: 'queued' });

    applyEvent(snapshot, { type: eventType, output_index: 0 });

    expect(snapshot.output[0]).toMatchObject({ type: outputType, status: expectedStatus });
  });

  test('does not apply tool-call events to a different output type', () => {
    const snapshot = snapshotFor({ type: 'message', content: [], status: 'in_progress' });

    applyEvent(snapshot, {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: 'ignored',
    });
    applyEvent(snapshot, { type: 'response.file_search_call.completed', output_index: 0 });

    expect(snapshot.output[0]).toMatchObject({ type: 'message', status: 'in_progress' });
  });
});

describe('ResponseAccumulator reasoning events', () => {
  test('creates, accumulates, and finalizes reasoning content and summaries', () => {
    const snapshot = snapshotFor({ type: 'reasoning', id: 'reasoning_123', summary: [] });

    applyEvent(snapshot, {
      type: 'response.content_part.added',
      output_index: 0,
      content_index: 0,
      part: { type: 'reasoning_text', text: '' },
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_text.delta',
      output_index: 0,
      content_index: 0,
      delta: 'draft reasoning',
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_text.done',
      output_index: 0,
      content_index: 0,
      text: 'final reasoning',
    });
    applyEvent(snapshot, {
      type: 'response.content_part.done',
      output_index: 0,
      content_index: 0,
      part: { type: 'reasoning_text', text: 'authoritative reasoning' },
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_summary_part.added',
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: '' },
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_summary_text.delta',
      output_index: 0,
      summary_index: 0,
      delta: 'draft summary',
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_summary_text.done',
      output_index: 0,
      summary_index: 0,
      text: 'final summary',
    });
    applyEvent(snapshot, {
      type: 'response.reasoning_summary_part.done',
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: 'authoritative summary' },
    });

    expect(snapshot.output[0]).toMatchObject({
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text: 'authoritative reasoning' }],
      summary: [{ type: 'summary_text', text: 'authoritative summary' }],
    });
  });
});

describe('ResponseAccumulator lifecycle and error handling', () => {
  test.each(['response.created', 'response.queued', 'response.in_progress', 'response.completed'] as const)(
    'replaces the snapshot with a detached %s response',
    (type) => {
      const snapshot = makeResponse();
      const authoritative = makeResponse([
        outputItem({
          type: 'message',
          id: 'msg_123',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'authoritative', annotations: [] }],
        }),
      ]);
      delete (authoritative as Partial<Response>).output_text;

      const result = applyEvent(snapshot, { type, response: authoritative });

      expect(result).not.toBe(snapshot);
      expect(result).not.toBe(authoritative);
      expect(result.output_text).toBe('authoritative');
    },
  );

  test.each([
    'response.audio.delta',
    'response.audio.done',
    'response.audio.transcript.delta',
    'response.audio.transcript.done',
    'response.image_generation_call.partial_image',
    'response.mcp_list_tools.in_progress',
    'response.mcp_list_tools.completed',
    'response.mcp_list_tools.failed',
    'keepalive',
    'error',
  ])('ignores stateless %s events', (type) => {
    const snapshot = makeResponse();

    expect(applyEvent(snapshot, { type })).toBe(snapshot);
  });

  test('requires a created event before receiving incremental updates', () => {
    expect(() =>
      accumulateResponse({ type: 'response.completed', sequence_number: 0, response: makeResponse() }),
    ).toThrow("expected 'response.created' event, got response.completed");
  });

  test('reports missing output and content indices', () => {
    const missingOutput = makeResponse();
    const missingContent = snapshotFor({ type: 'message', content: [] });

    expect(() =>
      applyEvent(missingOutput, { type: 'response.output_item.done', output_index: 1, item: {} }),
    ).toThrow('missing output at index 1');
    expect(() =>
      applyEvent(missingContent, {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 1,
        delta: 'missing',
      }),
    ).toThrow('missing content at index 1');
  });

  test.each([
    ['response.output_text.delta', { type: 'refusal', refusal: '' }, "expected content to be 'output_text'"],
    ['response.output_text.done', { type: 'refusal', refusal: '' }, "expected content to be 'output_text'"],
    [
      'response.output_text.annotation.added',
      { type: 'refusal', refusal: '' },
      "expected content to be 'output_text'",
    ],
    ['response.refusal.delta', { type: 'output_text', text: '' }, "expected content to be 'refusal'"],
    ['response.refusal.done', { type: 'output_text', text: '' }, "expected content to be 'refusal'"],
  ])('rejects incompatible content for %s', (type, content, expectedMessage) => {
    const snapshot = snapshotFor({ type: 'message', content: [content] });

    expect(() =>
      applyEvent(snapshot, {
        type,
        output_index: 0,
        content_index: 0,
        annotation_index: 0,
        annotation: {},
        delta: 'ignored',
        text: 'ignored',
        refusal: 'ignored',
      }),
    ).toThrow(expectedMessage);
  });

  test.each(['response.reasoning_text.delta', 'response.reasoning_text.done'])(
    'requires reasoning content for %s',
    (type) => {
      const snapshot = snapshotFor({ type: 'reasoning', summary: [] });

      expect(() =>
        applyEvent(snapshot, { type, output_index: 0, content_index: 0, delta: '', text: '' }),
      ).toThrow('missing content at index 0');
    },
  );

  test('requires existing reasoning content before finalizing a content part', () => {
    const snapshot = snapshotFor({ type: 'reasoning', summary: [] });

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.content_part.done',
        output_index: 0,
        content_index: 0,
        part: { type: 'reasoning_text', text: 'final' },
      }),
    ).toThrow('missing content at index 0');
  });

  test('rejects reasoning content with an incompatible type', () => {
    const snapshot = snapshotFor({
      type: 'reasoning',
      summary: [],
      content: [{ type: 'output_text', text: '' }],
    });

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.reasoning_text.delta',
        output_index: 0,
        content_index: 0,
        delta: '',
      }),
    ).toThrow("expected content to be 'reasoning_text', got output_text");

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.reasoning_text.done',
        output_index: 0,
        content_index: 0,
        text: '',
      }),
    ).toThrow("expected content to be 'reasoning_text', got output_text");
  });

  test('rejects unsupported future response events', () => {
    expect(() => applyEvent(makeResponse(), { type: 'response.future_event' })).toThrow(OpenAIError);
    expect(() => applyEvent(makeResponse(), { type: 'response.future_event' })).toThrow(
      'Unhandled response stream event',
    );
  });
});
