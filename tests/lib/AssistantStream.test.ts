import { APIUserAbortError, OpenAIError } from 'openai/core/error';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants';

type Event = Record<string, any>;

function readableEvents(events: Event[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(events.map((event) => encoder.encode(JSON.stringify(event) + '\n')));
}

function assistantStream(events: Event[]): AssistantStream {
  return AssistantStream.fromReadableStream(readableEvents(events));
}

function iterableEvents(events: Event[], controller = new AbortController()) {
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event as AssistantStreamEvent;
      }
    },
  };
}

function completedRun(id = 'run_123') {
  return { event: 'thread.run.completed', data: { id, status: 'completed' } };
}

describe('AssistantStream delta accumulation', () => {
  test('accumulates numbers, nested records, and arrays of primitive values', () => {
    expect(
      AssistantStream.accumulateDelta(
        { count: 1, nested: { value: 'hello' }, strings: ['first'], numbers: [1] },
        { count: 2, nested: { value: ' world' }, strings: ['second'], numbers: [2] },
      ),
    ).toEqual({
      count: 3,
      nested: { value: 'hello world' },
      strings: ['first', 'second'],
      numbers: [1, 2],
    });
  });

  test('replaces null values and special index or type properties', () => {
    expect(
      AssistantStream.accumulateDelta(
        { value: undefined, index: 0, type: 'initial' },
        { value: 'created', index: 1, type: 'updated' },
      ),
    ).toEqual({ value: 'created', index: 1, type: 'updated' });
  });

  test('inserts and updates indexed object array entries', () => {
    const result = AssistantStream.accumulateDelta(
      { entries: [{ index: 0, text: 'first' }] },
      {
        entries: [
          { index: 0, text: ' updated' },
          { index: 1, text: 'second' },
        ],
      },
    );

    expect(result).toEqual({
      entries: [
        { index: 0, text: 'first updated' },
        { index: 1, text: 'second' },
      ],
    });
  });

  test('rejects malformed indexed array deltas', () => {
    expect(() => AssistantStream.accumulateDelta({ entries: [{}] }, { entries: ['invalid'] })).toThrow(
      'Expected array delta entry to be an object',
    );
    expect(() => AssistantStream.accumulateDelta({ entries: [{}] }, { entries: [{ index: '0' }] })).toThrow(
      'property to be a number',
    );

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => AssistantStream.accumulateDelta({ entries: [{}] }, { entries: [{}] })).toThrow(
        'Expected array delta entry to have an `index` property',
      );
      expect(consoleError).toHaveBeenCalledWith({});
    } finally {
      consoleError.mockRestore();
    }
  });

  test('rejects incompatible accumulated value types', () => {
    expect(() => AssistantStream.accumulateDelta({ value: true }, { value: 'invalid' })).toThrow(
      'Unhandled record type: value',
    );
  });
});

describe('AssistantStream snapshots and message lifecycle', () => {
  test('accumulates message content and exposes current and final snapshots', async () => {
    const initialMessage = { id: 'msg_123', role: 'assistant', status: 'in_progress', content: [] };
    const finalMessage = {
      ...initialMessage,
      status: 'completed',
      content: [
        { type: 'text', text: { value: 'hello world', annotations: [] } },
        { type: 'image_file', image_file: { file_id: 'file_123' } },
        { type: 'text', text: { value: 'goodbye', annotations: [] } },
      ],
    };
    const finalRun = completedRun();
    const runner = assistantStream([
      { event: 'thread.created', data: { id: 'thread_123' } },
      { event: 'thread.run.created', data: { id: 'run_123', status: 'queued' } },
      { event: 'thread.run.queued', data: { id: 'run_123', status: 'queued' } },
      { event: 'thread.run.in_progress', data: { id: 'run_123', status: 'in_progress' } },
      { event: 'thread.run.cancelling', data: { id: 'run_123', status: 'cancelling' } },
      { event: 'thread.message.created', data: initialMessage },
      { event: 'thread.message.in_progress', data: initialMessage },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: { content: [{ index: 0, type: 'text', text: { value: 'hello ', annotations: [] } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: { id: 'msg_123', delta: { content: [{ index: 0, type: 'text', text: { value: 'world' } }] } },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: { content: [{ index: 1, type: 'image_file', image_file: { file_id: 'file_123' } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: { content: [{ index: 2, type: 'text', text: { value: 'goodbye', annotations: [] } }] },
        },
      },
      { event: 'thread.message.completed', data: finalMessage },
      finalRun,
    ]);
    const created = jest.fn();
    const textCreated = jest.fn();
    const textDelta = jest.fn();
    const textDone = jest.fn();
    const imageDone = jest.fn();
    const messageDone = jest.fn();

    runner.on('messageCreated', created);
    runner.on('textCreated', textCreated);
    runner.on('textDelta', textDelta);
    runner.on('textDone', textDone);
    runner.on('imageFileDone', imageDone);
    runner.on('messageDone', messageDone);

    await runner.done();

    expect(created).toHaveBeenCalledTimes(1);
    expect(textCreated).toHaveBeenCalledTimes(2);
    expect(textDelta).toHaveBeenCalledTimes(3);
    expect(textDone).toHaveBeenCalledTimes(2);
    expect(imageDone).toHaveBeenCalledTimes(1);
    expect(messageDone).toHaveBeenCalledWith(finalMessage);
    expect(runner.currentEvent()).toEqual(finalRun);
    expect(runner.currentRun()).toEqual(finalRun.data);
    expect(runner.currentMessageSnapshot()).toBeUndefined();
    expect(runner.currentRunStepSnapshot()).toBeUndefined();
    await expect(runner.finalRun()).resolves.toEqual(finalRun.data);
    await expect(runner.finalRunSteps()).resolves.toEqual([]);
    await expect(runner.finalMessages()).resolves.toEqual([
      expect.objectContaining({
        id: 'msg_123',
        content: [
          expect.objectContaining({ text: { value: 'hello world', annotations: [] } }),
          expect.objectContaining({ image_file: { file_id: 'file_123' } }),
          expect.objectContaining({ text: { value: 'goodbye', annotations: [] } }),
        ],
      }),
    ]);
  });

  test('emits the final text content when an incomplete message stops streaming', async () => {
    const message = { id: 'msg_123', role: 'assistant', content: [] };
    const runner = assistantStream([
      { event: 'thread.message.created', data: message },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: { content: [{ index: 0, type: 'text', text: { value: 'partial', annotations: [] } }] },
        },
      },
      {
        event: 'thread.message.incomplete',
        data: { ...message, content: [{ type: 'text', text: { value: 'partial', annotations: [] } }] },
      },
      completedRun(),
    ]);
    const textDone = jest.fn();
    runner.on('textDone', textDone);

    await runner.done();

    expect(textDone).toHaveBeenCalledWith({ value: 'partial', annotations: [] }, expect.any(Object));
  });

  test.each([
    'thread.run.requires_action',
    'thread.run.cancelled',
    'thread.run.failed',
    'thread.run.completed',
    'thread.run.expired',
    'thread.run.incomplete',
  ])('recognizes %s as a terminal run state', async (event) => {
    const run = { id: 'run_123', status: event.split('.').pop() };
    const runner = assistantStream([{ event, data: run }]);

    await expect(runner.finalRun()).resolves.toEqual(run);
  });
});

describe('AssistantStream run-step lifecycle', () => {
  test('accumulates tool calls and emits created, delta, and completion events', async () => {
    const initialStep = {
      id: 'step_123',
      status: 'in_progress',
      step_details: { type: 'tool_calls', tool_calls: [] },
    };
    const finalStep = {
      ...initialStep,
      status: 'completed',
      step_details: {
        type: 'tool_calls',
        tool_calls: [
          { index: 0, type: 'function', id: 'call_0', function: { name: 'first', arguments: '{"x":1}' } },
          { index: 1, type: 'function', id: 'call_1', function: { name: 'second', arguments: '{}' } },
        ],
      },
    };
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: initialStep },
      { event: 'thread.run.step.in_progress', data: initialStep },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_123',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                { index: 0, type: 'function', id: 'call_0', function: { name: 'first', arguments: '{' } },
              ],
            },
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_123',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 0, function: { arguments: '"x":1}' } }],
            },
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_123',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                { index: 1, type: 'function', id: 'call_1', function: { name: 'second', arguments: '{}' } },
              ],
            },
          },
        },
      },
      { event: 'thread.run.step.completed', data: finalStep },
      completedRun(),
    ]);
    const stepCreated = jest.fn();
    const stepDelta = jest.fn();
    const stepDone = jest.fn();
    const toolCreated = jest.fn();
    const toolDelta = jest.fn();
    const toolDone = jest.fn();

    runner.on('runStepCreated', stepCreated);
    runner.on('runStepDelta', stepDelta);
    runner.on('runStepDone', stepDone);
    runner.on('toolCallCreated', toolCreated);
    runner.on('toolCallDelta', toolDelta);
    runner.on('toolCallDone', toolDone);

    await runner.done();

    expect(stepCreated).toHaveBeenCalledTimes(1);
    expect(stepDelta).toHaveBeenCalledTimes(3);
    expect(stepDone).toHaveBeenCalledTimes(1);
    expect(toolCreated).toHaveBeenCalledTimes(2);
    expect(toolDelta).toHaveBeenCalledTimes(1);
    expect(toolDone).toHaveBeenCalledTimes(2);
    await expect(runner.finalRunSteps()).resolves.toEqual([finalStep]);
  });

  test.each(['thread.run.step.failed', 'thread.run.step.cancelled', 'thread.run.step.expired'])(
    'finalizes %s run-step snapshots',
    async (event) => {
      const step = { id: 'step_123', step_details: { type: 'message_creation', message_creation: {} } };
      const runner = assistantStream([{ event, data: step }, completedRun()]);
      const stepDone = jest.fn();
      runner.on('runStepDone', stepDone);

      await runner.done();

      expect(stepDone).toHaveBeenCalledTimes(1);
      await expect(runner.finalRunSteps()).resolves.toEqual([step]);
    },
  );

  test('rejects run-step deltas received before a snapshot exists', async () => {
    const runner = assistantStream([
      { event: 'thread.run.step.delta', data: { id: 'missing', delta: {} } },
      completedRun(),
    ]);

    await expect(runner.done()).rejects.toThrow('Received a RunStepDelta before creation of a snapshot');
  });

  test('finishes an active tool call when the run ends before its step does', async () => {
    const runner = assistantStream([
      {
        event: 'thread.run.step.created',
        data: { id: 'step_123', step_details: { type: 'tool_calls', tool_calls: [] } },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_123',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 0, type: 'function', id: 'call_0', function: { arguments: '{}' } }],
            },
          },
        },
      },
      completedRun(),
    ]);
    const toolDone = jest.fn();
    runner.on('toolCallDone', toolDone);

    await runner.done();

    expect(toolDone).toHaveBeenCalledTimes(1);
  });
});

describe('AssistantStream factories and async iteration', () => {
  test('creates a run stream with helper headers and a controlled abort signal', async () => {
    const runs = { create: jest.fn().mockResolvedValue(iterableEvents([completedRun()])) };
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      runs as any,
      { assistant_id: 'assistant_123' },
      { headers: { 'x-custom': 'value' } },
    );

    await expect(runner.finalRun()).resolves.toMatchObject({ id: 'run_123' });
    expect(runs.create).toHaveBeenCalledWith(
      'thread_123',
      { assistant_id: 'assistant_123', stream: true },
      expect.objectContaining({
        headers: { 'x-custom': 'value', 'X-Stainless-Helper-Method': 'stream' },
        signal: runner.controller.signal,
      }),
    );
  });

  test('creates a thread-and-run stream with helper headers', async () => {
    const threads = { createAndRun: jest.fn().mockResolvedValue(iterableEvents([completedRun()])) };
    const runner = AssistantStream.createThreadAssistantStream(
      { assistant_id: 'assistant_123' },
      threads as any,
      { headers: { 'x-custom': 'value' } },
    );

    await runner.done();

    expect(threads.createAndRun).toHaveBeenCalledWith(
      { assistant_id: 'assistant_123', stream: true },
      expect.objectContaining({
        headers: { 'x-custom': 'value', 'X-Stainless-Helper-Method': 'stream' },
        signal: runner.controller.signal,
      }),
    );
  });

  test('creates a tool-output stream with helper headers', async () => {
    const runs = { submitToolOutputs: jest.fn().mockResolvedValue(iterableEvents([completedRun()])) };
    const runner = AssistantStream.createToolAssistantStream(
      'run_123',
      runs as any,
      { thread_id: 'thread_123', tool_outputs: [] },
      { headers: { 'x-custom': 'value' } },
    );

    await runner.done();

    expect(runs.submitToolOutputs).toHaveBeenCalledWith(
      'run_123',
      { thread_id: 'thread_123', tool_outputs: [], stream: true },
      expect.objectContaining({
        headers: { 'x-custom': 'value', 'X-Stainless-Helper-Method': 'stream' },
        signal: runner.controller.signal,
      }),
    );
  });

  test('clones queued events while asynchronously iterating the stream', async () => {
    const event = completedRun();
    const runner = assistantStream([event]);
    const iterator = runner[Symbol.asyncIterator]();

    await runner.done();

    const result = await iterator.next();
    expect(result).toEqual({ value: event, done: false });
    expect(result.value).not.toBe(event);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('resolves pending event reads and closes them when the stream ends', async () => {
    const event = completedRun();
    const runner = assistantStream([event]);
    const iterator = runner[Symbol.asyncIterator]();
    const pending = iterator.next();

    await expect(pending).resolves.toEqual({ value: event, done: false });
    await runner.done();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('rejects pending event reads when the stream errors or aborts', async () => {
    const failed = new AssistantStream();
    const failedIterator = failed[Symbol.asyncIterator]();
    const pendingFailure = failedIterator.next();
    const error = new OpenAIError('stream failed');
    failed._emit('error', error);

    await expect(pendingFailure).rejects.toBe(error);

    const aborted = new AssistantStream();
    const abortedIterator = aborted[Symbol.asyncIterator]();
    const pendingAbort = abortedIterator.next();
    const abortError = new APIUserAbortError();
    aborted._emit('abort', abortError);

    await expect(pendingAbort).rejects.toBe(abortError);
  });

  test('closes pending event reads when an otherwise idle stream ends', async () => {
    const runner = new AssistantStream();
    const pending = runner[Symbol.asyncIterator]().next();

    runner._emit('end');

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  test('aborts the underlying controller when iteration finishes early', async () => {
    const runner = assistantStream([completedRun()]);
    const iterator = runner[Symbol.asyncIterator]();

    await expect(iterator.return?.()).resolves.toEqual({ value: undefined, done: true });
    expect(runner.controller.signal.aborted).toBe(true);
    await expect(runner.done()).rejects.toThrow(APIUserAbortError);
  });

  test('rejects streams that end without a final run', async () => {
    const runner = assistantStream([{ event: 'thread.created', data: { id: 'thread_123' } }]);

    await expect(runner.done()).rejects.toThrow('Final run has not been received');
    await expect(runner.finalRun()).rejects.toThrow('Final run has not been received');
  });

  test('rejects final-run lookup when a manually closed stream never received one', async () => {
    const runner = new AssistantStream();
    runner._emit('end');

    await expect(runner.finalRun()).rejects.toThrow('Final run was not received.');
  });

  test('rejects message deltas received before the corresponding message exists', async () => {
    const runner = assistantStream([
      { event: 'thread.message.delta', data: { id: 'missing', delta: { content: [] } } },
      completedRun(),
    ]);

    await expect(runner.done()).rejects.toThrow('Received a delta with no existing snapshot');
  });

  test.each(['thread.message.in_progress', 'thread.message.completed', 'thread.message.incomplete'])(
    'rejects %s events received before the corresponding message exists',
    async (event) => {
      const runner = assistantStream([{ event, data: { id: 'missing', content: [] } }, completedRun()]);

      await expect(runner.done()).rejects.toThrow('Received thread message event with no existing snapshot');
    },
  );

  test.each(['run', 'thread', 'tool'] as const)(
    'reports aborted %s streams after their source has finished',
    async (kind) => {
      const controller = new AbortController();
      controller.abort();
      const stream = iterableEvents([completedRun()], controller);
      let runner: AssistantStream;

      switch (kind) {
        case 'run':
          runner = AssistantStream.createAssistantStream(
            'thread_123',
            { create: jest.fn().mockResolvedValue(stream) } as any,
            { assistant_id: 'assistant_123' },
          );
          break;
        case 'thread':
          runner = AssistantStream.createThreadAssistantStream({ assistant_id: 'assistant_123' }, {
            createAndRun: jest.fn().mockResolvedValue(stream),
          } as any);
          break;
        case 'tool':
          runner = AssistantStream.createToolAssistantStream(
            'run_123',
            { submitToolOutputs: jest.fn().mockResolvedValue(stream) } as any,
            { thread_id: 'thread_123', tool_outputs: [] },
            undefined,
          );
          break;
      }

      await expect(runner.done()).rejects.toThrow(APIUserAbortError);
      expect(runner.aborted).toBe(true);
    },
  );

  test('ignores forward-compatible assistant events it does not recognize', async () => {
    const runner = assistantStream([{ event: 'thread.future_event', data: {} }, completedRun()]);

    await expect(runner.finalRun()).resolves.toMatchObject({ id: 'run_123' });
  });

  test('rejects unexpected streamed error events', async () => {
    const runner = assistantStream([{ event: 'error', data: { message: 'unexpected' } }, completedRun()]);

    await expect(runner.done()).rejects.toThrow('Encountered an error event in event processing');
  });
});
