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

  describe.each([
    ['SSE', publicAssistantStream],
    ['serialized stream', assistantStream],
  ] as const)('%s listener replacements', (_transport, createStream) => {
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
