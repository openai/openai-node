import { vi } from 'vitest';
import { APIError, APIUserAbortError, OpenAIError } from 'openai/core/error';
import { AssistantStream } from 'openai/lib/AssistantStream';
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants';
import { Stream } from 'openai/streaming';
import { assistantStream, completedRun } from './assistant-stream-test-utils';

type Event = Record<string, any>;

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

  test('preserves accumulator identity and ordinary object prototypes', () => {
    const nested = { text: 'hello' };
    const accumulator = { nested };

    const result = AssistantStream.accumulateDelta(accumulator, {
      nested: { text: ' world' },
      status: 'ready',
    });

    expect(result).toBe(accumulator);
    expect(result['nested']).toBe(nested);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result['nested'])).toBe(Object.prototype);
    expect(result).toEqual({ nested: { text: 'hello world' }, status: 'ready' });
    expect(Object.getOwnPropertyDescriptor(result, 'status')).toEqual({
      configurable: true,
      enumerable: true,
      value: 'ready',
      writable: true,
    });
  });

  test('creates own fields without changing ordinary inherited values', () => {
    const inherited = { label: 'inherited' };
    const accumulator: Record<string, unknown> = Object.create(inherited);

    const result = AssistantStream.accumulateDelta(accumulator, { label: 'updated', status: 'ready' });

    expect(result).toBe(accumulator);
    expect(Object.getPrototypeOf(result)).toBe(inherited);
    expect(inherited.label).toBe('inherited');
    expect(result['label']).toBe('updated');
    expect(result['status']).toBe('ready');
    expect(Object.getOwnPropertyDescriptor(result, 'label')).toMatchObject({ value: 'updated' });
  });

  test('preserves null-prototype accumulators during ordinary nested updates', () => {
    const nested: Record<string, string> = Object.create(null);
    nested['text'] = 'hello';

    const accumulator: Record<string, unknown> = Object.create(null);
    accumulator['details'] = nested;

    const result = AssistantStream.accumulateDelta(accumulator, {
      details: { text: ' world' },
      status: 'ready',
    });

    expect(result).toBe(accumulator);
    expect(result['details']).toBe(nested);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(result['details'])).toBeNull();
    expect(result['details']['text']).toBe('hello world');
    expect(result['status']).toBe('ready');
  });

  test('preserves newly inserted nested objects and arrays', () => {
    const metadata = { profile: { name: 'Ada' } };
    const entries = [{ index: 0, details: { text: 'hello' } }];
    const accumulator = {};

    const result = AssistantStream.accumulateDelta(accumulator, { metadata, entries });

    expect(result).toBe(accumulator);
    expect(result['metadata']).toBe(metadata);
    expect(result['entries']).toBe(entries);
    expect(result).toEqual({
      metadata: { profile: { name: 'Ada' } },
      entries: [{ index: 0, details: { text: 'hello' } }],
    });
  });

  test('validates newly inserted nested arrays before mutating the accumulator', () => {
    const failure = new Error('Nested value is unavailable');
    const unreadable = {
      get value(): never {
        throw failure;
      },
    };
    const accumulator = { text: 'hello' };

    expect(() =>
      AssistantStream.accumulateDelta(accumulator, {
        text: ' world',
        entries: [{ index: 0, details: { nested: unreadable } }],
      }),
    ).toThrow(failure);

    expect(accumulator).toEqual({ text: 'hello' });
    expect(Object.getOwnPropertyDescriptor(accumulator, 'entries')).toBeUndefined();
  });

  test.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the reserved %s property before mutating any accumulator path',
    (key) => {
      const deltas = [
        { text: ' updated', [key]: 'blocked' },
        { text: ' updated', metadata: { details: { [key]: 'blocked' } } },
        {
          text: ' updated',
          entries: [
            { index: 0, text: ' updated' },
            { index: 1, details: { [key]: 'blocked' } },
          ],
        },
      ];

      for (const delta of deltas) {
        const accumulator = { text: 'original', entries: [{ index: 0, text: 'first' }] };

        expect(() => AssistantStream.accumulateDelta(accumulator, delta)).toThrow(
          `Assistant stream delta contains an unsafe property: ${key}`,
        );
        expect(accumulator).toEqual({ text: 'original', entries: [{ index: 0, text: 'first' }] });
      }
    },
  );

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

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => AssistantStream.accumulateDelta({ entries: [{}] }, { entries: [{}] })).toThrow(
        'Expected array delta entry to have an `index` property',
      );
      expect(consoleError).not.toHaveBeenCalled();
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
  test('buffers repeated message deltas without charging their shared growing snapshot repeatedly', async () => {
    const message = {
      id: 'msg_shared_snapshot',
      role: 'assistant',
      content: [{ type: 'text', text: { value: 'x'.repeat(16 * 1024), annotations: [] } }],
    };
    const events: Event[] = [{ event: 'thread.message.created', data: message }];
    for (let index = 0; index < 640; index += 1) {
      events.push({
        event: 'thread.message.delta',
        data: {
          id: message.id,
          delta: { content: [{ index: 0, type: 'text', text: { value: 'a' } }] },
        },
      });
    }
    events.push({ event: 'thread.message.completed', data: message }, completedRun());
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      { create: vi.fn().mockResolvedValue(iterableEvents(events)) } as any,
      { assistant_id: 'assistant_123' },
    );
    const iterator = runner.events('messageDelta');

    await expect(runner.done()).resolves.toBeUndefined();
    const first = await iterator.next();
    expect(first.value?.[1]).toBe(message);
    expect(message.content[0]?.text.value).toHaveLength(16 * 1024 + 640);
    await iterator.return?.();
  });

  test('preserves ordinary raw-event and message snapshot identities', async () => {
    const message = { id: 'msg_identity', role: 'assistant', content: [] };
    const createdEvent = { event: 'thread.message.created', data: message };
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi
          .fn()
          .mockResolvedValue(
            iterableEvents([
              createdEvent,
              { event: 'thread.message.completed', data: message },
              completedRun(),
            ]),
          ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const rawEvents: AssistantStreamEvent[] = [];
    const createdMessages: unknown[] = [];
    runner.on('event', (event) => rawEvents.push(event));
    runner.on('messageCreated', (snapshot) => createdMessages.push(snapshot));

    await expect(runner.done()).resolves.toBeUndefined();
    const finalMessages = await runner.finalMessages();

    expect(rawEvents[0]).toBe(createdEvent);
    expect(createdMessages[0]).toBe(message);
    expect(finalMessages[0]).toBe(message);
  });

  test('captures accessor-backed event data once before exposing or routing its message', async () => {
    const first = { id: 'msg_first', role: 'assistant', content: [] };
    const second = { id: 'msg_second', role: 'assistant', content: [] };
    const createdEvent: Event = { event: 'thread.message.created' };
    const readData = vi.fn(function readStableData(this: Event) {
      expect(this).toBe(createdEvent);
      return readData.mock.calls.length === 1 ? first : second;
    });
    Object.defineProperty(createdEvent, 'data', { enumerable: true, get: readData });
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi
          .fn()
          .mockResolvedValue(
            iterableEvents([
              createdEvent,
              { event: 'thread.message.completed', data: first },
              { event: 'thread.message.created', data: second },
              { event: 'thread.message.completed', data: second },
              completedRun(),
            ]),
          ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const rawCreations: AssistantStreamEvent[] = [];
    const createdMessages: unknown[] = [];
    runner.on('event', (event) => {
      if (event.event === 'thread.message.created') {
        rawCreations.push(event);
      }
    });
    runner.on('messageCreated', (snapshot) => createdMessages.push(snapshot));

    await expect(runner.done()).resolves.toBeUndefined();

    expect(readData).toHaveBeenCalledTimes(1);
    expect(rawCreations[0]?.data).toBe(first);
    expect(rawCreations[0]).not.toBe(createdEvent);
    expect(createdMessages).toEqual([first, second]);
    expect(createdMessages[0]).toBe(first);
    expect(await runner.finalMessages()).toEqual([first, second]);
  });

  test('preserves captured message routing when a raw listener replaces ordinary frame fields', async () => {
    const message = { id: 'msg_captured', role: 'assistant', content: [] };
    const replacement = { id: 'msg_replacement', role: 'assistant', content: [] };
    const createdEvent = { event: 'thread.message.created', data: message };
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi
          .fn()
          .mockResolvedValue(
            iterableEvents([
              createdEvent,
              { event: 'thread.message.completed', data: message },
              completedRun(),
            ]),
          ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const createdMessages: unknown[] = [];
    runner.on('event', (event) => {
      if (Object.is(event, createdEvent)) {
        (event as Event)['event'] = 'thread.run.completed';
        (event as Event)['data'] = replacement;
      }
    });
    runner.on('messageCreated', (snapshot) => createdMessages.push(snapshot));

    await expect(runner.done()).resolves.toBeUndefined();
    const finalMessages = await runner.finalMessages();

    expect(createdMessages[0]).toBe(message);
    expect(finalMessages[0]).toBe(message);
  });

  test('captures an accessor-backed assistant event discriminator exactly once', async () => {
    const message = { id: 'msg_discriminator', role: 'assistant', content: [] };
    const createdEvent: Event = { data: message };
    const readEvent = vi.fn(function readStableEvent(this: Event) {
      expect(this).toBe(createdEvent);
      return readEvent.mock.calls.length === 1 ? 'thread.message.created' : 'thread.run.completed';
    });
    Object.defineProperty(createdEvent, 'event', { enumerable: true, get: readEvent });
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi
          .fn()
          .mockResolvedValue(
            iterableEvents([
              createdEvent,
              { event: 'thread.message.completed', data: message },
              completedRun(),
            ]),
          ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const createdMessages: unknown[] = [];
    runner.on('messageCreated', (snapshot) => createdMessages.push(snapshot));

    await expect(runner.done()).resolves.toBeUndefined();

    expect(readEvent).toHaveBeenCalledTimes(1);
    expect(createdMessages[0]).toBe(message);
  });

  test('normalizes an inconsistent proxy-backed message frame before exposing it', async () => {
    const message = { id: 'msg_proxy', role: 'assistant', content: [] };
    const decoy = { id: 'msg_decoy', role: 'assistant', content: [] };
    const source = { event: 'thread.message.created', data: decoy };
    let dataReads = 0;
    const createdEvent = new Proxy(source, {
      get(target, key, receiver) {
        if (key === 'data') {
          dataReads += 1;
          return message;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi
          .fn()
          .mockResolvedValue(
            iterableEvents([
              createdEvent,
              { event: 'thread.message.completed', data: message },
              completedRun(),
            ]),
          ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const rawEvents: AssistantStreamEvent[] = [];
    const createdMessages: unknown[] = [];
    runner.on('event', (event) => rawEvents.push(event));
    runner.on('messageCreated', (snapshot) => createdMessages.push(snapshot));

    await expect(runner.done()).resolves.toBeUndefined();

    expect(dataReads).toBe(1);
    expect(rawEvents[0]).not.toBe(createdEvent);
    expect(rawEvents[0]?.data).toBe(message);
    expect(createdMessages[0]).toBe(message);
  });

  test.each(['event', 'messageCreated'] as const)(
    'preserves the canonical active ID when a %s listener mutates its message',
    async (listener) => {
      const message = { id: 'msg_active', role: 'assistant', content: [] };
      const runner = assistantStream([
        { event: 'thread.message.created', data: message },
        { event: 'thread.message.delta', data: { id: 'msg_active', delta: { content: [] } } },
        {
          event: 'thread.message.completed',
          data: { id: 'msg_active', role: 'assistant', content: [] },
        },
        completedRun(),
      ]);

      if (listener === 'event') {
        runner.on('event', (event) => {
          if (event.event === 'thread.message.created') {
            event.data.id = 'msg_mutated_by_listener';
          }
        });
      } else {
        runner.on('messageCreated', (snapshot) => {
          snapshot.id = 'msg_mutated_by_listener';
        });
      }

      await expect(runner.done()).resolves.toBeUndefined();
      await expect(runner.finalMessages()).resolves.toHaveLength(1);
    },
  );

  test.each(['event', 'messageCreated'] as const)(
    'reserves a %s-listener message-ID alias before a later duplicate creation',
    async (listener) => {
      const first = { id: 'msg_canonical', role: 'assistant', content: [] };
      const alias = { id: 'msg_listener_alias', role: 'assistant', content: [] };
      const firstEvent = { event: 'thread.message.created', data: first };
      const runner = AssistantStream.createAssistantStream(
        'thread_123',
        {
          create: vi.fn().mockResolvedValue(
            iterableEvents([
              firstEvent,
              {
                event: 'thread.message.completed',
                data: { id: 'msg_canonical', role: 'assistant', content: [] },
              },
              { event: 'thread.message.created', data: alias },
              { event: 'thread.message.completed', data: alias },
              completedRun(),
            ]),
          ),
        } as any,
        { assistant_id: 'assistant_123' },
      );
      const exposed: AssistantStreamEvent[] = [];
      const created: unknown[] = [];
      runner.on('event', (event) => {
        exposed.push(event);
        if (listener === 'event' && Object.is(event.data, first)) {
          first.id = alias.id;
        }
      });
      runner.on('messageCreated', (message) => {
        created.push(message);
        if (listener === 'messageCreated' && Object.is(message, first)) {
          first.id = alias.id;
        }
      });

      await expect(runner.done()).rejects.toThrow(/already been created/u);
      expect(exposed[0]).toBe(firstEvent);
      expect(created[0]).toBe(first);
      expect(first.id).toBe(alias.id);
    },
  );

  test.each(['messageDelta', 'textDone', 'messageDone'] as const)(
    'reserves the retained message ID changed by a %s listener',
    async (listener) => {
      const first = { id: 'msg_canonical', role: 'assistant', content: [] };
      const alias = { id: 'msg_specialized_alias', role: 'assistant', content: [] };
      const text = { value: 'safe', annotations: [] };
      const mutatedSnapshots: { id: string }[] = [];
      const runner = assistantStream([
        { event: 'thread.message.created', data: first },
        {
          event: 'thread.message.delta',
          data: { id: 'msg_canonical', delta: { content: [{ index: 0, type: 'text', text }] } },
        },
        {
          event: 'thread.message.completed',
          data: { id: 'msg_canonical', role: 'assistant', content: [{ type: 'text', text }] },
        },
        { event: 'thread.message.created', data: alias },
        { event: 'thread.message.completed', data: alias },
        completedRun(),
      ]);

      runner.on('messageDelta', (_delta, snapshot) => {
        if (listener === 'messageDelta') {
          snapshot.id = alias.id;
          mutatedSnapshots.push(snapshot);
        }
      });
      runner.on('textDone', (_text, snapshot) => {
        if (listener === 'textDone') {
          snapshot.id = alias.id;
          mutatedSnapshots.push(snapshot);
        }
      });
      runner.on('messageDone', () => {
        if (listener === 'messageDone') {
          const snapshot = runner.currentMessageSnapshot();
          if (snapshot) {
            snapshot.id = alias.id;
            mutatedSnapshots.push(snapshot);
          }
        }
      });

      await expect(runner.done()).rejects.toThrow(/already been created/u);
      expect(mutatedSnapshots).toHaveLength(1);
      expect(mutatedSnapshots[0]?.id).toBe(alias.id);
    },
  );

  test('normalizes an inconsistent proxy-backed message ID before exposing or retaining it', async () => {
    const readID = vi.fn(() => 'msg_proxy_alias');
    const source = { id: 'msg_proxy_canonical', role: 'assistant', content: [] };
    const first = new Proxy(source, {
      get(target, property, receiver) {
        return property === 'id' ? readID() : Reflect.get(target, property, receiver);
      },
    });
    const alias = { id: 'msg_proxy_alias', role: 'assistant', content: [] };
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      {
        create: vi.fn().mockResolvedValue(
          iterableEvents([
            { event: 'thread.message.created', data: first },
            {
              event: 'thread.message.completed',
              data: { id: 'msg_proxy_canonical', role: 'assistant', content: [] },
            },
            { event: 'thread.message.created', data: alias },
            { event: 'thread.message.completed', data: alias },
            completedRun(),
          ]),
        ),
      } as any,
      { assistant_id: 'assistant_123' },
    );
    const rawIDs: string[] = [];
    const createdIDs: string[] = [];
    runner.on('event', (event) => {
      if (event.event === 'thread.message.created') {
        rawIDs.push(event.data.id);
      }
    });
    runner.on('messageCreated', (message) => createdIDs.push(message.id));

    await expect(runner.done()).resolves.toBeUndefined();
    expect(rawIDs).toEqual(['msg_proxy_canonical', 'msg_proxy_alias']);
    expect(createdIDs).toEqual(['msg_proxy_canonical', 'msg_proxy_alias']);
    expect(readID).toHaveBeenCalledTimes(1);
  });

  test.each(['inherited', 'accessor'] as const)(
    'rejects an %s message ID before exposing the event or invoking a getter',
    async (kind) => {
      const readID = vi.fn(() => 'msg_injected');
      const message: Event =
        kind === 'inherited'
          ? Object.assign(Object.create(Object.defineProperty({}, 'id', { get: readID })) as Event, {
              role: 'assistant',
              content: [],
            })
          : { role: 'assistant', content: [] };
      if (kind === 'accessor') {
        Object.defineProperty(message, 'id', { enumerable: true, get: readID });
      }

      const runner = AssistantStream.createAssistantStream(
        'thread_123',
        {
          create: vi
            .fn()
            .mockResolvedValue(
              iterableEvents([{ event: 'thread.message.created', data: message }, completedRun()]),
            ),
        } as any,
        { assistant_id: 'assistant_123' },
      );
      const exposedEvent = vi.fn();
      runner.on('event', exposedEvent);

      await expect(runner.done()).rejects.toThrow('invalid message ID');

      expect(exposedEvent).not.toHaveBeenCalled();
      expect(readID).not.toHaveBeenCalled();
      expect(runner.currentMessageSnapshot()).toBeUndefined();
    },
  );

  test('rejects a delta for another message before mutating or emitting it', async () => {
    const message = {
      id: 'msg_active',
      role: 'assistant',
      content: [{ type: 'text', text: { value: 'original', annotations: [] } }],
    };
    const createdEvent = { event: 'thread.message.created', data: message };
    const runner = assistantStream([
      createdEvent,
      {
        event: 'thread.message.delta',
        data: {
          id: 'msg_foreign',
          delta: { content: [{ index: 0, type: 'text', text: { value: ' injected' } }] },
        },
      },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const messageDelta = vi.fn();
    const textDelta = vi.fn();

    runner.on('event', rawEvent);
    runner.on('messageDelta', messageDelta);
    runner.on('textDelta', textDelta);

    await expect(runner.done()).rejects.toThrow('does not match the active message');

    expect(rawEvent).toHaveBeenCalledTimes(1);
    expect(rawEvent).toHaveBeenCalledWith(createdEvent);
    expect(messageDelta).not.toHaveBeenCalled();
    expect(textDelta).not.toHaveBeenCalled();
    expect(runner.currentEvent()).toEqual(createdEvent);
    expect(runner.currentMessageSnapshot()).toEqual(message);
  });

  test.each(['thread.message.in_progress', 'thread.message.completed', 'thread.message.incomplete'])(
    'rejects a mismatched %s event before finalizing or emitting the active message',
    async (event) => {
      const message = { id: 'msg_active', role: 'assistant', content: [] };
      const text = { value: 'original', annotations: [] };
      const acceptedDelta = {
        event: 'thread.message.delta',
        data: { id: message.id, delta: { content: [{ index: 0, type: 'text', text }] } },
      };
      const runner = assistantStream([
        { event: 'thread.message.created', data: message },
        acceptedDelta,
        {
          event,
          data: {
            id: 'msg_foreign',
            role: 'assistant',
            content: [{ type: 'text', text: { value: 'injected', annotations: [] } }],
          },
        },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const messageDone = vi.fn();
      const textDone = vi.fn();

      runner.on('event', rawEvent);
      runner.on('messageDone', messageDone);
      runner.on('textDone', textDone);

      await expect(runner.done()).rejects.toThrow('does not match the active message');

      expect(rawEvent).toHaveBeenCalledTimes(2);
      expect(messageDone).not.toHaveBeenCalled();
      expect(textDone).not.toHaveBeenCalled();
      expect(runner.currentEvent()).toEqual(acceptedDelta);
      expect(runner.currentMessageSnapshot()).toEqual({
        ...message,
        content: [{ index: 0, type: 'text', text }],
      });
    },
  );

  test.each(['msg_active', 'msg_second'])(
    'rejects creation of %s before the active message has reached a terminal state',
    async (id) => {
      const message = { id: 'msg_active', role: 'assistant', content: [] };
      const createdEvent = { event: 'thread.message.created', data: message };
      const runner = assistantStream([
        createdEvent,
        { event: 'thread.message.created', data: { id, role: 'assistant', content: [] } },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const messageCreated = vi.fn();

      runner.on('event', rawEvent);
      runner.on('messageCreated', messageCreated);

      await expect(runner.done()).rejects.toThrow('before the active message');

      expect(rawEvent).toHaveBeenCalledTimes(1);
      expect(messageCreated).toHaveBeenCalledTimes(1);
      expect(runner.currentEvent()).toEqual(createdEvent);
      expect(runner.currentMessageSnapshot()).toEqual(message);
    },
  );

  test('rejects reuse of a completed message ID before emitting a new creation', async () => {
    const message = { id: 'msg_reused', role: 'assistant', content: [] };
    const terminalEvent = { event: 'thread.message.completed', data: message };
    const runner = assistantStream([
      { event: 'thread.message.created', data: message },
      terminalEvent,
      { event: 'thread.message.created', data: message },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const messageCreated = vi.fn();
    const messageDone = vi.fn();

    runner.on('event', rawEvent);
    runner.on('messageCreated', messageCreated);
    runner.on('messageDone', messageDone);

    await expect(runner.done()).rejects.toThrow('already been created');

    expect(rawEvent).toHaveBeenCalledTimes(2);
    expect(messageCreated).toHaveBeenCalledTimes(1);
    expect(messageDone).toHaveBeenCalledTimes(1);
    expect(runner.currentEvent()).toEqual(terminalEvent);
    expect(runner.currentMessageSnapshot()).toBeUndefined();
  });

  test.each(['', null, 123])('rejects the invalid message ID %j before emitting its creation', async (id) => {
    const runner = assistantStream([
      { event: 'thread.message.created', data: { id, role: 'assistant', content: [] } },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const messageCreated = vi.fn();

    runner.on('event', rawEvent);
    runner.on('messageCreated', messageCreated);

    await expect(runner.done()).rejects.toThrow('invalid message ID');

    expect(rawEvent).not.toHaveBeenCalled();
    expect(messageCreated).not.toHaveBeenCalled();
    expect(runner.currentEvent()).toBeUndefined();
    expect(runner.currentMessageSnapshot()).toBeUndefined();
  });

  test.each([
    'thread.message.delta',
    'thread.message.in_progress',
    'thread.message.completed',
    'thread.message.incomplete',
  ])('rejects %s before message creation without exposing the raw event', async (event) => {
    const data =
      event === 'thread.message.delta'
        ? { id: 'msg_missing', delta: { content: [] } }
        : { id: 'msg_missing', content: [] };
    const runner = assistantStream([{ event, data }, completedRun()]);
    const rawEvent = vi.fn();

    runner.on('event', rawEvent);

    await expect(runner.done()).rejects.toThrow('no existing snapshot');

    expect(rawEvent).not.toHaveBeenCalled();
    expect(runner.currentEvent()).toBeUndefined();
    expect(runner.currentMessageSnapshot()).toBeUndefined();
  });

  test.each([
    'thread.message.delta',
    'thread.message.in_progress',
    'thread.message.completed',
    'thread.message.incomplete',
  ])('rejects %s after message completion without exposing the raw event', async (event) => {
    const message = { id: 'msg_completed', role: 'assistant', content: [] };
    const terminalEvent = { event: 'thread.message.completed', data: message };
    const data = event === 'thread.message.delta' ? { id: message.id, delta: { content: [] } } : message;
    const runner = assistantStream([
      { event: 'thread.message.created', data: message },
      terminalEvent,
      { event, data },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const messageDone = vi.fn();

    runner.on('event', rawEvent);
    runner.on('messageDone', messageDone);

    await expect(runner.done()).rejects.toThrow('no existing snapshot');

    expect(rawEvent).toHaveBeenCalledTimes(2);
    expect(messageDone).toHaveBeenCalledTimes(1);
    expect(runner.currentEvent()).toEqual(terminalEvent);
    expect(runner.currentMessageSnapshot()).toBeUndefined();
  });

  test.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the reserved %s property in newly inserted message content',
    async (key) => {
      const message = { id: 'msg_123', role: 'assistant', content: [] };
      const runner = assistantStream([
        { event: 'thread.message.created', data: message },
        {
          event: 'thread.message.delta',
          data: {
            id: 'msg_123',
            delta: {
              content: [{ index: 0, type: 'text', text: { value: 'hello', [key]: 'blocked' } }],
            },
          },
        },
      ]);

      await expect(runner.done()).rejects.toThrow(`unsafe property: ${key}`);
      expect(runner.currentMessageSnapshot()).toEqual(message);
    },
  );

  test.each(['invalid', -1, 1.5, null])(
    'rejects the invalid content index %j without mutating the message snapshot',
    async (index) => {
      const message = {
        id: 'msg_123',
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'original', annotations: [] } }],
      };
      const runner = assistantStream([
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
      ]);

      await expect(runner.done()).rejects.toThrow('invalid content index');
      expect(runner.currentMessageSnapshot()).toEqual(message);
    },
  );

  test('emits the finalized run exactly once', async () => {
    const finalRun = completedRun();
    const runner = assistantStream([finalRun]);
    const listener = vi.fn();

    runner.on('run', listener);

    await runner.done();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(finalRun.data);
  });

  test.each(['__proto__', 'constructor', 'toString'])(
    'retains legitimate message snapshots with the reserved %s ID',
    async (id) => {
      const message = { id, role: 'assistant', content: [] };
      const runner = assistantStream([{ event: 'thread.message.created', data: message }, completedRun()]);

      await expect(runner.finalMessages()).resolves.toEqual([message]);
    },
  );

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
    const created = vi.fn();
    const textCreated = vi.fn();
    const textDelta = vi.fn();
    const textDone = vi.fn();
    const imageDone = vi.fn();
    const messageDone = vi.fn();

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
    const textDone = vi.fn();
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
    const stepCreated = vi.fn();
    const stepDelta = vi.fn();
    const stepDone = vi.fn();
    const toolCreated = vi.fn();
    const toolDelta = vi.fn();
    const toolDone = vi.fn();

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
      const stepDone = vi.fn();
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

  test('rejects inherited run-step snapshot IDs without polluting object prototypes', async () => {
    const pollutionKey = '__assistantStreamSnapshotPollutionRegression_019ffd14__';

    try {
      const runner = assistantStream([
        {
          event: 'thread.run.step.delta',
          data: { id: '__proto__', delta: { [pollutionKey]: 'attacker-controlled' } },
        },
        completedRun(),
      ]);

      await expect(runner.done()).rejects.toThrow('Received a RunStepDelta before creation of a snapshot');
      expect(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey)).toBeUndefined();
      expect(({} as Record<string, unknown>)[pollutionKey]).toBeUndefined();
      expect(([] as unknown as Record<string, unknown>)[pollutionKey]).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, pollutionKey);
    }
  });

  test.each(['__proto__', 'constructor', 'toString'])(
    'rejects a run-step delta received before the reserved %s ID has a snapshot',
    async (id) => {
      const runner = assistantStream([
        { event: 'thread.run.step.delta', data: { id, delta: {} } },
        completedRun(),
      ]);

      await expect(runner.done()).rejects.toThrow('Received a RunStepDelta before creation of a snapshot');
    },
  );

  test.each(['__proto__', 'constructor', 'toString'])(
    'retains legitimate run-step snapshots and deltas with the reserved %s ID',
    async (id) => {
      const initialStep = {
        id,
        status: 'in_progress',
        step_details: { type: 'message_creation', message_creation: {} },
      };
      const finalStep = { ...initialStep, status: 'completed', metadata: { marker: 'received' } };
      const runner = assistantStream([
        { event: 'thread.run.step.created', data: initialStep },
        { event: 'thread.run.step.delta', data: { id, delta: { metadata: { marker: 'received' } } } },
        { event: 'thread.run.step.completed', data: finalStep },
        completedRun(),
      ]);

      await expect(runner.finalRunSteps()).resolves.toEqual([finalStep]);
    },
  );

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
    const toolDone = vi.fn();
    runner.on('toolCallDone', toolDone);

    await runner.done();

    expect(toolDone).toHaveBeenCalledTimes(1);
  });
});

describe('AssistantStream factories and async iteration', () => {
  test.each(['on', 'once'] as const)('preserves callback receivers for %s listeners', async (method) => {
    const events = [{ event: 'thread.created', data: { id: 'thread_synthetic' } }, completedRun()];
    const stream = assistantStream(events);
    const unbound = vi.fn();
    const bound = vi.fn();
    const context = { name: 'caller-owned context' };

    stream[method]('event', unbound);
    stream[method]('event', bound.bind(context));
    await stream.done();

    const calls = (method === 'once' ? events.slice(0, 1) : events).map((event) => [event]);
    expect(bound.mock.calls).toEqual(calls);
    expect(bound.mock.contexts).toEqual(calls.map(() => context));
    expect(unbound.mock.calls).toEqual(calls);
    expect(unbound.mock.contexts).toHaveLength(calls.length);
    expect(unbound.mock.contexts.every((receiver) => receiver === undefined)).toBe(true);
  });

  test('surfaces a server error event from a readable stream as an APIError', async () => {
    const errorBody = {
      message: 'upstream exploded',
      type: 'server_error',
      code: 'server_error',
      param: 'thread_id',
    };
    const readable = new Stream(async function* errorEvents() {
      yield { event: 'error' as const, data: errorBody };
    }, new AbortController()).toReadableStream();

    const runner = AssistantStream.fromReadableStream(readable);
    const failure = await runner.done().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(APIError);
    expect(failure).toMatchObject({
      message: 'upstream exploded',
      code: 'server_error',
      param: 'thread_id',
      type: 'server_error',
      error: errorBody,
    });
  });

  test('surfaces an error event with malformed data as an APIError instead of crashing', async () => {
    const readable = new Stream(async function* errorEvents() {
      yield { event: 'error' as const, data: null as any };
    }, new AbortController()).toReadableStream();

    const runner = AssistantStream.fromReadableStream(readable);
    const failure = await runner.done().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(APIError);
  });

  test('creates a run stream with helper metadata and preserves Headers instances', async () => {
    const runs = { create: vi.fn().mockResolvedValue(iterableEvents([completedRun()])) };
    const headers = new Headers({ 'x-custom': 'value' });
    const runner = AssistantStream.createAssistantStream(
      'thread_123',
      runs as any,
      { assistant_id: 'assistant_123' },
      { headers, __metadata: { requestID: 'request_123' } },
    );

    await expect(runner.finalRun()).resolves.toMatchObject({ id: 'run_123' });
    expect(runs.create).toHaveBeenCalledWith(
      'thread_123',
      { assistant_id: 'assistant_123', stream: true },
      expect.objectContaining({
        headers,
        __metadata: { requestID: 'request_123', helperMethod: 'stream' },
        signal: runner.controller.signal,
      }),
    );
  });

  test('creates a thread-and-run stream with helper metadata and preserves tuple headers', async () => {
    const threads = { createAndRun: vi.fn().mockResolvedValue(iterableEvents([completedRun()])) };
    const headers: [string, string][] = [['x-custom', 'value']];
    const runner = AssistantStream.createThreadAssistantStream(
      { assistant_id: 'assistant_123' },
      threads as any,
      { headers },
    );

    await runner.done();

    expect(threads.createAndRun).toHaveBeenCalledWith(
      { assistant_id: 'assistant_123', stream: true },
      expect.objectContaining({
        headers,
        __metadata: { helperMethod: 'stream' },
        signal: runner.controller.signal,
      }),
    );
  });

  test('creates a tool-output stream with helper metadata and preserves custom headers', async () => {
    const runs = { submitToolOutputs: vi.fn().mockResolvedValue(iterableEvents([completedRun()])) };
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
        headers: { 'x-custom': 'value' },
        __metadata: { helperMethod: 'stream' },
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

  test('drains cloned queued events before rejecting a terminal stream error', async () => {
    const runner = new AssistantStream();
    const iterator = runner[Symbol.asyncIterator]();
    const event = completedRun('run_original');
    const error = new OpenAIError('stream failed after an event');

    runner._emit('event', event as AssistantStreamEvent);
    event.data.id = 'run_mutated_after_emit';
    runner._emit('error', error);

    await expect(iterator.next()).resolves.toEqual({
      value: completedRun('run_original'),
      done: false,
    });
    await expect(iterator.next()).rejects.toBe(error);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('drains queued events before rejecting a terminal stream abort', async () => {
    const runner = new AssistantStream();
    const iterator = runner[Symbol.asyncIterator]();
    const event = completedRun();
    const error = new APIUserAbortError();

    runner._emit('event', event as AssistantStreamEvent);
    runner._emit('abort', error);

    await expect(iterator.next()).resolves.toEqual({ value: event, done: false });
    await expect(iterator.next()).rejects.toBe(error);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
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
        case 'run': {
          runner = AssistantStream.createAssistantStream(
            'thread_123',
            { create: vi.fn().mockResolvedValue(stream) } as any,
            { assistant_id: 'assistant_123' },
          );
          break;
        }
        case 'thread': {
          runner = AssistantStream.createThreadAssistantStream({ assistant_id: 'assistant_123' }, {
            createAndRun: vi.fn().mockResolvedValue(stream),
          } as any);
          break;
        }
        case 'tool': {
          runner = AssistantStream.createToolAssistantStream(
            'run_123',
            { submitToolOutputs: vi.fn().mockResolvedValue(stream) } as any,
            { thread_id: 'thread_123', tool_outputs: [] },
            undefined,
          );
          break;
        }
      }

      await expect(runner.done()).rejects.toThrow(APIUserAbortError);
      expect(runner.aborted).toBe(true);
    },
  );

  test('ignores forward-compatible assistant events it does not recognize', async () => {
    const runner = assistantStream([{ event: 'thread.future_event', data: {} }, completedRun()]);

    await expect(runner.finalRun()).resolves.toMatchObject({ id: 'run_123' });
  });

  test('surfaces streamed error events as APIError', async () => {
    const error = {
      message: 'unexpected',
      type: 'server_error',
      code: 'server_error',
      param: 'thread_id',
    };
    const runner = assistantStream([{ event: 'error', data: error }, completedRun()]);

    await expect(runner.done()).rejects.toMatchObject({
      message: 'unexpected',
      code: 'server_error',
      param: 'thread_id',
      type: 'server_error',
      error,
    });
  });
});
