import { vi } from 'vitest';
import {
  assistantStream,
  completedRun,
  publicAssistantStream,
  runStep,
  toolCallDelta,
  unencodedAssistantStream,
} from './assistant-stream-test-utils';

describe('AssistantStream run-step dispatch ordering', () => {
  test.each([
    { kind: 'foreign', id: 'step_foreign', error: /does not match the active run step/u },
    { kind: 'missing', id: undefined, error: /invalid run-step ID/u },
    { kind: 'non-string', id: 123, error: /invalid run-step ID/u },
    { kind: 'no-active-step', id: 'step_trusted', error: /before creation of a snapshot/u },
  ])('rejects a $kind envelope before enumerating its properties', async ({ kind, id, error }) => {
    const step = runStep('step_trusted');
    const { delta } = toolCallDelta(step.id).data;
    const enumerate = vi.fn();
    const data = new Proxy(id === undefined ? { delta } : { id, delta }, {
      ownKeys(target) {
        enumerate();
        return Reflect.ownKeys(target);
      },
    });
    const runner = unencodedAssistantStream([
      ...(kind === 'no-active-step' ? [] : [{ event: 'thread.run.step.created', data: step }]),
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const stepDelta = vi.fn();
    runner.on('event', rawEvent);
    runner.on('runStepDelta', stepDelta);

    await expect(runner.done()).rejects.toThrow(error);

    expect(enumerate).not.toHaveBeenCalled();
    expect(rawEvent).toHaveBeenCalledTimes(kind === 'no-active-step' ? 0 : 1);
    expect(stepDelta).not.toHaveBeenCalled();
    expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
  });

  test.each(['collision', 'safe alias'] as const)(
    'validates a raw listener snapshot %s before reading enumerable delta properties',
    async (mutation) => {
      const completed = runStep('step_completed');
      const active = runStep('step_active');
      const { step_details: details } = toolCallDelta(active.id).data.delta;
      const readDetails = vi.fn(() => details);
      const delta = Object.defineProperty({}, 'step_details', { enumerable: true, get: readDetails });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: completed },
        { event: 'thread.run.step.completed', data: { ...completed, status: 'completed' } },
        { event: 'thread.run.step.created', data: active },
        { event: 'thread.run.step.delta', data: { id: active.id, delta } },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      const toolCreated = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          const snapshot = runner.currentRunStepSnapshot();
          if (snapshot) {
            snapshot.id = mutation === 'collision' ? completed.id : 'step_safe_alias';
          }
        }
      });
      runner.on('runStepDelta', stepDelta);
      runner.on('toolCallCreated', toolCreated);

      if (mutation === 'collision') {
        await expect(runner.done()).rejects.toThrow(/already been created/u);
        expect(readDetails).not.toHaveBeenCalled();
        expect(stepDelta).not.toHaveBeenCalled();
        expect(toolCreated).not.toHaveBeenCalled();
        expect(active.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
      } else {
        await runner.done();
        expect(readDetails).toHaveBeenCalled();
        expect(stepDelta).toHaveBeenCalledTimes(1);
        expect(toolCreated).toHaveBeenCalledTimes(1);
        expect(stepDelta.mock.calls[0]?.[0]).toBe(delta);
        expect(active.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
      }
    },
  );

  test.each(['collision', 'safe alias'] as const)(
    'validates an envelope %s from the initial delta getter before raw dispatch',
    async (mutation) => {
      const completed = runStep('step_completed');
      const active = runStep('step_active');
      const { delta } = toolCallDelta(active.id).data;
      const data = { id: active.id };
      const readDelta = vi.fn(() => {
        data.id = mutation === 'collision' ? completed.id : 'step_safe_alias';
        return delta;
      });
      Object.defineProperty(data, 'delta', { enumerable: true, get: readDelta });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: completed },
        { event: 'thread.run.step.completed', data: { ...completed, status: 'completed' } },
        { event: 'thread.run.step.created', data: active },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepDelta', stepDelta);

      if (mutation === 'collision') {
        await expect(runner.done()).rejects.toThrow(/already been created/u);
        expect(rawEvent).toHaveBeenCalledTimes(3);
        expect(stepDelta).not.toHaveBeenCalled();
        expect(active.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
      } else {
        await runner.done();
        expect(rawEvent).toHaveBeenCalledTimes(5);
        expect(stepDelta).toHaveBeenCalledTimes(1);
        expect(stepDelta.mock.calls[0]?.[0]).toBe(delta);
        expect(active.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
      }
      expect(readDelta).toHaveBeenCalledTimes(1);
      expect(active.id).toBe('step_active');
    },
  );

  test.each([
    ['value', false],
    ['setter', false],
    ['inherited setter', false],
    ['value', true],
  ] as const)(
    'observes a projection getter replacing a delta %s without listeners (contains id: %s)',
    async (property, addIdentity) => {
      const step = runStep('step_original');
      const { step_details: details } = toolCallDelta(step.id).data.delta;
      let currentDelta = {};
      const data = { id: step.id, delta: currentDelta };
      if (property !== 'value') {
        const descriptor = {
          configurable: true,
          get() {
            return currentDelta;
          },
          set(value: object) {
            currentDelta = value;
          },
        };
        if (property === 'setter') {
          Object.defineProperty(data, 'delta', descriptor);
        } else {
          Object.setPrototypeOf(data, Object.defineProperty({}, 'delta', descriptor));
          Reflect.deleteProperty(data, 'delta');
        }
      }
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
        },
      };
      const readID = vi.fn(() => '_alias');
      if (addIdentity) {
        Object.defineProperty(replacement, 'id', { enumerable: true, get: readID });
      }
      const readDetails = vi.fn(() => {
        data.delta = replacement;
        return details;
      });
      Object.defineProperty(currentDelta, 'step_details', { enumerable: true, get: readDetails });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(readDetails).toHaveBeenCalled();
      expect(readID).not.toHaveBeenCalled();
      expect(stepDelta).toHaveBeenCalledTimes(1);
      const [emittedDelta, snapshot] = stepDelta.mock.calls[0] ?? [];
      if (addIdentity) {
        expect(Object.is(emittedDelta, replacement)).toBe(false);
        expect(emittedDelta).not.toHaveProperty('id');
      } else {
        expect(emittedDelta).toBe(replacement);
      }
      expect(snapshot.id).toBe(step.id);
      expect(snapshot.step_details.tool_calls[0].function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test.each([
    ['get', false],
    ['ownKeys', false],
    ['get', true],
    ['ownKeys', true],
  ] as const)(
    'observes a projection %s trap replacement without listeners (contains id: %s)',
    async (trap, addIdentity) => {
      const step = runStep('step_original');
      const { delta: originalDelta } = toolCallDelta(step.id).data;
      const data = { id: step.id, delta: originalDelta };
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
        },
      };
      const readID = vi.fn(() => '_alias');
      if (addIdentity) {
        Object.defineProperty(replacement, 'id', { enumerable: true, get: readID });
      }
      const replaceDelta = vi.fn(() => {
        data.delta = replacement;
      });
      data.delta = new Proxy(originalDelta, {
        get(target, key, receiver) {
          if (trap === 'get' && key === 'step_details') {
            replaceDelta();
          }
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          if (trap === 'ownKeys') {
            replaceDelta();
          }
          return Reflect.ownKeys(target);
        },
      });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(replaceDelta).toHaveBeenCalled();
      expect(readID).not.toHaveBeenCalled();
      expect(stepDelta).toHaveBeenCalledTimes(1);
      const [emittedDelta, snapshot] = stepDelta.mock.calls[0] ?? [];
      if (addIdentity) {
        expect(Object.is(emittedDelta, replacement)).toBe(false);
        expect(emittedDelta).not.toHaveProperty('id');
      } else {
        expect(emittedDelta).toBe(replacement);
      }
      expect(snapshot.id).toBe(step.id);
      expect(snapshot.step_details.tool_calls[0].function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test.each([
    ['envelope prototype', 'none'],
    ['envelope prototype', 'event'],
    ['inherited prototype', 'none'],
    ['inherited prototype', 'toolCallCreated'],
    ['inherited descriptor', 'none'],
    ['inherited descriptor', 'toolCallDelta'],
  ] as const)('tolerates unavailable %s metadata with %s replacement', async (kind, listener) => {
    const step = runStep('step_original');
    let currentDelta = toolCallDelta(step.id).data.delta;
    const originalDelta = currentDelta;
    const replacement = {
      step_details: {
        type: 'tool_calls',
        tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
      },
    };
    const inspect = vi.fn(() => {
      throw new Error('Optional metadata is unavailable');
    });
    const target = { id: step.id };
    const data = kind === 'envelope prototype' ? new Proxy(target, { getPrototypeOf: inspect }) : target;
    const readDelta = vi.fn(function readCurrentDelta(this: typeof data) {
      expect(this).toBe(data);
      return currentDelta;
    });
    const writeDelta = vi.fn(function writeCurrentDelta(this: typeof data, value: typeof currentDelta) {
      expect(this).toBe(data);
      currentDelta = value;
    });
    const owner = Object.defineProperty({}, 'delta', { get: readDelta, set: writeDelta });
    const intermediate = new Proxy(Object.setPrototypeOf({}, owner), {
      getPrototypeOf(object) {
        return kind === 'inherited prototype' ? inspect() : Reflect.getPrototypeOf(object);
      },
      getOwnPropertyDescriptor(object, key) {
        return kind === 'inherited descriptor' && key === 'delta'
          ? inspect()
          : Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    Object.setPrototypeOf(target, kind === 'envelope prototype' ? owner : intermediate);
    const primingDeltas = listener === 'toolCallDelta' ? [toolCallDelta(step.id)] : [];
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      ...primingDeltas,
      { event: 'thread.run.step.delta', data },
      completedRun(),
    ]);
    const stepDelta = vi.fn();
    if (listener !== 'none') {
      runner.on(listener, () => {
        if (runner.currentEvent()?.data === data) {
          expect(Reflect.set(data, 'delta', replacement)).toBe(true);
        }
      });
    }
    runner.on('runStepDelta', stepDelta);

    await runner.done();

    expect(inspect).toHaveBeenCalled();
    expect(writeDelta).toHaveBeenCalledTimes(listener === 'none' ? 0 : 1);
    expect(readDelta).toHaveBeenCalledTimes(listener === 'none' ? 1 : 2);
    expect(stepDelta).toHaveBeenCalledTimes(primingDeltas.length + 1);
    const [emittedDelta, snapshot] = stepDelta.mock.calls[primingDeltas.length] ?? [];
    expect(emittedDelta).toBe(listener === 'none' ? originalDelta : replacement);
    expect(snapshot).toBe(step);
    expect(snapshot.step_details.tool_calls[0].function.arguments).toBe(
      `{"to":"trusted"}${listener === 'event' ? ' replacement' : ' updated'.repeat(primingDeltas.length + 1)}`,
    );
  });

  test.each(['initial', 'event'] as const)(
    'propagates a required delta read failure during %s access despite unavailable metadata',
    async (phase) => {
      const step = runStep('step_original');
      const { delta } = toolCallDelta(step.id).data;
      let failRead = phase === 'initial';
      const data = new Proxy(
        { id: step.id },
        {
          get(target, key, receiver) {
            if (key === 'delta') {
              if (failRead) {
                throw new Error('Required delta read failed');
              }
              return delta;
            }
            return Reflect.get(target, key, receiver);
          },
          getPrototypeOf() {
            throw new Error('Optional metadata is unavailable');
          },
        },
      );
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const rawDelta = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          rawDelta();
          failRead = true;
        }
      });
      runner.on('runStepDelta', stepDelta);

      await expect(runner.done()).rejects.toThrow('Required delta read failed');

      expect(rawDelta).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 1);
      expect(stepDelta).not.toHaveBeenCalled();
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
    },
  );

  test.each(['invalid', 'safe alias'] as const)(
    'validates a snapshot %s from initial delta enumeration before raw dispatch',
    async (mutation) => {
      const step = runStep('step_original');
      const { delta: originalDelta } = toolCallDelta(step.id).data;
      const enumerate = vi.fn(() => {
        step.id = mutation === 'invalid' ? '' : 'step_safe_alias';
      });
      const delta = new Proxy(originalDelta, {
        ownKeys(target) {
          enumerate();
          return Reflect.ownKeys(target);
        },
      });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data: { id: step.id, delta } },
        completedRun(),
      ]);
      const rawDelta = vi.fn();
      const toolCreated = vi.fn();
      const stepDelta = vi.fn();
      runner.on('event', (event) => {
        if (event.event === 'thread.run.step.delta') {
          rawDelta();
        }
      });
      runner.on('toolCallCreated', toolCreated);
      runner.on('runStepDelta', stepDelta);

      if (mutation === 'invalid') {
        await expect(runner.done()).rejects.toThrow(/invalid run-step ID/u);
        expect(rawDelta).not.toHaveBeenCalled();
        expect(toolCreated).not.toHaveBeenCalled();
        expect(stepDelta).not.toHaveBeenCalled();
        expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
      } else {
        await runner.done();
        expect(rawDelta).toHaveBeenCalledTimes(1);
        expect(toolCreated).toHaveBeenCalledTimes(1);
        expect(stepDelta.mock.calls[0]?.[0]).toBe(delta);
        expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
      }
      expect(enumerate).toHaveBeenCalled();
    },
  );

  test.each(['event', 'toolCallCreated', 'toolCallDelta'] as const)(
    'observes an inherited getter owner swapped by %s',
    async (listener) => {
      const step = runStep('step_original');
      const { delta: originalDelta } = toolCallDelta(step.id).data;
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' replacement' } }],
        },
      };
      const data = { id: step.id };
      const originalOwner = {};
      const replacementOwner = {};
      const ownerDeltas = new WeakMap([
        [originalOwner, originalDelta],
        [replacementOwner, replacement],
      ]);
      const readDelta = vi.fn(function readOwnedDelta(this: typeof data) {
        expect(this).toBe(data);
        return ownerDeltas.get(Object.getPrototypeOf(this));
      });
      const descriptor = { configurable: true, enumerable: true, get: readDelta };
      Object.defineProperty(originalOwner, 'delta', descriptor);
      Object.defineProperty(replacementOwner, 'delta', descriptor);
      Object.setPrototypeOf(data, originalOwner);
      const primingDeltas = listener === 'toolCallDelta' ? [toolCallDelta(step.id)] : [];
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        ...primingDeltas,
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const stepDelta = vi.fn();
      runner.on(listener, () => {
        if (runner.currentEvent()?.data === data) {
          Object.setPrototypeOf(data, replacementOwner);
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(stepDelta).toHaveBeenCalledTimes(primingDeltas.length + 1);
      const [emittedDelta, snapshot] = stepDelta.mock.calls[primingDeltas.length] ?? [];
      expect(emittedDelta).toBe(replacement);
      expect(readDelta).toHaveBeenCalledTimes(2);
      expect(snapshot).toBe(step);
      expect(snapshot.step_details.tool_calls[0].function.arguments).toBe(
        `{"to":"trusted"}${listener === 'event' ? ' replacement' : ' updated'.repeat(primingDeltas.length + 1)}`,
      );
    },
  );

  test('uses a snapshot tool replacement made by toolCallDone before toolCallCreated', async () => {
    const step = runStep('step_original');
    const replacement = {
      id: 'call_replacement',
      index: 1,
      type: 'function' as const,
      function: { name: 'replacement', arguments: '' },
    };
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: step },
      toolCallDelta(step.id),
      {
        event: 'thread.run.step.delta',
        data: {
          id: step.id,
          delta: {
            step_details: {
              type: 'tool_calls',
              tool_calls: [
                {
                  id: 'call_second',
                  index: 1,
                  type: 'function',
                  function: { name: 'second', arguments: '' },
                },
              ],
            },
          },
        },
      },
      completedRun(),
    ]);
    let snapshot: ReturnType<typeof runStep> | undefined;
    runner.on('runStepCreated', (value) => {
      snapshot = value as unknown as ReturnType<typeof runStep>;
    });
    runner.on('toolCallDone', () => {
      if (!snapshot) {
        throw new Error('Expected a retained run-step snapshot');
      }
      const [first] = snapshot.step_details.tool_calls;
      if (!first) {
        throw new Error('Expected the retained run-step snapshot to contain a tool call');
      }
      snapshot.step_details = {
        type: 'tool_calls',
        tool_calls: [first, replacement],
      };
    });
    const created = vi.fn();
    runner.on('toolCallCreated', created);

    await runner.done();

    expect(created).toHaveBeenLastCalledWith(replacement);
  });

  test.each(['value', 'setter'] as const)(
    'bounds prototype metadata inspection while preserving a deep inherited delta %s',
    async (kind) => {
      const step = runStep('step_original');
      let currentDelta = toolCallDelta(step.id).data.delta;
      const lookups: { hops: number }[] = [];
      let currentLookup: { hops: number } | undefined;
      const data = new Proxy(
        { id: step.id },
        {
          getPrototypeOf(target) {
            currentLookup = { hops: 0 };
            lookups.push(currentLookup);
            return Reflect.getPrototypeOf(target);
          },
        },
      );
      const readDelta = vi.fn(function readDeepDelta(this: typeof data) {
        expect(this).toBe(data);
        return currentDelta;
      });
      const writeDelta = vi.fn(function writeDeepDelta(this: typeof data, value: typeof currentDelta) {
        expect(this).toBe(data);
        currentDelta = value;
      });
      const owner = Object.defineProperty({}, 'delta', {
        configurable: true,
        ...(kind === 'value' ? { value: currentDelta } : { get: readDelta, set: writeDelta }),
      });
      let prototype: object = owner;
      const prototypeHandler = {
        getPrototypeOf(target: object) {
          if (currentLookup) {
            currentLookup.hops += 1;
          }
          return Reflect.getPrototypeOf(target);
        },
      };
      for (let depth = 0; depth < 100; depth += 1) {
        const node = Object.setPrototypeOf({}, prototype);
        prototype = new Proxy(node, prototypeHandler);
      }
      Object.setPrototypeOf(data, prototype);
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
          if (kind === 'value') {
            Object.defineProperty(owner, 'delta', { value: replacement });
          } else {
            expect(Reflect.set(data, 'delta', replacement)).toBe(true);
          }
        }
      });
      runner.on('runStepDelta', stepDelta);

      await runner.done();

      expect(lookups.length).toBeGreaterThan(0);
      for (const { hops } of lookups) {
        expect(hops).toBeLessThanOrEqual(32);
      }
      expect(writeDelta).toHaveBeenCalledTimes(kind === 'setter' ? 1 : 0);
      expect(stepDelta).toHaveBeenCalledTimes(1);
      expect(stepDelta.mock.calls[0]?.[0]).toBe(replacement);
      expect(step.id).toBe('step_original');
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} replacement');
    },
  );

  test.each([false, true] as const)(
    'captures a depth-33 inherited getter once during projection (content getter: %s)',
    async (contentGetter) => {
      const step = runStep('step_active');
      const original = toolCallDelta(step.id).data.delta;
      const replacement = {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' second-read' } }],
        },
      };
      if (contentGetter) {
        const details = original.step_details;
        Object.defineProperty(original, 'step_details', { enumerable: true, get: () => details });
      }
      const read = vi.fn().mockReturnValueOnce(original).mockReturnValue(replacement);
      let prototype = Object.defineProperty({}, 'delta', { configurable: true, get: read });
      for (let depth = 1; depth < 33; depth += 1) {
        prototype = Object.create(prototype);
      }
      const data = Object.assign(Object.create(prototype), { id: step.id });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const emitted = vi.fn();
      runner.on('runStepDelta', emitted);

      await runner.done();

      expect(read).toHaveBeenCalledTimes(1);
      expect(emitted.mock.calls[0]?.[0]).toBe(original);
      expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
    },
  );

  test.each([
    ['envelope', 'invalid'],
    ['snapshot', 'invalid'],
    ['envelope', 'safe alias'],
    ['snapshot', 'safe alias'],
  ] as const)(
    'validates a %s mutation (%s) during projection before tool callbacks',
    async (owner, mutation) => {
      const step = runStep('step_original');
      const { step_details: details } = toolCallDelta(step.id).data.delta;
      const data = { id: step.id, delta: {} };
      const readDetails = vi.fn(() => {
        const target = owner === 'envelope' ? data : step;
        target.id = mutation === 'invalid' ? '' : 'step_safe_alias';
        return details;
      });
      Object.defineProperty(data.delta, 'step_details', { enumerable: true, get: readDetails });
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: step },
        { event: 'thread.run.step.delta', data },
        completedRun(),
      ]);
      const toolCreated = vi.fn();
      const stepDelta = vi.fn();
      runner.on('toolCallCreated', toolCreated);
      runner.on('runStepDelta', stepDelta);

      if (mutation === 'invalid') {
        await expect(runner.done()).rejects.toThrow(/invalid run-step ID/u);
        expect(toolCreated).not.toHaveBeenCalled();
        expect(stepDelta).not.toHaveBeenCalled();
        expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"}');
      } else {
        await runner.done();
        expect(toolCreated).toHaveBeenCalledTimes(1);
        expect(stepDelta).toHaveBeenCalledTimes(1);
        expect(stepDelta.mock.calls[0]?.[0]).toBe(data.delta);
        expect(step.step_details.tool_calls[0]?.function.arguments).toBe('{"to":"trusted"} updated');
      }
      expect(readDetails).toHaveBeenCalled();
    },
  );

  describe.each([
    ['SSE', publicAssistantStream],
    ['serialized stream', assistantStream],
  ] as const)('%s listener replacements', (_transport, createStream) => {
    test.each([false, true])(
      'uses toolCallDone index updates for later callbacks (mutate: %s)',
      async (mutateIndex) => {
        const step = runStep('step_original', 'call_first', 'first');
        step.step_details.tool_calls.push({
          index: 1,
          id: 'call_second',
          type: 'function',
          function: { name: 'second', arguments: 'second' },
        });
        const selectedIndex = mutateIndex ? 0 : 1;
        const deltaAt = (index: number, args: string) => ({
          event: 'thread.run.step.delta',
          data: {
            id: step.id,
            delta: {
              step_details: {
                type: 'tool_calls',
                tool_calls: [{ index, type: 'function', function: { arguments: args } }],
              },
            },
          },
        });
        const runner = createStream([
          { event: 'thread.run.step.created', data: step },
          toolCallDelta(step.id),
          deltaAt(1, ' switch'),
          deltaAt(selectedIndex, ' follow'),
          completedRun(),
        ]);
        const lifecycle: [string, string][] = [];
        const createdTools: unknown[] = [];
        const deltaTools: unknown[] = [];
        const accumulatedArgs: string[][] = [];
        let selectedSnapshot: unknown;
        runner.on('toolCallDone', (tool) => {
          lifecycle.push(['done', tool.id]);
          const event = runner.currentEvent();
          if (mutateIndex && event?.event === 'thread.run.step.delta') {
            const details = event.data.delta.step_details;
            if (details?.type === 'tool_calls' && details.tool_calls?.[0]) {
              details.tool_calls[0].index = selectedIndex;
            }
          }
          const snapshot = runner.currentRunStepSnapshot();
          if (snapshot?.step_details.type === 'tool_calls') {
            selectedSnapshot = snapshot.step_details.tool_calls[selectedIndex];
          }
        });
        runner.on('toolCallCreated', (tool) => {
          lifecycle.push(['created', tool.id]);
          createdTools.push(tool);
        });
        runner.on('toolCallDelta', (_delta, tool) => {
          lifecycle.push(['delta', tool.id]);
          deltaTools.push(tool);
        });
        runner.on('runStepDelta', (_delta, snapshot) => {
          if (snapshot.step_details.type === 'tool_calls') {
            accumulatedArgs.push(
              snapshot.step_details.tool_calls.map((tool) =>
                tool.type === 'function' ? tool.function.arguments : '',
              ),
            );
          }
        });

        await runner.done();

        expect(createdTools[1]).toBe(selectedSnapshot);
        expect(deltaTools).toEqual([selectedSnapshot]);
        const selectedID = mutateIndex ? 'call_first' : 'call_second';
        expect(lifecycle).toEqual([
          ['created', 'call_first'],
          ['done', 'call_first'],
          ['created', selectedID],
          ['delta', selectedID],
          ['done', selectedID],
        ]);
        expect(accumulatedArgs).toEqual([
          ['first updated', 'second'],
          ['first updated', 'second switch'],
          mutateIndex ? ['first updated follow', 'second switch'] : ['first updated', 'second switch follow'],
        ]);
      },
    );

    test.each([null, undefined, 0, false, 'initial'])(
      'uses a valid delta supplied by a raw listener after initial %j',
      async (initialDelta) => {
        const step = runStep('step_original');
        const runner = createStream([
          { event: 'thread.run.step.created', data: step },
          { event: 'thread.run.step.delta', data: { id: step.id, delta: initialDelta } },
          completedRun(),
        ]);
        const replacement = {
          step_details: {
            type: 'tool_calls' as const,
            tool_calls: [{ index: 0, type: 'function' as const, function: { arguments: ' replacement' } }],
          },
        };
        const stepDelta = vi.fn();
        runner.on('event', (event) => {
          if (event.event === 'thread.run.step.delta') {
            event.data.delta = replacement;
          }
        });
        runner.on('runStepDelta', stepDelta);

        await runner.done();

        expect(stepDelta).toHaveBeenCalledTimes(1);
        const [emittedDelta, snapshot] = stepDelta.mock.calls[0] ?? [];
        expect(emittedDelta).toBe(replacement);
        expect(snapshot.id).toBe(step.id);
        expect(snapshot.step_details.tool_calls[0].function.arguments).toBe('{"to":"trusted"} replacement');
      },
    );
  });
});
