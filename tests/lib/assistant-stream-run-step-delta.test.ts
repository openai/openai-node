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
  test('ignores symbol metadata on callable deltas during accumulation', async () => {
    const step = runStep('step_original');
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      toolCallDelta(step.id),
      completedRun(),
    ]);
    const read = vi.fn(() => {
      throw new Error('unexpected metadata read');
    });
    const stepDelta = vi.fn();
    runner.on('event', (event) => {
      if (event.event === 'thread.run.step.delta') {
        const callable = Object.assign(() => 'synthetic callable', event.data.delta);
        Object.defineProperty(callable, Symbol('metadata'), { enumerable: true, get: read });
        event.data.delta = callable;
      }
    });
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(read).not.toHaveBeenCalled();
    expect(typeof stepDelta.mock.calls[0]?.[0]).toBe('function');
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
  });

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

  test.each(['unchanged', 'add-id', 'replace-object', 'replace-callable', 'object-to-callable-id'] as const)(
    'stabilizes callable delta content for %s raw listener behavior',
    async (behavior) => {
      const step = runStep('step_original');
      const { delta: original } = toolCallDelta(step.id).data;
      const callable = Object.assign(() => 'synthetic callable', original);
      const event = {
        event: 'thread.run.step.delta',
        data: { id: step.id, delta: behavior === 'object-to-callable-id' ? original : callable },
      };
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        event,
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      const readID = vi.fn(() => '_alias');
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
        },
      };
      runner.on('event', (received) => {
        if (received.event !== 'thread.run.step.delta') {
          return;
        }
        if (behavior === 'replace-object') {
          event.data.delta = replacement;
        } else if (behavior === 'replace-callable' || behavior === 'object-to-callable-id') {
          event.data.delta = Object.assign(() => 'synthetic replacement', replacement);
        }
        if (behavior === 'add-id' || behavior === 'object-to-callable-id') {
          Object.defineProperty(event.data.delta, 'id', { enumerable: true, get: readID });
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readID).not.toHaveBeenCalled();
      expect(stepDelta).toHaveBeenCalledTimes(1);
      const emittedDelta = stepDelta.mock.calls[0]?.[0];
      if (behavior === 'add-id' || behavior === 'object-to-callable-id') {
        expect(Object.is(emittedDelta, event.data.delta)).toBe(false);
        expect(emittedDelta).not.toHaveProperty('id');
      } else {
        expect(emittedDelta).toBe(event.data.delta);
      }
      expect(step.id).toBe('step_original');
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe(
        `{"to":"trusted"}${behavior === 'unchanged' || behavior === 'add-id' ? ' updated' : ' replacement'}`,
      );
    },
  );

  test.each(['initialize', 'replace'] as const)(
    'defers enumerable delta getters until raw listeners %s them',
    async (mutation) => {
      const step = runStep('step_original');
      const { delta } = toolCallDelta(step.id).data;
      const details = delta.step_details;
      let initialized = false;
      const readDetails = vi.fn(() => {
        expect(initialized).toBe(true);
        return details;
      });
      Object.defineProperty(delta, 'step_details', {
        configurable: true,
        enumerable: true,
        get: readDetails,
      });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data: { id: step.id, delta } },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          expect(readDetails).not.toHaveBeenCalled();
          if (mutation === 'initialize') {
            initialized = true;
          } else {
            Object.defineProperty(delta, 'step_details', { value: details });
          }
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readDetails.mock.calls.length > 0).toBe(mutation === 'initialize');
      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).toBe(delta);
      expect(step.id).toBe('step_original');
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

  test('does not refresh a setter-backed delta when no preceding listener ran', async () => {
    const step = runStep('step_original');
    const deltas = [' first', ' second', ' third'].map((argumentsDelta) => ({
      step_details: {
        type: 'tool_calls' as const,
        tool_calls: [{ index: 0, function: { arguments: argumentsDelta } }],
      },
    }));
    let reads = 0;
    const data = Object.defineProperty({ id: step.id }, 'delta', {
      enumerable: true,
      get() {
        const delta = deltas[reads];
        reads += 1;
        return delta;
      },
      set(_value) {},
    });
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const stepDelta = vi.fn();
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(reads).toBe(1);
    expect(stepDelta).toHaveBeenCalledTimes(1);
    expect(stepDelta.mock.calls[0]?.[0]).toBe(deltas[0]);
    expect(stepDelta.mock.calls[0]?.[1]).toBe(step);
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} first');
  });

  test.each([
    { kind: 'foreign', id: 'step_foreign', error: /does not match the active run step/u },
    { kind: 'missing', id: undefined, error: /invalid run-step ID/u },
    { kind: 'non-string', id: 123, error: /invalid run-step ID/u },
    { kind: 'no-active-step', id: 'step_trusted', error: /before creation of a snapshot/u },
  ])('rejects a $kind envelope before invoking its delta getter', async ({ kind, id, error }) => {
    const step = runStep('step_trusted');
    const data = id === undefined ? {} : { id };
    const readDelta = vi.fn(() => {
      throw new Error('Delta getter must not run before envelope validation');
    });
    Object.defineProperty(data, 'delta', { enumerable: true, get: readDelta });
    const runner = unencodedAssistantStream([
      ...(kind === 'no-active-step' ? [] : [{ event: 'thread.run.step.created', data: step }]),
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const stepDelta = vi.fn();
    const toolCreated = vi.fn();
    runner.on('event', rawEvent);
    runner.on('runStepDelta', stepDelta);
    runner.on('toolCallCreated', toolCreated);

    await expect(runner.done()).rejects.toThrow(error);

    expect(readDelta).not.toHaveBeenCalled();
    expect(rawEvent).toHaveBeenCalledTimes(kind === 'no-active-step' ? 0 : 1);
    expect(stepDelta).not.toHaveBeenCalled();
    expect(toolCreated).not.toHaveBeenCalled();
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
  });

  test.each(['value', 'accessor'] as const)(
    'uses an inherited delta %s after a raw listener deletes the shadowing property',
    async (kind) => {
      const step = runStep('step_original');
      const data = { id: step.id, delta: toolCallDelta(step.id).data.delta };
      const inheritedDelta = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' inherited' } }],
        },
      };
      const readInherited = vi.fn(function readInheritedDelta(this: typeof data) {
        expect(this).toBe(data);
        return inheritedDelta;
      });
      Object.setPrototypeOf(
        data,
        Object.defineProperty(
          {},
          'delta',
          kind === 'value' ? { value: inheritedDelta } : { get: readInherited },
        ),
      );
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          expect(Reflect.deleteProperty(event.data, 'delta')).toBe(true);
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readInherited).toHaveBeenCalledTimes(kind === 'accessor' ? 1 : 0);
      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).toBe(inheritedDelta);
      expect(stepDelta.mock.calls[0]?.[1]).toBe(step);
      expect(step.id).toBe('step_original');
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} inherited');
    },
  );

  test('retains a proxy-provided delta until the property is actually replaced', async () => {
    const step = runStep('step_original');
    const descriptorDelta = { metadata: { source: 'descriptor' } };
    const proxyDelta = toolCallDelta(step.id).data.delta;
    const data = new Proxy(
      { id: step.id, delta: descriptorDelta },
      {
        get(target, property, receiver) {
          return property === 'delta' ? proxyDelta : Reflect.get(target, property, receiver);
        },
      },
    );
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const stepDelta = vi.fn();
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(stepDelta.mock.calls[0]?.[0]).toBe(proxyDelta);
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
  });

  test.each(['event', 'toolCallCreated'] as const)(
    'uses a replacement accessor installed by a %s listener',
    async (listener) => {
      const step = runStep('step_original');
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
        },
      };
      const readReplacement = vi.fn(() => replacement);
      const runner = publicAssistantStream([
        { event: 'thread.run.step.created', data: step },
        toolCallDelta(step.id),
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on(listener, () => {
        const event = runner.currentEvent();
        if (event?.event === 'thread.run.step.delta') {
          Object.defineProperty(event.data, 'delta', {
            configurable: true,
            enumerable: true,
            get: readReplacement,
          });
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readReplacement).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).toBe(replacement);
      const snapshot = stepDelta.mock.calls[0]?.[1];
      expect(snapshot).toMatchObject({ id: step.id });
      expect(snapshot.step_details.tool_calls[0]?.function.arguments).toBe(
        listener === 'event' ? '{"to":"trusted"} replacement' : '{"to":"trusted"} updated',
      );
    },
  );

  test.each([
    ['own', 'event', false],
    ['own', 'event', true],
    ['own', 'toolCallCreated', false],
    ['own', 'toolCallCreated', true],
    ['own', 'toolCallDelta', false],
    ['own', 'toolCallDelta', true],
    ['inherited', 'event', false],
    ['inherited', 'toolCallDelta', false],
  ] as const)(
    'observes %s delta setters written by %s (contains id: %s)',
    async (owner, listener, addIdentity) => {
      const step = runStep('step_original');
      const { delta: originalDelta } = toolCallDelta(step.id).data;
      let currentDelta = originalDelta;
      const data = { id: step.id };
      const readDelta = vi.fn(function readCurrentDelta(this: typeof data) {
        expect(this).toBe(data);
        return currentDelta;
      });
      const writeDelta = vi.fn(function writeCurrentDelta(this: typeof data, value: typeof originalDelta) {
        expect(this).toBe(data);
        currentDelta = value;
      });
      const descriptor = { configurable: true, enumerable: true, get: readDelta, set: writeDelta };
      if (owner === 'own') {
        Object.defineProperty(data, 'delta', descriptor);
      } else {
        Object.setPrototypeOf(data, Object.defineProperty({}, 'delta', descriptor));
      }
      const primingDeltas = listener === 'toolCallDelta' ? [toolCallDelta(step.id)] : [];
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        ...primingDeltas,
        { event: 'thread.run.step.delta', data },
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

      expect(writeDelta).toHaveBeenCalledTimes(1);
      expect(Object.is(currentDelta, replacement)).toBe(true);
      expect(readID).not.toHaveBeenCalled();
      expect(stepDelta).toHaveBeenCalledTimes(primingDeltas.length + 1);
      const [emittedDelta, snapshot] = stepDelta.mock.calls[primingDeltas.length] ?? [];
      if (addIdentity) {
        expect(Object.is(emittedDelta, replacement)).toBe(false);
        expect(emittedDelta).not.toHaveProperty('id');
        expect(emittedDelta.step_details.tool_calls[0].function.arguments).toBe(
          listener === 'event' ? ' replacement' : ' updated',
        );
      } else {
        expect(emittedDelta).toBe(replacement);
      }
      expect(snapshot.id).toBe(step.id);
      expect(snapshot.step_details.tool_calls[0].function.arguments).toBe(
        `{"to":"trusted"}${listener === 'event' ? ' replacement' : ' updated'.repeat(primingDeltas.length + 1)}`,
      );
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

  test.each(['enumerable', 'nonenumerable'] as const)(
    'rejects a proxy delta that reveals a hidden %s id only during enumeration',
    async (visibility) => {
      const step = runStep('step_original');
      const originalStep = structuredClone(step);
      let enumerated = false;
      const source = Object.defineProperty(toolCallDelta(step.id).data.delta, 'id', {
        configurable: true,
        enumerable: visibility === 'enumerable',
        value: ' appended',
      });
      const delta = new Proxy(source, {
        ownKeys(target) {
          enumerated = true;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, property) {
          return property === 'id' && !enumerated
            ? undefined
            : Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data: Object.freeze({ id: step.id, delta }) },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepDelta = vi.fn();
      const toolCreated = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepDelta', stepDelta);
      runner.on('toolCallCreated', toolCreated);

      await expect(runner.done()).rejects.toThrow('Run-step deltas must not contain an id field');

      expect(rawEvent).toHaveBeenCalledTimes(1);
      expect(stepDelta).not.toHaveBeenCalled();
      expect(toolCreated).not.toHaveBeenCalled();
      expect(step).toEqual(originalStep);
    },
  );

  test.each([
    ['inherited', 'toolCallCreated'],
    ['inherited', 'toolCallDelta'],
    ['nonenumerable', 'toolCallCreated'],
    ['nonenumerable', 'toolCallDelta'],
  ] as const)('dispatches %s step details to %s without accumulating them', async (visibility, listener) => {
    const step = runStep('step_original');
    const primingDeltas = listener === 'toolCallDelta' ? [toolCallDelta(step.id)] : [];
    const { step_details: details } = toolCallDelta(step.id).data.delta;
    const delta = {};
    const detailsByDelta = new WeakMap([[delta, details]]);
    const readDetails = vi.fn(function readOriginalDetails(this: object) {
      expect(detailsByDelta.has(this)).toBe(true);
      return detailsByDelta.get(this);
    });
    if (visibility === 'inherited') {
      Object.setPrototypeOf(delta, Object.defineProperty({}, 'step_details', { get: readDetails }));
    } else {
      Object.defineProperty(delta, 'step_details', { get: readDetails });
    }
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      ...primingDeltas,
      { event: 'thread.run.step.delta', data: { id: step.id, delta } },
      completedRun(),
    ]);
    const toolCallback = vi.fn();
    const stepDelta = vi.fn();
    runner.on(listener, toolCallback);
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(toolCallback).toHaveBeenCalledTimes(1);
    if (listener === 'toolCallDelta') {
      expect(toolCallback.mock.calls[0]?.[0]).toBe(details.tool_calls[0]);
      expect(toolCallback.mock.calls[0]?.[1]).toBe(step.step_details.tool_calls[0]);
    } else {
      expect(toolCallback.mock.calls[0]?.[0]).toBe(step.step_details.tool_calls[0]);
    }
    expect(readDetails).toHaveBeenCalled();
    expect(stepDelta).toHaveBeenCalledTimes(primingDeltas.length + 1);
    expect(stepDelta.mock.calls[primingDeltas.length]?.[0]).toBe(delta);
    expect(step.id).toBe('step_original');
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe(
      `{"to":"trusted"}${' updated'.repeat(primingDeltas.length)}`,
    );
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
