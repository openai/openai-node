import { vi } from 'vitest';
import {
  assistantStream,
  completedRun,
  publicAssistantStream,
  runStep,
  toolCallDelta,
  unencodedAssistantStream,
} from './assistant-stream-test-utils';

describe('AssistantStream run-step deltas', () => {
  describe.each([
    ['SSE', publicAssistantStream],
    ['serialized stream', assistantStream],
  ] as const)('%s run-step deltas', (_transport, createStream) => {
    test.each([' appended', '', null, 123])('rejects an own id field containing %j', async (id) => {
      const step = runStep('step_original');
      const created = { event: 'thread.run.step.created', data: step };
      const runner = createStream([
        created,
        {
          event: 'thread.run.step.delta',
          data: { id: step.id, delta: { id, metadata: { changed: true } } },
        },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepDelta', stepDelta);

      await expect(runner.done()).rejects.toThrow('Run-step deltas must not contain an id field');

      expect(rawEvent).toHaveBeenCalledTimes(1);
      expect(stepDelta).not.toHaveBeenCalled();
      expect(runner.currentRunStepSnapshot()).toEqual(step);
    });

    test('isolates the captured delta from identity fields added by a raw listener', async () => {
      const step = runStep('step_original');
      const alias = runStep('step_original_alias');
      const runner = createStream([
        { event: 'thread.run.step.created', data: step },
        toolCallDelta(step.id),
        { event: 'thread.run.step.completed', data: { ...step, status: 'completed' } },
        { event: 'thread.run.step.created', data: alias },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          Object.defineProperty(event.data.delta, 'id', { enumerable: true, value: '_alias' });
          const details = event.data.delta.step_details;
          if (details?.type === 'tool_calls') {
            const [toolCall] = details.tool_calls ?? [];
            if (toolCall && 'function' in toolCall && toolCall.function) {
              toolCall.function.arguments = ' listener update';
            }
          }
        }
      });
      runner.on('runStepDelta', (delta, snapshot) => stepDelta(delta, structuredClone(snapshot)));

      await runner.done();

      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).not.toHaveProperty('id');
      expect(stepDelta.mock.calls[0]?.[1]).toMatchObject({
        id: step.id,
        step_details: { tool_calls: [{ function: { arguments: '{"to":"trusted"} listener update' } }] },
      });
      const finalSteps = await runner.finalRunSteps();
      expect(finalSteps.map((snapshot) => snapshot.id)).toEqual([step.id, alias.id]);
    });

    test('preserves the raw delta identity, prototype, and nonenumerable listener properties', async () => {
      const step = runStep('step_original');
      const runner = createStream([
        { event: 'thread.run.step.created', data: step },
        toolCallDelta(step.id),
        completedRun(),
      ]);
      const prototype = { listenerMarker: 'synthetic' };
      const metadata = { source: 'raw listener' };
      const stepDelta = vi.fn();
      let rawDelta: unknown;
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          rawDelta = event.data.delta;
          Object.setPrototypeOf(event.data.delta, prototype);
          Object.defineProperty(event.data.delta, 'listenerMetadata', { value: metadata });
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(stepDelta).toHaveBeenCalledTimes(1);
      const emittedDelta = stepDelta.mock.calls[0]?.[0];
      expect(emittedDelta).toBe(rawDelta);
      expect(Object.getPrototypeOf(emittedDelta)).toBe(prototype);
      expect(Object.getOwnPropertyDescriptor(emittedDelta, 'listenerMetadata')).toEqual({
        configurable: false,
        enumerable: false,
        writable: false,
        value: metadata,
      });
    });

    test('isolates an identity field added by a tool callback before runStepDelta', async () => {
      const step = runStep('step_original');
      const runner = createStream([
        { event: 'thread.run.step.created', data: step },
        toolCallDelta(step.id),
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('toolCallCreated', () => {
        const event = runner.currentEvent();
        if (event?.event === 'thread.run.step.delta') {
          Object.defineProperty(event.data.delta, 'id', { enumerable: true, value: '_alias' });
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).not.toHaveProperty('id');
      expect(stepDelta.mock.calls[0]?.[1].id).toBe(step.id);
    });

    test.each([
      { listener: 'toolCallCreated', addIdentity: false },
      { listener: 'toolCallDelta', addIdentity: false },
      { listener: 'toolCallCreated', addIdentity: true },
      { listener: 'toolCallDelta', addIdentity: true },
    ] as const)(
      'uses a $listener replacement for the runStepDelta callback (contains id: $addIdentity)',
      async ({ listener, addIdentity }) => {
        const step = runStep('step_original');
        const primingDeltas = listener === 'toolCallDelta' ? [toolCallDelta(step.id)] : [];
        const runner = createStream([
          { event: 'thread.run.step.created', data: step },
          ...primingDeltas,
          toolCallDelta(step.id),
          completedRun(),
        ]);
        const replacement = {
          step_details: {
            type: 'tool_calls' as const,
            tool_calls: [{ index: 0, type: 'function' as const, function: { arguments: ' replacement' } }],
          },
        };
        const readID = vi.fn(() => '_alias');
        if (addIdentity) {
          Object.defineProperty(replacement, 'id', { enumerable: true, get: readID });
        }
        const stepDelta = vi.fn();
        runner.on(listener, () => {
          const event = runner.currentEvent();
          if (event?.event === 'thread.run.step.delta') {
            event.data.delta = replacement;
          }
        });
        runner.on('runStepDelta', stepDelta);

        await runner.done();

        expect(stepDelta).toHaveBeenCalledTimes(primingDeltas.length + 1);
        const [emittedDelta, snapshot] = stepDelta.mock.calls[primingDeltas.length] ?? [];
        expect(readID).not.toHaveBeenCalled();
        if (addIdentity) {
          expect(Object.is(emittedDelta, replacement)).toBe(false);
          expect(emittedDelta).not.toHaveProperty('id');
          expect(emittedDelta.step_details.tool_calls[0].function.arguments).toBe(' updated');
        } else {
          expect(emittedDelta).toBe(replacement);
        }
        expect(snapshot.id).toBe(step.id);
        expect(snapshot.step_details.tool_calls[0].function.arguments).toBe(
          `{"to":"trusted"}${' updated'.repeat(primingDeltas.length + 1)}`,
        );
      },
    );

    test.each(['replace-details', 'delete-details', 'replace-delta'] as const)(
      'preserves a raw listener %s mutation',
      async (kind) => {
        const step = runStep('step_original');
        const runner = createStream([
          { event: 'thread.run.step.created', data: step },
          toolCallDelta(step.id),
          completedRun(),
        ]);
        const stepDelta = vi.fn();
        let rawDelta: unknown;
        runner.on('event', (event) => {
          if (event.event === 'thread.run.step.delta') {
            if (kind === 'delete-details') {
              delete event.data.delta.step_details;
            } else if (kind === 'replace-details') {
              event.data.delta.step_details = {
                type: 'tool_calls',
                tool_calls: [{ index: 0, type: 'function', function: { arguments: ' replacement' } }],
              };
            } else {
              event.data.delta = {
                step_details: {
                  type: 'tool_calls',
                  tool_calls: [{ index: 0, type: 'function', function: { arguments: ' replacement' } }],
                },
              };
            }
            rawDelta = event.data.delta;
          }
        });
        runner.on('runStepDelta', stepDelta);

        await runner.done();

        expect(stepDelta).toHaveBeenCalledTimes(1);
        expect(stepDelta.mock.calls[0]?.[0]).toBe(rawDelta);
        expect(runner.currentRunStepSnapshot()?.step_details).toMatchObject({
          tool_calls: [
            {
              function: {
                arguments: `{"to":"trusted"}${kind.startsWith('delete') ? '' : ' replacement'}`,
              },
            },
          ],
        });
      },
    );
  });

  test.each(['ordinary', 'frozen with a custom prototype'] as const)(
    'preserves the %s raw delta event from a custom transport',
    async (kind) => {
      const step = runStep('step_original');
      const event = toolCallDelta(step.id);
      const prototype = { transportMarker: 'synthetic' };
      if (kind === 'frozen with a custom prototype') {
        Object.setPrototypeOf(event.data.delta, prototype);
        Object.freeze(event.data.delta);
        Object.freeze(event.data);
        Object.freeze(event);
      }
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        event,
        completedRun(),
      ]);
      const rawDelta = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', (received) => {
        if (received.event === 'thread.run.step.delta') {
          rawDelta(received, runner.currentEvent());
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(rawDelta).toHaveBeenCalledTimes(1);
      const received = rawDelta.mock.calls[0]?.[0];
      const current = rawDelta.mock.calls[0]?.[1];
      expect(received).toBe(event);
      expect(current).toBe(event);
      expect(received.data).toBe(event.data);
      expect(received.data.delta).toBe(event.data.delta);
      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).toBe(event.data.delta);
      expect(Object.getPrototypeOf(received.data.delta)).toBe(
        kind === 'ordinary' ? Object.prototype : prototype,
      );
      expect(Object.isFrozen(received.data.delta)).toBe(kind !== 'ordinary');
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test.each([false, true])(
    'reads delta properties on the original receiver (listener adds id: %s)',
    async (addIdentity) => {
      const step = runStep('step_original');
      const event = toolCallDelta(step.id);
      const { delta } = event.data;
      const details = new WeakMap([[delta, delta.step_details]]);
      const readDetails = vi.fn(function readOriginalDetails(this: typeof delta) {
        if (this !== delta) {
          throw new Error('Delta getter received a reconstructed object');
        }
        return details.get(this);
      });
      Object.defineProperty(delta, 'step_details', { enumerable: true, get: readDetails });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        event,
        completedRun(),
      ]);
      const readID = vi.fn(() => {
        throw new Error('A listener-added identity field must not be read');
      });
      if (addIdentity) {
        runner.on('event', (received) => {
          if (received.event === 'thread.run.step.delta') {
            Object.defineProperty(delta, 'id', { enumerable: true, get: readID });
          }
        });
      }
      const stepDelta = vi.fn();
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readDetails).toHaveBeenCalled();
      expect(readID).not.toHaveBeenCalled();
      expect(stepDelta).toHaveBeenCalledTimes(1);
      if (addIdentity) {
        expect(stepDelta.mock.calls[0]?.[0]).not.toHaveProperty('id');
      } else {
        expect(stepDelta.mock.calls[0]?.[0]).toBe(delta);
      }
      expect(step.id).toBe('step_original');
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test.each(['accessor', 'proxy'] as const)(
    'captures a changing %s delta once for accumulation',
    async (kind) => {
      const step = runStep('step_original');
      const originalDelta = toolCallDelta(step.id).data.delta;
      const readDelta = vi
        .fn()
        .mockReturnValueOnce(originalDelta)
        .mockReturnValueOnce(originalDelta)
        .mockReturnValue({ id: ' appended' });
      const data =
        kind === 'accessor'
          ? Object.defineProperty({ id: step.id }, 'delta', { enumerable: true, get: readDelta })
          : new Proxy(
              { id: step.id, delta: originalDelta },
              {
                get(target, property, receiver) {
                  return property === 'delta' ? readDelta() : Reflect.get(target, property, receiver);
                },
              },
            );
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(step.id).toBe('step_original');
      expect(readDelta).toHaveBeenCalledTimes(1);
      const emittedDelta = stepDelta.mock.calls[0]?.[0];
      expect(emittedDelta).toEqual(originalDelta);
      expect(emittedDelta).toBe(originalDelta);
      expect(emittedDelta.step_details).toBe(originalDelta.step_details);
      expect(rawEvent.mock.calls[1]?.[0].data).toBe(data);
      expect(stepDelta.mock.calls[0]?.[1]).toBe(step);
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test('uses a raw listener value replacement of a configurable delta getter', async () => {
    const step = runStep('step_original');
    const { delta } = toolCallDelta(step.id).data;
    const readDelta = vi.fn(() => delta);
    const data = Object.defineProperty({ id: step.id }, 'delta', {
      configurable: true,
      enumerable: true,
      get: readDelta,
    });
    const replacement = {
      step_details: {
        type: 'tool_calls',
        tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
      },
    };
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const stepDelta = vi.fn();
    runner.on('event', (event) => {
      if (event.event === 'thread.run.step.delta') {
        Object.defineProperty(event.data, 'delta', { value: replacement });
      }
    });
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(readDelta).toHaveBeenCalledTimes(1);
    expect(stepDelta).toHaveBeenCalledTimes(1);
    expect(stepDelta.mock.calls[0]?.[0]).toBe(replacement);
    expect(stepDelta.mock.calls[0]?.[1]).toBe(step);
    expect(step.id).toBe('step_original');
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} replacement');
  });

  test('rejects a proxy delta that reveals an id only during enumeration', async () => {
    const step = runStep('step_original');
    const originalStep = structuredClone(step);
    let enumerated = false;
    const delta = new Proxy(
      { id: ' appended', ...toolCallDelta(step.id).data.delta },
      {
        ownKeys(target) {
          enumerated = true;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, property) {
          return property === 'id' && !enumerated
            ? undefined
            : Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      { event: 'thread.run.step.delta', data: Object.freeze({ id: step.id, delta }) },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const stepDelta = vi.fn();
    runner.on('event', rawEvent);
    runner.on('runStepDelta', stepDelta);

    await expect(runner.done()).rejects.toThrow('Run-step deltas must not contain an id field');

    expect(rawEvent).toHaveBeenCalledTimes(1);
    expect(stepDelta).not.toHaveBeenCalled();
    expect(step).toEqual(originalStep);
  });

  test('rejects a nonenumerable delta id without reading it', async () => {
    const step = runStep('step_original');
    const readID = vi.fn(() => ' appended');
    const delta = Object.defineProperty(toolCallDelta(step.id).data.delta, 'id', { get: readID });
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      { event: 'thread.run.step.delta', data: { id: step.id, delta } },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    runner.on('event', rawEvent);

    await expect(runner.done()).rejects.toThrow('Run-step deltas must not contain an id field');

    expect(rawEvent).toHaveBeenCalledTimes(1);
    expect(readID).not.toHaveBeenCalled();
    expect(step.id).toBe('step_original');
  });
});
