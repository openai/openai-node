import { vi } from 'vitest';
import { OpenAIError } from 'openai/core/error';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants';

type Event = Record<string, any>;

function readableEvents(events: Event[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(events.map((event) => encoder.encode(`${JSON.stringify(event)}\n`)));
}

function assistantStream(events: Event[]): AssistantStream {
  return AssistantStream.fromReadableStream(readableEvents(events));
}

function unencodedAssistantStream(events: Event[]): AssistantStream {
  const controller = new AbortController();
  return AssistantStream.createAssistantStream(
    'thread_123',
    {
      create: vi.fn().mockResolvedValue({
        controller,
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event as AssistantStreamEvent;
          }
        },
      }),
    } as any,
    { assistant_id: 'assistant_123' },
  );
}

function completedRun() {
  return { event: 'thread.run.completed', data: { id: 'run_123', status: 'completed' } };
}

function runStep(id: string, toolID = 'call_trusted', args = '{"to":"trusted"}') {
  return {
    id,
    status: 'in_progress',
    step_details: {
      type: 'tool_calls' as const,
      tool_calls: [
        { index: 0, type: 'function' as const, id: toolID, function: { name: 'transfer', arguments: args } },
      ],
    },
  };
}

function toolCallDelta(id: string) {
  return {
    event: 'thread.run.step.delta',
    data: {
      id,
      delta: {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' updated' } }],
        },
      },
    },
  };
}

describe('AssistantStream run-step identity security', () => {
  test.each(['step_trusted', 'step_foreign'])(
    'rejects creation of %s while a trusted run step remains active',
    async (injectedID) => {
      const trusted = runStep('step_trusted');
      const injected = runStep(injectedID, 'call_injected', '{"to":"attacker"}');
      const createdEvent = { event: 'thread.run.step.created', data: trusted };
      const runner = assistantStream([
        createdEvent,
        { event: 'thread.run.step.created', data: injected },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepCreated = vi.fn();
      const toolDone = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepCreated', stepCreated);
      runner.on('toolCallDone', toolDone);

      await expect(runner.done()).rejects.toThrow(OpenAIError);

      expect(rawEvent).toHaveBeenCalledTimes(1);
      expect(rawEvent).toHaveBeenCalledWith(createdEvent);
      expect(stepCreated).toHaveBeenCalledTimes(1);
      expect(toolDone).not.toHaveBeenCalled();
      expect(runner.currentEvent()).toEqual(createdEvent);
      expect(runner.currentRunStepSnapshot()).toEqual(trusted);
      expect(runner.currentRunStepSnapshot()?.step_details).toEqual(trusted.step_details);
    },
  );

  test('rejects reuse of a completed run-step ID before exposing attacker-controlled tool arguments', async () => {
    const trusted = runStep('step_reused');
    const terminalEvent = { event: 'thread.run.step.completed', data: { ...trusted, status: 'completed' } };
    const injected = runStep('step_reused', 'call_injected', '{"to":"attacker"}');
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: trusted },
      terminalEvent,
      { event: 'thread.run.step.created', data: injected },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const stepCreated = vi.fn();
    runner.on('event', rawEvent);
    runner.on('runStepCreated', stepCreated);

    await expect(runner.done()).rejects.toThrow(/already been created/u);

    expect(rawEvent).toHaveBeenCalledTimes(2);
    expect(stepCreated).toHaveBeenCalledTimes(1);
    expect(runner.currentEvent()).toEqual(terminalEvent);
    expect(runner.currentRunStepSnapshot()).toBeUndefined();
  });

  test.each([
    'thread.run.step.delta',
    'thread.run.step.in_progress',
    'thread.run.step.completed',
    'thread.run.step.failed',
    'thread.run.step.cancelled',
    'thread.run.step.expired',
  ])('rejects a foreign %s before exposing or finalizing the trusted active tool', async (event) => {
    const trusted = runStep('step_active');
    const acceptedDelta = toolCallDelta(trusted.id);
    const injected =
      event === 'thread.run.step.delta'
        ? toolCallDelta('step_foreign').data
        : runStep('step_foreign', 'call_injected', '{"to":"attacker"}');
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: trusted },
      acceptedDelta,
      { event, data: injected },
      completedRun(),
    ]);
    const rawEvent = vi.fn();
    const toolDone = vi.fn();
    const stepDone = vi.fn();
    const stepDelta = vi.fn();
    runner.on('event', rawEvent);
    runner.on('toolCallDone', toolDone);
    runner.on('runStepDone', stepDone);
    runner.on('runStepDelta', stepDelta);

    await expect(runner.done()).rejects.toThrow(/does not match the active run step/u);

    expect(rawEvent).toHaveBeenCalledTimes(2);
    expect(stepDelta).toHaveBeenCalledTimes(1);
    expect(toolDone).not.toHaveBeenCalled();
    expect(stepDone).not.toHaveBeenCalled();
    expect(runner.currentEvent()).toEqual(acceptedDelta);
    expect(runner.currentRunStepSnapshot()?.id).toBe(trusted.id);
    expect(runner.currentRunStepSnapshot()?.step_details.type).toBe('tool_calls');
  });

  test.each(['', null, 123])(
    'rejects the invalid run-step ID %j before exposing its creation',
    async (id) => {
      const runner = assistantStream([
        { event: 'thread.run.step.created', data: { ...runStep('unused'), id } },
        completedRun(),
      ]);
      const rawEvent = vi.fn();
      const stepCreated = vi.fn();
      runner.on('event', rawEvent);
      runner.on('runStepCreated', stepCreated);

      await expect(runner.done()).rejects.toThrow(/invalid run-step ID/u);

      expect(rawEvent).not.toHaveBeenCalled();
      expect(stepCreated).not.toHaveBeenCalled();
      expect(runner.currentEvent()).toBeUndefined();
      expect(runner.currentRunStepSnapshot()).toBeUndefined();
    },
  );

  test.each(['inherited', 'accessor'] as const)(
    'rejects an %s run-step ID without invoking an attacker-controlled getter',
    async (kind) => {
      const readID = vi.fn(() => 'step_injected');
      const data: Event =
        kind === 'inherited'
          ? Object.assign(Object.create(Object.defineProperty({}, 'id', { get: readID })) as Event, {
              status: 'in_progress',
              step_details: { type: 'tool_calls', tool_calls: [] },
            })
          : { status: 'in_progress', step_details: { type: 'tool_calls', tool_calls: [] } };
      if (kind === 'accessor') {
        Object.defineProperty(data, 'id', { enumerable: true, get: readID });
      }
      const runner = unencodedAssistantStream([{ event: 'thread.run.step.created', data }, completedRun()]);
      const rawEvent = vi.fn();
      runner.on('event', rawEvent);

      await expect(runner.done()).rejects.toThrow(/invalid run-step ID/u);

      expect(rawEvent).not.toHaveBeenCalled();
      expect(readID).not.toHaveBeenCalled();
      expect(runner.currentRunStepSnapshot()).toBeUndefined();
    },
  );

  test.each(['event', 'runStepCreated'] as const)(
    'preserves the canonical active run-step ID when a %s listener mutates it',
    async (listener) => {
      const initial = runStep('step_canonical');
      const alias = runStep('step_listener_alias', 'call_alias');
      const runner = unencodedAssistantStream([
        { event: 'thread.run.step.created', data: initial },
        toolCallDelta('step_canonical'),
        { event: 'thread.run.step.completed', data: { ...runStep('step_canonical'), status: 'completed' } },
        { event: 'thread.run.step.created', data: alias },
        completedRun(),
      ]);
      const created = vi.fn();
      runner.on('event', (event) => {
        if (
          listener === 'event' &&
          event.event === 'thread.run.step.created' &&
          Object.is(event.data, initial)
        ) {
          initial.id = alias.id;
        }
      });
      runner.on('runStepCreated', (step) => {
        created(step);
        if (listener === 'runStepCreated' && Object.is(step, initial)) {
          initial.id = alias.id;
        }
      });

      await expect(runner.done()).rejects.toThrow(/already been created/u);

      expect(created).toHaveBeenCalledTimes(1);
      expect(initial.id).toBe(alias.id);
    },
  );

  test('normalizes an inconsistent proxy-backed run-step ID before exposing or retaining it', async () => {
    const readID = vi.fn(() => 'step_proxy_alias');
    const source = runStep('step_proxy_canonical');
    const first = new Proxy(source, {
      get(target, property, receiver) {
        return property === 'id' ? readID() : Reflect.get(target, property, receiver);
      },
    });
    const second = runStep('step_proxy_alias', 'call_second');
    const runner = unencodedAssistantStream([
      { event: 'thread.run.step.created', data: first },
      {
        event: 'thread.run.step.completed',
        data: { ...runStep('step_proxy_canonical'), status: 'completed' },
      },
      { event: 'thread.run.step.created', data: second },
      { event: 'thread.run.step.completed', data: { ...second, status: 'completed' } },
      completedRun(),
    ]);
    const rawIDs: string[] = [];
    const createdIDs: string[] = [];
    runner.on('event', (event) => {
      if (event.event === 'thread.run.step.created') {
        rawIDs.push(event.data.id);
      }
    });
    runner.on('runStepCreated', (step) => createdIDs.push(step.id));

    await expect(runner.done()).resolves.toBeUndefined();

    expect(rawIDs).toEqual(['step_proxy_canonical', 'step_proxy_alias']);
    expect(createdIDs).toEqual(['step_proxy_canonical', 'step_proxy_alias']);
    expect(readID).toHaveBeenCalledTimes(1);
  });

  test.each([
    'thread.run.step.completed',
    'thread.run.step.failed',
    'thread.run.step.cancelled',
    'thread.run.step.expired',
  ])('preserves a standalone %s terminal event with no prior creation', async (event) => {
    const step = runStep('step_standalone');
    const runner = assistantStream([{ event, data: step }, completedRun()]);
    const stepDone = vi.fn();
    runner.on('runStepDone', stepDone);

    await expect(runner.finalRunSteps()).resolves.toEqual([step]);

    expect(stepDone).toHaveBeenCalledTimes(1);
  });

  test('preserves a standalone in-progress step before its first delta', async () => {
    const step = runStep('step_in_progress');
    const runner = assistantStream([
      { event: 'thread.run.step.in_progress', data: step },
      toolCallDelta(step.id),
      { event: 'thread.run.step.completed', data: { ...step, status: 'completed' } },
      completedRun(),
    ]);

    await expect(runner.done()).resolves.toBeUndefined();
    await expect(runner.finalRunSteps()).resolves.toHaveLength(1);
  });

  test.each(['__proto__', 'constructor', 'toString'])(
    'preserves legitimate reserved run-step ID %s and its delta lifecycle',
    async (id) => {
      const step = runStep(id);
      const runner = assistantStream([
        { event: 'thread.run.step.created', data: step },
        toolCallDelta(id),
        { event: 'thread.run.step.completed', data: { ...step, status: 'completed' } },
        completedRun(),
      ]);

      await expect(runner.finalRunSteps()).resolves.toHaveLength(1);
    },
  );

  test('preserves the existing delta-before-creation error without exposing its raw event', async () => {
    const runner = assistantStream([toolCallDelta('step_missing'), completedRun()]);
    const rawEvent = vi.fn();
    runner.on('event', rawEvent);

    await expect(runner.done()).rejects.toThrow('Received a RunStepDelta before creation of a snapshot');

    expect(rawEvent).not.toHaveBeenCalled();
  });

  test('continues to finish a trusted active tool call when the run reaches its terminal state', async () => {
    const step = runStep('step_active_until_run_end');
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: step },
      toolCallDelta(step.id),
      completedRun(),
    ]);
    const doneCalls: string[] = [];
    runner.on('toolCallDone', (toolCall) => doneCalls.push(toolCall.id));

    await expect(runner.done()).resolves.toBeUndefined();

    expect(doneCalls).toEqual(['call_trusted']);
  });

  test.each([
    { name: 'a first delta', event: 'thread.run.step.delta', prime: false },
    { name: 'a later delta', event: 'thread.run.step.delta', prime: true },
    { name: 'a terminal event', event: 'thread.run.step.completed', prime: true },
  ])(
    'revalidates a listener-mutated active snapshot before tool callbacks for $name',
    async ({ event, prime }) => {
      const completed = runStep('step_completed', 'call_completed');
      const active = runStep('step_active', 'call_active');
      const terminalCompleted = {
        event: 'thread.run.step.completed',
        data: { ...completed, status: 'completed' },
      };
      const attackedEvent =
        event === 'thread.run.step.delta'
          ? toolCallDelta(active.id)
          : {
              event,
              data: { ...runStep(active.id, 'call_injected', '{"to":"attacker"}'), status: 'completed' },
            };
      const runner = assistantStream([
        { event: 'thread.run.step.created', data: completed },
        terminalCompleted,
        { event: 'thread.run.step.created', data: active },
        ...(prime ? [toolCallDelta(active.id)] : []),
        attackedEvent,
        completedRun(),
      ]);
      const toolCreated = vi.fn();
      const toolDelta = vi.fn();
      const stepDelta = vi.fn();
      const toolDone = vi.fn();
      const stepDone = vi.fn();
      let remainingPrimedEvents = prime && event === 'thread.run.step.delta' ? 1 : 0;

      runner.on('toolCallCreated', toolCreated);
      runner.on('toolCallDelta', toolDelta);
      runner.on('runStepDelta', stepDelta);
      runner.on('toolCallDone', toolDone);
      runner.on('runStepDone', stepDone);
      runner.on('event', (received) => {
        if (received.event !== event || !('id' in received.data) || received.data.id !== active.id) {
          return;
        }
        if (remainingPrimedEvents > 0) {
          remainingPrimedEvents -= 1;
          return;
        }

        toolCreated.mockClear();
        toolDelta.mockClear();
        stepDelta.mockClear();
        toolDone.mockClear();
        stepDone.mockClear();

        const retained = runner.currentRunStepSnapshot();
        if (retained) {
          retained.id = completed.id;
        }
      });

      await expect(runner.done()).rejects.toThrow(/already been created/u);

      expect(toolCreated).not.toHaveBeenCalled();
      expect(toolDelta).not.toHaveBeenCalled();
      expect(stepDelta).not.toHaveBeenCalled();
      expect(toolDone).not.toHaveBeenCalled();
      expect(stepDone).not.toHaveBeenCalled();
    },
  );
});
