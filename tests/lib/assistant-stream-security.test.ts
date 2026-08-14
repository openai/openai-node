import { vi } from 'vitest';
import { OpenAIError } from 'openai/core/error';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { hasOwn } from 'openai/internal/utils';
import { AssistantStream } from 'openai/lib/AssistantStream';
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants';

type Event = Record<string, any>;

function readableEvents(events: Event[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(
    events.map((event) => {
      const line = `${JSON.stringify(event)}\n`;
      return encoder.encode(line);
    }),
  );
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

function unencodedAssistantStream(events: Event[]): AssistantStream {
  return AssistantStream.createAssistantStream(
    'thread_123',
    { create: vi.fn().mockResolvedValue(iterableEvents(events)) } as any,
    { assistant_id: 'assistant_123' },
  );
}

function completedRun(id = 'run_123') {
  return { event: 'thread.run.completed', data: { id, status: 'completed' } };
}

describe('AssistantStream delta index security', () => {
  test.each([
    4_294_967_294,
    1_000_000,
    1025,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects the unsafe nested array index %s before mutating the accumulator', (index) => {
    const entries = [{ index: 0, text: 'first' }];
    const accumulator = { status: 'original', entries };
    let failure: unknown;
    let lengthAfterDelta: number;

    try {
      try {
        AssistantStream.accumulateDelta(accumulator, {
          status: ' updated',
          entries: [
            { index: 0, text: ' updated' },
            { index, text: 'ignored' },
          ],
        });
      } catch (error) {
        failure = error;
      }

      lengthAfterDelta = entries.length;
    } finally {
      entries.length = 1;
      Reflect.deleteProperty(entries, String(index));
    }

    expect(lengthAfterDelta).toBe(1);
    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as Error).message).toContain('invalid array index');
    expect(accumulator).toEqual({ status: 'original', entries: [{ index: 0, text: 'first' }] });
  });

  test('charges sparse growth against one fixed budget for the entire delta batch', () => {
    const entries: Record<string, unknown>[] = [];
    const accumulator = { status: 'original', entries };

    expect(() =>
      AssistantStream.accumulateDelta(accumulator, {
        status: ' updated',
        entries: [
          { index: 1023, text: 'last individually allowed' },
          { index: 2047, text: 'batch amplification attempt' },
        ],
      }),
    ).toThrow('invalid array index');

    expect(accumulator).toEqual({ status: 'original', entries: [] });
  });

  test('preserves bounded out-of-order nested indices and fills their missing slots', () => {
    const entries = [{ index: 0, text: 'first' }];

    AssistantStream.accumulateDelta(
      { entries },
      {
        entries: [
          { index: 2, text: 'third' },
          { index: 1, text: 'second' },
          { index: 2, text: ' updated' },
        ],
      },
    );

    expect(entries).toEqual([
      { index: 0, text: 'first' },
      { index: 1, text: 'second' },
      { index: 2, text: 'third updated' },
    ]);
  });

  test('bounds nested sparse growth without limiting dense arrays', () => {
    const sparseEntries: Record<string, unknown>[] = [];

    AssistantStream.accumulateDelta(
      { entries: sparseEntries },
      { entries: [{ index: 1023, text: 'last allowed' }] },
    );

    expect(sparseEntries).toHaveLength(1024);
    expect(sparseEntries[1023]?.['text']).toBe('last allowed');

    const rejectedEntries: Record<string, unknown>[] = [];
    expect(() =>
      AssistantStream.accumulateDelta(
        { entries: rejectedEntries },
        { entries: [{ index: 1024, text: 'first rejected' }] },
      ),
    ).toThrow('invalid array index');
    expect(rejectedEntries).toHaveLength(0);

    const denseEntries = Array.from({ length: 1024 }, (_, index) => ({ index, text: 'existing' }));
    AssistantStream.accumulateDelta(
      { entries: denseEntries },
      { entries: [{ index: 1024, text: 'next contiguous entry' }] },
    );

    expect(denseEntries).toHaveLength(1025);
    expect(denseEntries[1024]?.text).toBe('next contiguous entry');
  });

  test('absolutely bounds externally mutable arrays after same-length deletions', () => {
    const entries = Array.from({ length: 1024 }, (_, index) => ({ index, text: 'entry' }));

    AssistantStream.accumulateDelta({ entries }, { entries: [{ index: 1023, text: ' updated' }] });
    for (let index = 0; index < entries.length; index += 1) {
      Reflect.deleteProperty(entries, index);
    }
    entries.length = 65_536;

    expect(() =>
      AssistantStream.accumulateDelta(
        { entries },
        { entries: [{ index: 65_536, text: 'absolute-bound attempt' }] },
      ),
    ).toThrow('invalid array index');
    expect(entries).toHaveLength(65_536);
    expect(hasOwn(entries, 65_536)).toBe(false);
  });

  test('rescans externally mutable sparse arrays after same-length hole fills', () => {
    const entries: Record<string, unknown>[] = [];

    AssistantStream.accumulateDelta(
      { entries },
      { entries: [{ index: 1023, text: 'initial sparse entry' }] },
    );
    for (let index = 0; index < 1023; index += 1) {
      entries[index] = { index, text: 'externally filled' };
    }

    AssistantStream.accumulateDelta(
      { entries },
      { entries: [{ index: 2047, text: 'valid bounded sparse entry' }] },
    );
    expect(entries).toHaveLength(2048);
    expect(entries[2047]?.['text']).toBe('valid bounded sparse entry');
  });

  test('caches dense multi-event accounting for unexposed stream-owned arrays', async () => {
    let ownKeysCalls = 0;
    const toolCalls = new Proxy<Record<string, unknown>[]>([], {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    const events: Event[] = [
      {
        event: 'thread.run.step.created',
        data: {
          id: 'step_performance',
          status: 'in_progress',
          step_details: { type: 'tool_calls', tool_calls: toolCalls },
        },
      },
    ];

    for (let index = 0; index < 2048; index += 1) {
      events.push({
        event: 'thread.run.step.delta',
        data: {
          id: 'step_performance',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                {
                  index,
                  type: 'function',
                  id: `call_${index}`,
                  function: { arguments: '' },
                },
              ],
            },
          },
        },
      });
    }
    events.push(completedRun());

    const runner = unencodedAssistantStream(events);
    runner.on('runStepDelta', vi.fn());
    await runner.done();

    expect(toolCalls).toHaveLength(2048);
    expect(ownKeysCalls).toBe(2);
  });

  test.each(['missing', 'null', 'undefined'])(
    'rejects a later invalid index before creating a %s nested array',
    (initialState) => {
      const details: Record<string, unknown> = {};
      if (initialState !== 'missing') {
        details['children'] = initialState === 'null' ? null : undefined;
      }

      const accumulator = { status: 'original', entries: [{ index: 0, details }] };
      const original = structuredClone(accumulator);

      expect(() =>
        AssistantStream.accumulateDelta(accumulator, {
          status: ' updated',
          entries: [
            { index: 0, details: { children: [] } },
            { index: 0, details: { children: [{ index: 1_000_000, text: 'ignored' }] } },
          ],
        }),
      ).toThrow('invalid array index');

      expect(accumulator).toEqual(original);
    },
  );

  test.each([null, undefined])(
    'rejects a later invalid index before replacing a %s indexed array slot',
    (initialEntry) => {
      const accumulator = { status: 'original', entries: [initialEntry] };
      const original = structuredClone(accumulator);

      expect(() =>
        AssistantStream.accumulateDelta(accumulator, {
          status: ' updated',
          entries: [
            { index: 0, children: [] },
            { index: 0, children: [{ index: 1_000_000, text: 'ignored' }] },
          ],
        }),
      ).toThrow('invalid array index');

      expect(accumulator).toEqual(original);
    },
  );

  test('validates indexed object deltas when the accumulated array starts empty', () => {
    const entries: Record<string, unknown>[] = [];

    expect(() =>
      AssistantStream.accumulateDelta({ entries }, { entries: [{ index: 1_000_000, text: 'ignored' }] }),
    ).toThrow('invalid array index');
    expect(entries).toEqual([]);

    AssistantStream.accumulateDelta(
      { entries },
      {
        entries: [
          { index: 2, text: 'third' },
          { index: 0, text: 'first' },
          { index: 1, text: 'second' },
        ],
      },
    );

    expect(entries.map((entry) => entry['text'])).toEqual(['first', 'second', 'third']);
  });

  test('creates an own nested array slot without invoking inherited numeric accessors', () => {
    const inheritedGetter = vi.fn(() => ({ index: 1, text: 'inherited' }));
    const inheritedSetter = vi.fn();
    const entries = [{ index: 0, text: 'first' }];
    Object.setPrototypeOf(
      entries,
      Object.create(Array.prototype, {
        1: { configurable: true, get: inheritedGetter, set: inheritedSetter },
      }),
    );

    AssistantStream.accumulateDelta({ entries }, { entries: [{ index: 1, text: 'second' }] });

    expect(inheritedGetter).not.toHaveBeenCalled();
    expect(inheritedSetter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(entries, 1)).toBeDefined();
    expect(entries[1]).toEqual({ index: 1, text: 'second' });
  });
});

describe('AssistantStream message index security', () => {
  test.each([
    4_294_967_294,
    1_000_000,
    1025,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects the unsafe streamed content index %s before mutating the message snapshot', async (index) => {
    const content = [{ type: 'text', text: { value: 'original', annotations: [] } }];
    const message = { id: 'msg_123', role: 'assistant', content };
    const runner = unencodedAssistantStream([
      { event: 'thread.message.created', data: message },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: {
            content: [
              { index: 0, type: 'text', text: { value: ' updated' } },
              { index, type: 'text', text: { value: 'ignored', annotations: [] } },
            ],
          },
        },
      },
      completedRun(),
    ]);
    let failure: unknown;
    let lengthAfterDelta: number;

    try {
      try {
        await runner.done();
      } catch (error) {
        failure = error;
      }

      lengthAfterDelta = content.length;
    } finally {
      content.length = 1;
      Reflect.deleteProperty(content, String(index));
    }

    expect(lengthAfterDelta).toBe(1);
    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as Error).message).toContain('invalid content index');
    expect(content[0]?.text.value).toBe('original');
  });

  test('rejects a sparse-array bomb received through the public readable-stream transport', async () => {
    const runner = assistantStream([
      { event: 'thread.message.created', data: { id: 'msg_123', role: 'assistant', content: [] } },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: {
            content: [{ index: 4_294_967_294, type: 'text', text: { value: 'ignored', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);
    let failure: unknown;
    let lengthAfterDelta: number | undefined;

    try {
      try {
        await runner.done();
      } catch (error) {
        failure = error;
      }

      lengthAfterDelta = runner.currentMessageSnapshot()?.content.length;
    } finally {
      const snapshot = runner.currentMessageSnapshot();
      if (snapshot) {
        snapshot.content.length = 0;
      }
    }

    expect(lengthAfterDelta).toBe(0);
    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as Error).message).toContain('invalid content index');
  });

  test('preserves bounded out-of-order streamed content and fills missing slots', async () => {
    const message = {
      id: 'msg_123',
      role: 'assistant',
      content: [{ type: 'text', text: { value: 'first', annotations: [] } }],
    };
    const runner = unencodedAssistantStream([
      { event: 'thread.message.created', data: message },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: {
            content: [
              { index: 2, type: 'text', text: { value: 'third', annotations: [] } },
              { index: 1, type: 'text', text: { value: 'second', annotations: [] } },
              { index: 2, type: 'text', text: { value: ' updated' } },
            ],
          },
        },
      },
      completedRun(),
    ]);

    await runner.done();

    expect(message.content.map((entry) => entry.text.value)).toEqual(['first', 'second', 'third updated']);
  });

  test('bounds streamed content growth without limiting continued sequential creation', async () => {
    const rejectedMessage = { id: 'msg_rejected', role: 'assistant', content: [] };
    const rejected = unencodedAssistantStream([
      { event: 'thread.message.created', data: rejectedMessage },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_rejected',
          delta: {
            content: [{ index: 1024, type: 'text', text: { value: 'first rejected', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);

    await expect(rejected.done()).rejects.toThrow('invalid content index');
    expect(rejectedMessage.content).toHaveLength(0);

    const content: Record<string, any>[] = [];
    const accepted = unencodedAssistantStream([
      { event: 'thread.message.created', data: { id: 'msg_accepted', role: 'assistant', content } },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_accepted',
          delta: {
            content: [{ index: 1023, type: 'text', text: { value: 'last allowed', annotations: [] } }],
          },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_accepted',
          delta: {
            content: [{ index: 1024, type: 'text', text: { value: 'next contiguous', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);

    await accepted.done();

    expect(content).toHaveLength(1025);
    expect(content[1023]?.['text'].value).toBe('last allowed');
    expect(content[1024]?.['text'].value).toBe('next contiguous');
  });

  test('creates an own streamed content slot without invoking inherited numeric accessors', async () => {
    const inheritedGetter = vi.fn(() => ({ type: 'text', text: { value: 'inherited', annotations: [] } }));
    const inheritedSetter = vi.fn();
    const content = [{ type: 'text', text: { value: 'first', annotations: [] } }];
    Object.setPrototypeOf(
      content,
      Object.create(Array.prototype, {
        1: { configurable: true, get: inheritedGetter, set: inheritedSetter },
      }),
    );
    const message = { id: 'msg_123', role: 'assistant', content };
    const runner = unencodedAssistantStream([
      { event: 'thread.message.created', data: message },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: { content: [{ index: 1, type: 'text', text: { value: 'second', annotations: [] } }] },
        },
      },
      completedRun(),
    ]);

    await runner.done();

    expect(inheritedGetter).not.toHaveBeenCalled();
    expect(inheritedSetter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(content, 1)).toBeDefined();
    expect(content[1]?.text.value).toBe('second');
  });

  test('keeps replacement content arrays in constant-time absolute-bound mode after deletion', async () => {
    let ownKeysCalls = 0;
    const replacement = new Proxy(
      Array.from({ length: 1024 }, (_, index) => ({
        type: 'text' as const,
        text: { value: `replacement_${index}`, annotations: [] },
      })),
      {
        ownKeys(target) {
          ownKeysCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    const runner = unencodedAssistantStream([
      {
        event: 'thread.message.created',
        data: {
          id: 'msg_replace_delete',
          role: 'assistant',
          content: [{ type: 'text', text: { value: 'initial', annotations: [] } }],
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_delete',
          delta: { content: [{ index: 0, type: 'text', text: { value: ' updated' } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_delete',
          delta: { content: [{ index: 1023, type: 'text', text: { value: ' cached' } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_delete',
          delta: {
            content: [{ index: 2047, type: 'text', text: { value: 'bounded', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);
    let stage = 0;
    runner.on('textDelta', () => {
      const snapshot = runner.currentMessageSnapshot();
      if (stage === 0 && snapshot) {
        Object.defineProperty(snapshot, 'content', {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: true,
        });
      } else if (stage === 1) {
        for (let index = 0; index < replacement.length; index += 1) {
          Reflect.deleteProperty(replacement, index);
        }
      }
      stage += 1;
    });

    await runner.done();

    expect(replacement).toHaveLength(2048);
    expect(replacement[2047]?.text.value).toBe('bounded');
    expect(ownKeysCalls).toBe(0);
  });

  test('accepts valid growth after a listener fills holes in a replacement content array', async () => {
    const replacement = Array.from({ length: 1024 }, (_, index) => ({
      type: 'text' as const,
      text: { value: `replacement_${index}`, annotations: [] },
    }));
    for (let index = 0; index < 1023; index += 1) {
      Reflect.deleteProperty(replacement, index);
    }
    const runner = unencodedAssistantStream([
      {
        event: 'thread.message.created',
        data: {
          id: 'msg_replace_fill',
          role: 'assistant',
          content: [{ type: 'text', text: { value: 'initial', annotations: [] } }],
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_fill',
          delta: { content: [{ index: 0, type: 'text', text: { value: ' updated' } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_fill',
          delta: { content: [{ index: 1023, type: 'text', text: { value: ' cached' } }] },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_replace_fill',
          delta: {
            content: [{ index: 2047, type: 'text', text: { value: 'bounded', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);
    let stage = 0;
    runner.on('textDelta', () => {
      const snapshot = runner.currentMessageSnapshot();
      if (stage === 0 && snapshot) {
        Object.defineProperty(snapshot, 'content', {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: true,
        });
      } else if (stage === 1) {
        for (let index = 0; index < 1023; index += 1) {
          replacement[index] = {
            type: 'text',
            text: { value: `filled_${index}`, annotations: [] },
          };
        }
      }
      stage += 1;
    });

    await runner.done();

    expect(replacement).toHaveLength(2048);
    expect(replacement[2047]?.text.value).toBe('bounded');
  });

  test('bounds cumulative streamed content holes across separate public events', async () => {
    const content: Record<string, any>[] = [];
    const runner = assistantStream([
      { event: 'thread.message.created', data: { id: 'msg_123', role: 'assistant', content } },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: {
            content: [{ index: 1023, type: 'text', text: { value: 'first', annotations: [] } }],
          },
        },
      },
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_123',
          delta: {
            content: [{ index: 2047, type: 'text', text: { value: 'amplified', annotations: [] } }],
          },
        },
      },
      completedRun(),
    ]);

    await expect(runner.done()).rejects.toThrow('invalid content index');
    const snapshotContent = runner.currentMessageSnapshot()?.content;
    expect(snapshotContent).toHaveLength(1024);
    expect(snapshotContent?.[1023]).toMatchObject({ text: { value: 'first' } });
    expect(snapshotContent ? hasOwn(snapshotContent, 2047) : undefined).toBe(false);
  });
});

describe('AssistantStream run-step index security', () => {
  test('rejects a tool-call sparse-array bomb received through the public readable-stream transport', async () => {
    const initialStep = {
      id: 'step_123',
      status: 'in_progress',
      step_details: {
        type: 'tool_calls',
        tool_calls: [{ index: 0, type: 'function', id: 'call_0', function: { arguments: 'original' } }],
      },
    };
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: initialStep },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_123',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                { index: 0, function: { arguments: ' updated' } },
                { index: 4_294_967_294, type: 'function', id: 'call_ignored', function: { arguments: '{}' } },
              ],
            },
          },
        },
      },
      completedRun(),
    ]);
    let failure: unknown;
    let lengthAfterDelta: number | undefined;
    let argumentsAfterDelta: string | undefined;

    try {
      try {
        await runner.done();
      } catch (error) {
        failure = error;
      }

      const details = runner.currentRunStepSnapshot()?.step_details;
      if (details?.type === 'tool_calls') {
        lengthAfterDelta = details.tool_calls.length;
        argumentsAfterDelta = (details.tool_calls[0] as any).function.arguments;
      }
    } finally {
      const details = runner.currentRunStepSnapshot()?.step_details;
      if (details?.type === 'tool_calls') {
        details.tool_calls.length = 1;
      }
    }

    expect(lengthAfterDelta).toBe(1);
    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as Error).message).toContain('invalid array index');
    expect(argumentsAfterDelta).toBe('original');
  });

  test('bounds cumulative tool-call holes across separate public events', async () => {
    const initialStep = {
      id: 'step_cumulative',
      status: 'in_progress',
      step_details: {
        type: 'tool_calls',
        tool_calls: [{ index: 0, type: 'function', id: 'call_0', function: { arguments: '' } }],
      },
    };
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: initialStep },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_cumulative',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 1023, type: 'function', id: 'call_1023', function: { arguments: '' } }],
            },
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_cumulative',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 2047, type: 'function', id: 'call_2047', function: { arguments: '' } }],
            },
          },
        },
      },
      completedRun(),
    ]);

    await expect(runner.done()).rejects.toThrow('invalid array index');
    const details = runner.currentRunStepSnapshot()?.step_details;
    expect(details?.type).toBe('tool_calls');
    if (details?.type === 'tool_calls') {
      expect(details.tool_calls).toHaveLength(1024);
      expect(details.tool_calls[1023]?.id).toBe('call_1023');
      expect(hasOwn(details.tool_calls, 2047)).toBe(false);
    }
  });

  test('accepts valid growth after a listener fills holes in replacement tool calls', async () => {
    const replacement = Array.from({ length: 1024 }, (_, index) => ({
      index,
      type: 'function' as const,
      id: `replacement_${index}`,
      function: { arguments: '' },
    }));
    for (let index = 0; index < 1023; index += 1) {
      Reflect.deleteProperty(replacement, index);
    }
    const runner = unencodedAssistantStream([
      {
        event: 'thread.run.step.created',
        data: {
          id: 'step_replace_fill',
          status: 'in_progress',
          step_details: {
            type: 'tool_calls',
            tool_calls: [{ index: 0, type: 'function', id: 'initial', function: { arguments: '' } }],
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_replace_fill',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 0, function: { arguments: ' updated' } }],
            },
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_replace_fill',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [{ index: 1023, function: { arguments: ' cached' } }],
            },
          },
        },
      },
      {
        event: 'thread.run.step.delta',
        data: {
          id: 'step_replace_fill',
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                {
                  index: 2047,
                  type: 'function',
                  id: 'bounded',
                  function: { arguments: '' },
                },
              ],
            },
          },
        },
      },
      completedRun(),
    ]);
    let stage = 0;
    runner.on('runStepDelta', (_delta, snapshot) => {
      if (snapshot.step_details.type !== 'tool_calls') {
        return;
      }
      if (stage === 0) {
        Object.defineProperty(snapshot.step_details, 'tool_calls', {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: true,
        });
      } else if (stage === 1) {
        for (let index = 0; index < 1023; index += 1) {
          replacement[index] = {
            index,
            type: 'function',
            id: `filled_${index}`,
            function: { arguments: '' },
          };
        }
      }
      stage += 1;
    });

    await runner.done();

    expect(replacement).toHaveLength(2048);
    expect(replacement[2047]?.id).toBe('bounded');
  });
});
