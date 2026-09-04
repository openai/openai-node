/* oxlint-disable max-classes-per-file -- One shared regression matrix exercises three public emitter implementations. */
import { InternalEventEmitter } from 'openai/core/EventEmitter';
import { EventEmitter } from 'openai/lib/EventEmitter';
import type { EventParameters } from 'openai/lib/EventEmitter';
import { EventStream } from 'openai/lib/EventStream';
import { compareType } from '../utils/typing';

interface Value {
  text: string;
}
// oxlint-disable-next-line typescript/consistent-type-definitions -- The emitter's Record constraint requires a closed event-map type.
type Events = {
  connect: () => void;
  error: (error: Error) => void;
  abort: (error: Error) => void;
  end: () => void;
  empty: () => void;
  single: (value: Value) => void;
  pair: (value: Value, count: number) => void;
  optional: (value?: Value) => void;
  optionalPair: (value: Value, count?: number) => void;
  optionalBoth: (value?: Value, count?: number) => void;
  rest: (...values: Value[]) => void;
  requiredRest: (value: Value, ...counts: number[]) => void;
  leadingRest: (...values: [...string[], number]) => void;
  requiredPairRest: (value: Value, count: number, ...flags: boolean[]) => void;
};

class CoreEmitter extends InternalEventEmitter<Events> {
  override _emit<Event extends keyof Events>(event: Event, ...args: EventParameters<Events, Event>) {
    super._emit(event, ...args);
  }
}

// oxlint-disable-next-line unicorn/prefer-event-target -- This fixture tests the SDK's public EventEmitter contract.
class LibraryEmitter extends EventEmitter<Events> {
  override _emit<Event extends keyof Events>(event: Event, ...args: EventParameters<Events, Event>) {
    super._emit(event, ...args);
  }
}

class StreamEmitter extends EventStream<Events> {
  override _emit<Event extends keyof Events>(event: Event, ...args: EventParameters<Events, Event>) {
    return super._emit(event, ...args);
  }
}

describe.each([
  { name: 'core emitter', create: () => new CoreEmitter() },
  { name: 'library emitter', create: () => new LibraryEmitter() },
  { name: 'event stream', create: () => new StreamEmitter() },
])('$name emitted result types', ({ create }) => {
  test('preserves fixed zero-, one-, and multi-argument results', async () => {
    const emitter = create();
    const empty = emitter.emitted('empty');
    const single = emitter.emitted('single');
    const pair = emitter.emitted('pair');
    const value = { text: 'hello' };

    compareType<typeof empty, Promise<void>>(true);
    compareType<typeof single, Promise<Value>>(true);
    compareType<typeof pair, Promise<[Value, number]>>(true);
    emitter._emit('empty');
    emitter._emit('single', value);
    emitter._emit('pair', value, 2);

    await expect(empty).resolves.toBeUndefined();
    await expect(single).resolves.toBe(value);
    await expect(pair).resolves.toEqual([value, 2]);
  });

  test('preserves the existing unknown result for a union of event names', async () => {
    const emitter = create();
    const event: 'single' | 'pair' = 'single' as 'single' | 'pair';
    const pending = emitter.emitted(event);
    compareType<typeof pending, Promise<unknown>>(true);
    const value = { text: 'hello' };
    emitter._emit('single', value);
    await expect(pending).resolves.toBe(value);
  });

  test.each([undefined, { text: 'hello' }])('unwraps a sole optional argument: %p', async (value) => {
    const emitter = create();
    const pending = emitter.emitted('optional');

    compareType<typeof pending, Promise<Value | undefined>>(true);
    if (value === undefined) {
      emitter._emit('optional');
    } else {
      emitter._emit('optional', value);
    }
    await expect(pending).resolves.toBe(value);
  });

  test('includes both scalar and tuple results for an optional second argument', async () => {
    const emitter = create();
    const value = { text: 'hello' };
    const single = emitter.emitted('optionalPair');
    compareType<typeof single, Promise<Value | [value: Value, count?: number | undefined]>>(true);
    emitter._emit('optionalPair', value);
    await expect(single).resolves.toBe(value);

    const pair = emitter.emitted('optionalPair');
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined emits two arguments; omission emits one.
    emitter._emit('optionalPair', value, undefined);
    await expect(pair).resolves.toEqual([value, undefined]);

    const empty = emitter.emitted('optionalBoth');
    compareType<
      typeof empty,
      Promise<Value | undefined | [value?: Value | undefined, count?: number | undefined]>
    >(true);
    emitter._emit('optionalBoth');
    await expect(empty).resolves.toBeUndefined();
  });

  test.each([0, 1, 2])('handles %s values for rest-only events', async (count) => {
    const emitter = create();
    const value = { text: 'hello' };
    const args = Array.from({ length: count }, () => value);
    const pending = emitter.emitted('rest');
    compareType<typeof pending, Promise<Value | Value[] | undefined>>(true);
    emitter._emit('rest', ...args);
    await expect(pending).resolves.toEqual(args.length > 1 ? args : args[0]);
  });

  test('retains required prefixes, suffixes, and multi-argument rest tuples', async () => {
    const emitter = create();
    const value = { text: 'hello' };
    const prefix = emitter.emitted('requiredRest');
    const suffix = emitter.emitted('leadingRest');
    const pair = emitter.emitted('requiredPairRest');

    compareType<typeof prefix, Promise<Value | [Value, ...number[]]>>(true);
    compareType<typeof suffix, Promise<number | [...string[], number]>>(true);
    compareType<typeof pair, Promise<[Value, number, ...boolean[]]>>(true);
    emitter._emit('requiredRest', value);
    emitter._emit('leadingRest', 3);
    emitter._emit('requiredPairRest', value, 3, true);

    await expect(prefix).resolves.toBe(value);
    await expect(suffix).resolves.toBe(3);
    await expect(pair).resolves.toEqual([value, 3, true]);
  });
});
