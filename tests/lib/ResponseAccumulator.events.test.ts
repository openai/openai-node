import { OpenAIError } from 'openai/core/error';
import { hasOwn } from 'openai/internal/utils';
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

  test('appends annotations sequentially and allows existing annotations to be replayed', () => {
    const snapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    });
    const event = {
      type: 'response.output_text.annotation.added',
      output_index: 0,
      content_index: 0,
      annotation_index: 0,
      annotation: { type: 'url_citation', url: 'https://example.com/first' },
    };

    applyEvent(snapshot, event);
    applyEvent(snapshot, {
      ...event,
      annotation: { type: 'url_citation', url: 'https://example.com/replayed' },
    });
    applyEvent(snapshot, {
      ...event,
      annotation_index: 1,
      annotation: { type: 'url_citation', url: 'https://example.com/second' },
    });

    expect(snapshot.output[0]).toMatchObject({
      content: [
        {
          annotations: [{ url: 'https://example.com/replayed' }, { url: 'https://example.com/second' }],
        },
      ],
    });
  });

  test('appends output, content, and summary at their declared contiguous indices', () => {
    const outputSnapshot = snapshotFor({ type: 'function_call', id: 'original', arguments: '' });
    const replayedOutput = { type: 'function_call', id: 'replayed', arguments: '' };

    applyEvent(outputSnapshot, {
      type: 'response.output_item.added',
      output_index: 1,
      item: replayedOutput,
    });

    expect(outputSnapshot.output).toHaveLength(2);
    expect(outputSnapshot.output[1]).toEqual(replayedOutput);

    const contentSnapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: 'original', annotations: [] }],
    });
    const replayedContent = { type: 'output_text', text: 'replayed', annotations: [] };

    applyEvent(contentSnapshot, {
      type: 'response.content_part.added',
      output_index: 0,
      content_index: 1,
      part: replayedContent,
    });

    const contentOutput = contentSnapshot.output[0] as { content: unknown[] };
    expect(contentOutput.content).toHaveLength(2);
    expect(contentOutput.content[1]).toEqual(replayedContent);

    const summarySnapshot = snapshotFor({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'original' }],
    });
    const replayedSummary = { type: 'summary_text', text: 'replayed' };

    applyEvent(summarySnapshot, {
      type: 'response.reasoning_summary_part.added',
      output_index: 0,
      summary_index: 1,
      part: replayedSummary,
    });

    const summaryOutput = summarySnapshot.output[0] as { summary: unknown[] };
    expect(summaryOutput.summary).toHaveLength(2);
    expect(summaryOutput.summary[1]).toEqual(replayedSummary);
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

describe('ResponseAccumulator hosted shell events', () => {
  test('accumulates interleaved commands and replaces each with its authoritative value', () => {
    const snapshot = snapshotFor({
      type: 'shell_call',
      id: 'sh_123',
      call_id: 'call_123',
      action: { commands: [], timeout_ms: null, max_output_length: null },
    });

    applyEvent(snapshot, {
      type: 'response.shell_call_command.added',
      output_index: 0,
      command_index: 0,
      command: '',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_command.added',
      output_index: 0,
      command_index: 1,
      command: 'echo ',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_command.delta',
      output_index: 0,
      command_index: 1,
      delta: 'second',
      obfuscation: 'padding',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_command.delta',
      output_index: 0,
      command_index: 0,
      delta: 'echo first draft',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_command.done',
      output_index: 0,
      command_index: 0,
      command: 'echo first',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_command.done',
      output_index: 0,
      command_index: 1,
      command: 'echo second',
    });

    expect(snapshot.output[0]).toMatchObject({
      type: 'shell_call',
      action: { commands: ['echo first', 'echo second'] },
    });
  });

  test('accumulates out-of-order command outputs and detaches authoritative completions', () => {
    const snapshot = accumulateResponse({
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse([
        outputItem({
          type: 'shell_call',
          id: 'sh_123',
          call_id: 'call_123',
          action: { commands: ['first', 'second'], timeout_ms: null, max_output_length: null },
        }),
        outputItem({
          type: 'shell_call_output',
          id: 'sho_123',
          call_id: 'call_123',
          output: [],
        }),
      ]),
    });

    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.delta',
      output_index: 1,
      command_index: 1,
      delta: { stdout: 'second ' },
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.delta',
      output_index: 1,
      command_index: 0,
      delta: { stderr: 'first warning' },
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.delta',
      output_index: 1,
      command_index: 1,
      delta: { stdout: 'output', stderr: 'second warning' },
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.delta',
      output_index: 1,
      command_index: 0,
      delta: { stdout: 'first output' },
    });

    expect(snapshot.output[1]).toMatchObject({
      type: 'shell_call_output',
      output: [
        {
          stdout: 'first output',
          stderr: 'first warning',
          outcome: { type: 'exit', exit_code: 0 },
        },
        {
          stdout: 'second output',
          stderr: 'second warning',
          outcome: { type: 'exit', exit_code: 0 },
        },
      ],
    });

    const second = {
      stdout: 'authoritative second',
      stderr: '',
      outcome: { type: 'timeout' },
    };
    const first = {
      stdout: 'authoritative first',
      stderr: 'authoritative warning',
      outcome: { type: 'exit', exit_code: 7 },
    };

    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.done',
      output_index: 1,
      command_index: 1,
      output: [second],
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.done',
      output_index: 1,
      command_index: 0,
      output: [first],
    });

    const [, shellOutput] = snapshot.output;
    expect(shellOutput).toMatchObject({ type: 'shell_call_output', output: [first, second] });
    if (shellOutput?.type === 'shell_call_output') {
      expect(shellOutput.output[0]).not.toBe(first);
      expect(shellOutput.output[0]?.outcome).not.toBe(first.outcome);
      expect(shellOutput.output[1]).not.toBe(second);
      expect(shellOutput.output[1]?.outcome).not.toBe(second.outcome);
    }
  });

  test('rejects malformed command indices and empty authoritative output', () => {
    const shellCall = snapshotFor({
      type: 'shell_call',
      id: 'sh_123',
      call_id: 'call_123',
      action: { commands: [], timeout_ms: null, max_output_length: null },
    });

    expect(() =>
      applyEvent(shellCall, {
        type: 'response.shell_call_command.delta',
        output_index: 0,
        command_index: 0,
        delta: 'missing',
      }),
    ).toThrow('missing command at index 0');

    expect(() =>
      applyEvent(shellCall, {
        type: 'response.shell_call_command.added',
        output_index: 0,
        command_index: 2,
        command: 'missing predecessors',
      }),
    ).toThrow('missing command at index 2');

    const shellOutput = snapshotFor({
      type: 'shell_call_output',
      id: 'sho_123',
      call_id: 'call_123',
      output: [],
    });

    expect(() =>
      applyEvent(shellOutput, {
        type: 'response.shell_call_output_content.delta',
        output_index: 0,
        command_index: 1,
        delta: { stdout: 'missing predecessor' },
      }),
    ).toThrow('missing content at index 1');

    expect(() =>
      applyEvent(shellOutput, {
        type: 'response.shell_call_output_content.done',
        output_index: 0,
        command_index: 0,
        output: [],
      }),
    ).toThrow('missing content at index 0');
  });

  test('does not apply hosted shell events to an incompatible output item', () => {
    const snapshot = snapshotFor({ type: 'message', content: [], status: 'in_progress' });

    applyEvent(snapshot, {
      type: 'response.shell_call_command.added',
      output_index: 0,
      command_index: 0,
      command: 'ignored',
    });
    applyEvent(snapshot, {
      type: 'response.shell_call_output_content.delta',
      output_index: 0,
      command_index: 0,
      delta: { stdout: 'ignored' },
    });

    expect(snapshot.output[0]).toEqual({
      type: 'message',
      content: [],
      status: 'in_progress',
    });
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

  test.each(['__proto__', 'constructor', 'push'])(
    'rejects inherited output index %s without replacing the output array prototype',
    (index) => {
      const snapshot = makeResponse();
      const outputPrototype = Object.getPrototypeOf(snapshot.output);

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_item.done',
          output_index: index,
          item: { type: 'message', content: [] },
        }),
      ).toThrow(`missing output at index ${index}`);

      expect(Object.getPrototypeOf(snapshot.output)).toBe(outputPrototype);
      expect(Object.getPrototypeOf(snapshot.output)).toBe(Array.prototype);
      expect(snapshot.output).toHaveLength(0);
    },
  );

  test.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1,
    4_294_967_294,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
  ])('rejects malformed or missing existing output index %s before mutation', (index) => {
    const snapshot = snapshotFor({ type: 'message', content: [] });
    const [original] = snapshot.output;

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.done',
        output_index: index,
        item: { type: 'message', content: [{ type: 'output_text', text: 'injected' }] },
      }),
    ).toThrow(`missing output at index ${index}`);

    expect(snapshot.output).toHaveLength(1);
    expect(snapshot.output[0]).toBe(original);
    expect(Object.getPrototypeOf(snapshot.output)).toBe(Array.prototype);
  });

  test.each([
    ['message', { type: 'output_text', text: 'injected', annotations: [] }],
    ['reasoning', { type: 'reasoning_text', text: 'injected' }],
  ])('rejects inherited %s content indices before replacing the content array prototype', (type, part) => {
    const snapshot = snapshotFor({ type, summary: [], content: [] });
    const output = snapshot.output[0] as { content: unknown[] };

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.content_part.done',
        output_index: 0,
        content_index: '__proto__',
        part,
      }),
    ).toThrow('missing content at index __proto__');

    expect(Object.getPrototypeOf(output.content)).toBe(Array.prototype);
    expect(output.content).toHaveLength(0);
  });

  test.each([-1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY, 1, 4_294_967_294, '0'])(
    'rejects malformed or missing existing content index %s before mutation',
    (index) => {
      const snapshot = snapshotFor({
        type: 'message',
        content: [{ type: 'output_text', text: 'unchanged', annotations: [] }],
      });
      const output = snapshot.output[0] as { content: unknown[] };
      const [original] = output.content;

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.content_part.done',
          output_index: 0,
          content_index: index,
          part: { type: 'output_text', text: 'injected', annotations: [] },
        }),
      ).toThrow(`missing content at index ${index}`);

      expect(output.content).toHaveLength(1);
      expect(output.content[0]).toBe(original);
      expect(Object.getPrototypeOf(output.content)).toBe(Array.prototype);
    },
  );

  test('rejects inherited summary indices before replacing the summary array prototype', () => {
    const snapshot = snapshotFor({ type: 'reasoning', summary: [] });
    const output = snapshot.output[0] as { summary: unknown[] };

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.reasoning_summary_part.done',
        output_index: 0,
        summary_index: '__proto__',
        part: { type: 'summary_text', text: 'injected' },
      }),
    ).toThrow('missing content at index __proto__');

    expect(Object.getPrototypeOf(output.summary)).toBe(Array.prototype);
    expect(output.summary).toHaveLength(0);
  });

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1, 4_294_967_294, '0'])(
    'rejects malformed or missing existing summary index %s before mutation',
    (index) => {
      const snapshot = snapshotFor({
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'unchanged' }],
      });
      const output = snapshot.output[0] as { summary: unknown[] };
      const [original] = output.summary;

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.reasoning_summary_part.done',
          output_index: 0,
          summary_index: index,
          part: { type: 'summary_text', text: 'injected' },
        }),
      ).toThrow(`missing content at index ${index}`);

      expect(output.summary).toHaveLength(1);
      expect(output.summary[0]).toBe(original);
      expect(Object.getPrototypeOf(output.summary)).toBe(Array.prototype);
    },
  );

  test.each([
    ['output', 'response.output_item.added', 'output_index'],
    ['content', 'response.content_part.added', 'content_index'],
    ['summary', 'response.reasoning_summary_part.added', 'summary_index'],
  ])('rejects a noncontiguous %s index before appending', (kind, type, indexField) => {
    const snapshot =
      kind === 'output'
        ? makeResponse()
        : snapshotFor({
            type: kind === 'summary' ? 'reasoning' : 'message',
            content: [],
            summary: [],
          });

    expect(() =>
      applyEvent(snapshot, {
        type,
        output_index: 0,
        [indexField]: 4_294_967_294,
        item: { type: 'message', content: [] },
        part: {
          type: kind === 'summary' ? 'summary_text' : 'output_text',
          text: 'injected',
          annotations: [],
        },
      }),
    ).toThrow();

    if (kind === 'output') {
      expect(snapshot.output).toHaveLength(0);
    } else {
      const output = snapshot.output[0] as { content: unknown[]; summary: unknown[] };
      expect(kind === 'content' ? output.content : output.summary).toHaveLength(0);
    }
  });

  test('does not initialize missing reasoning content for an invalid appended content index', () => {
    const snapshot = snapshotFor({ type: 'reasoning', summary: [] });

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 1,
        part: { type: 'reasoning_text', text: 'injected' },
      }),
    ).toThrow('missing content at index 1');

    expect(snapshot.output[0]).not.toHaveProperty('content');
  });

  test.each([
    ['output', 'response.output_item.added', 'output_index'],
    ['content', 'response.content_part.added', 'content_index'],
    ['summary', 'response.reasoning_summary_part.added', 'summary_index'],
  ])('rejects an inherited %s index before appending', (kind, type, indexField) => {
    const snapshot =
      kind === 'output'
        ? makeResponse()
        : snapshotFor({
            type: kind === 'summary' ? 'reasoning' : 'message',
            content: [],
            summary: [],
          });

    expect(() =>
      applyEvent(snapshot, {
        type,
        output_index: 0,
        [indexField]: '__proto__',
        item: { type: 'message', content: [] },
        part: {
          type: kind === 'summary' ? 'summary_text' : 'output_text',
          text: 'injected',
          annotations: [],
        },
      }),
    ).toThrow();

    if (kind === 'output') {
      expect(snapshot.output).toHaveLength(0);
      expect(Object.getPrototypeOf(snapshot.output)).toBe(Array.prototype);
    } else {
      const output = snapshot.output[0] as { content: unknown[]; summary: unknown[] };
      const collection = kind === 'content' ? output.content : output.summary;
      expect(collection).toHaveLength(0);
      expect(Object.getPrototypeOf(collection)).toBe(Array.prototype);
    }
  });

  test.each([
    '__proto__',
    'constructor',
    '0',
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1,
    4_294_967_294,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid or noncontiguous annotation index %s without expanding the array', (index) => {
    const snapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    });
    const output = snapshot.output[0] as unknown as { content: [{ annotations: unknown[] }] };
    const [{ annotations }] = output.content;

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        content_index: 0,
        annotation_index: index,
        annotation: { type: 'url_citation', url: 'https://example.com/injected' },
      }),
    ).toThrow(`missing annotation at index ${index}`);

    expect(annotations).toHaveLength(0);
    expect(Object.getPrototypeOf(annotations)).toBe(Array.prototype);
  });

  for (const declaredIndex of [0, 1]) {
    test.each([
      ['output', 'response.output_item.added', 'output_index'],
      ['content', 'response.content_part.added', 'content_index'],
      ['summary', 'response.reasoning_summary_part.added', 'summary_index'],
    ])(`rejects %s setter with declared index ${declaredIndex}`, (kind, type, indexField) => {
      let snapshot: Response;
      if (kind === 'output') {
        snapshot = snapshotFor({ type: 'function_call', id: 'original', arguments: '' });
      } else if (kind === 'content') {
        snapshot = snapshotFor({
          type: 'message',
          content: [{ type: 'output_text', text: 'original', annotations: [] }],
          summary: [],
        });
      } else {
        snapshot = snapshotFor({
          type: 'reasoning',
          content: [],
          summary: [{ type: 'summary_text', text: 'original' }],
        });
      }
      const output = snapshot.output[0] as { content: unknown[]; summary: unknown[] };
      let collection: unknown[];
      if (kind === 'output') {
        collection = snapshot.output;
      } else if (kind === 'content') {
        collection = output.content;
      } else {
        collection = output.summary;
      }
      let inheritedSetterCalled = false;
      const collectionPrototype = Object.create(Array.prototype) as object;
      Object.defineProperty(collectionPrototype, 1, {
        configurable: true,
        get() {
          return null;
        },
        set() {
          inheritedSetterCalled = true;
        },
      });
      Object.setPrototypeOf(collection, collectionPrototype);

      expect(() =>
        applyEvent(snapshot, {
          type,
          output_index: 0,
          [indexField]: declaredIndex,
          item: { type: 'function_call', id: 'injected', arguments: '' },
          part: {
            type: kind === 'summary' ? 'summary_text' : 'output_text',
            text: 'injected',
            annotations: [],
          },
        }),
      ).toThrow(`missing ${kind === 'summary' ? 'content' : kind} at index ${declaredIndex}`);

      expect(inheritedSetterCalled).toBe(false);
      expect(collection).toHaveLength(1);
      expect(hasOwn(collection, 1)).toBe(false);
    });
  }

  test('rejects inherited numeric setters before appending annotations', () => {
    const snapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    });
    const output = snapshot.output[0] as unknown as { content: [{ annotations: unknown[] }] };
    const [{ annotations }] = output.content;
    let inheritedSetterCalled = false;
    const annotationPrototype = Object.create(Array.prototype) as object;
    Object.defineProperty(annotationPrototype, 0, {
      configurable: true,
      get() {
        return null;
      },
      set() {
        inheritedSetterCalled = true;
      },
    });
    Object.setPrototypeOf(annotations, annotationPrototype);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        content_index: 0,
        annotation_index: 0,
        annotation: { type: 'url_citation', url: 'https://example.com/injected' },
      }),
    ).toThrow('missing annotation at index 0');

    expect(inheritedSetterCalled).toBe(false);
    expect(annotations).toHaveLength(0);
    expect(hasOwn(annotations, 0)).toBe(false);
  });

  test('rejects inherited values in sparse output, content, summary, and annotation arrays', () => {
    const inheritedOutput = { type: 'message', content: [] };
    const outputPrototype = Object.create(Array.prototype) as Record<number, unknown>;
    outputPrototype[0] = inheritedOutput;
    const sparseOutput: OutputItem[] = [];
    sparseOutput.length = 1;
    Object.setPrototypeOf(sparseOutput, outputPrototype);
    const outputSnapshot = makeResponse(sparseOutput);

    expect(() =>
      applyEvent(outputSnapshot, {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message', content: [] },
      }),
    ).toThrow('missing output at index 0');
    expect(hasOwn(sparseOutput, 0)).toBe(false);
    expect(Object.getPrototypeOf(sparseOutput)).toBe(outputPrototype);

    const contentSnapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: 'unchanged', annotations: [] }],
    });
    const contentOutput = contentSnapshot.output[0] as unknown as {
      content: [{ type: string; text: string; annotations: unknown[] }];
    };
    const [inheritedContent] = contentOutput.content;
    const contentPrototype = Object.create(Array.prototype) as Record<number, unknown>;
    contentPrototype[0] = inheritedContent;
    Reflect.deleteProperty(contentOutput.content, 0);
    Object.setPrototypeOf(contentOutput.content, contentPrototype);

    expect(() =>
      applyEvent(contentSnapshot, {
        type: 'response.content_part.done',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: 'injected', annotations: [] },
      }),
    ).toThrow('missing content at index 0');
    expect(hasOwn(contentOutput.content, 0)).toBe(false);
    expect(inheritedContent.text).toBe('unchanged');

    const summarySnapshot = snapshotFor({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'unchanged' }],
    });
    const summaryOutput = summarySnapshot.output[0] as unknown as {
      summary: [{ type: string; text: string }];
    };
    const [inheritedSummary] = summaryOutput.summary;
    const summaryPrototype = Object.create(Array.prototype) as Record<number, unknown>;
    summaryPrototype[0] = inheritedSummary;
    Reflect.deleteProperty(summaryOutput.summary, 0);
    Object.setPrototypeOf(summaryOutput.summary, summaryPrototype);

    expect(() =>
      applyEvent(summarySnapshot, {
        type: 'response.reasoning_summary_part.done',
        output_index: 0,
        summary_index: 0,
        part: { type: 'summary_text', text: 'injected' },
      }),
    ).toThrow('missing content at index 0');
    expect(hasOwn(summaryOutput.summary, 0)).toBe(false);
    expect(inheritedSummary.text).toBe('unchanged');

    const annotationSnapshot = snapshotFor({
      type: 'message',
      content: [{ type: 'output_text', text: '', annotations: [{}] }],
    });
    const annotationOutput = annotationSnapshot.output[0] as unknown as {
      content: [{ annotations: unknown[] }];
    };
    const [{ annotations }] = annotationOutput.content;
    const annotationPrototype = Object.create(Array.prototype) as Record<number, unknown>;
    [annotationPrototype[0]] = annotations;
    delete annotations[0];
    Object.setPrototypeOf(annotations, annotationPrototype);

    expect(() =>
      applyEvent(annotationSnapshot, {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        content_index: 0,
        annotation_index: 0,
        annotation: { type: 'url_citation', url: 'https://example.com/injected' },
      }),
    ).toThrow('missing annotation at index 0');
    expect(annotations).toHaveLength(1);
    expect(hasOwn(annotations, 0)).toBe(false);
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
