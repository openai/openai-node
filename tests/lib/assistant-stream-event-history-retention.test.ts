import { Session } from 'node:inspector/promises';
import { setImmediate } from 'node:timers/promises';

import { assistantStream, completedRun } from './assistant-stream-test-utils';

interface WeakReference {
  deref: () => object | undefined;
}

const WeakReference = (globalThis as typeof globalThis & { WeakRef: new (target: object) => WeakReference })
  .WeakRef;

const SYNTHETIC_CREDENTIAL = 'sk-synthetic-assistant-history-secret-74f1';
const SYNTHETIC_PATIENT = 'synthetic-patient-history-123-45-6789';

async function collectGarbage(): Promise<void> {
  await setImmediate();

  const session = new Session();
  session.connect();

  try {
    await session.post('HeapProfiler.collectGarbage');
  } finally {
    session.disconnect();
  }
}

describe('AssistantStream consumed-event retention', () => {
  test.each([
    { mode: 'event callbacks', iterate: false },
    { mode: 'drained async iterators', iterate: true },
  ])('releases sensitive raw thread events after $mode finish', async ({ iterate }) => {
    const observedEventTypes: string[] = [];
    let observedCredential: string | undefined;
    let observedPatient: string | undefined;
    let previousEvent: WeakReference | undefined;

    const stream = assistantStream([
      {
        event: 'thread.created',
        data: {
          id: 'thread_sensitive_history',
          object: 'thread',
          created_at: 0,
          metadata: {
            credential: SYNTHETIC_CREDENTIAL,
            patient: SYNTHETIC_PATIENT,
          },
        },
      },
      completedRun('run_sensitive_history'),
    ]);

    stream.on('event', (event) => {
      observedEventTypes.push(event.event);

      if (event.event === 'thread.created') {
        previousEvent = new WeakReference(event);
        observedCredential = event.data.metadata?.['credential'];
        observedPatient = event.data.metadata?.['patient'];
      }
    });

    if (iterate) {
      const iteratedEventTypes: string[] = [];

      for await (const event of stream) {
        iteratedEventTypes.push(event.event);
      }

      expect(iteratedEventTypes).toEqual(['thread.created', 'thread.run.completed']);
    }

    await stream.done();

    expect(observedEventTypes).toEqual(['thread.created', 'thread.run.completed']);
    expect(observedCredential).toBe(SYNTHETIC_CREDENTIAL);
    expect(observedPatient).toBe(SYNTHETIC_PATIENT);
    expect(previousEvent).toBeDefined();

    await collectGarbage();

    expect(previousEvent?.deref()).toBeUndefined();

    // Keep the runner alive across collection and preserve its public snapshots.
    expect(stream.currentEvent()?.event).toBe('thread.run.completed');
    const finalRun = await stream.finalRun();
    expect(finalRun.id).toBe('run_sensitive_history');
    expect(await stream.finalMessages()).toEqual([]);
    expect(await stream.finalRunSteps()).toEqual([]);
  });

  test('does not retain a growing history of consumed raw thread events', async () => {
    const eventCount = 256;
    const previousEvents: WeakReference[] = [];

    const stream = assistantStream([
      ...Array.from({ length: eventCount }, (_, index) => ({
        event: 'thread.created',
        data: {
          id: `thread_history_${index}`,
          object: 'thread',
          created_at: index,
          metadata: { credential: SYNTHETIC_CREDENTIAL },
        },
      })),
      completedRun('run_large_history'),
    ]);

    stream.on('event', (event) => {
      if (event.event === 'thread.created') {
        previousEvents.push(new WeakReference(event));
      }
    });

    await stream.done();

    expect(previousEvents).toHaveLength(eventCount);

    await collectGarbage();

    expect(previousEvents.every((event) => event.deref() === undefined)).toBe(true);

    // A still-live runner must retain its latest event, but never earlier raw events.
    expect(stream.currentEvent()?.event).toBe('thread.run.completed');
    const finalRun = await stream.finalRun();
    expect(finalRun.id).toBe('run_large_history');
  });
});
