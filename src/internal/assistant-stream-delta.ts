import { OpenAIError } from '../error';
import { hasOwn, isObj } from './utils';

const MAX_ASSISTANT_STREAM_ARRAY_GROWTH = 1024;

interface AssistantStreamArrayState {
  length: number;
  ownEntryCount: number;
}

interface AssistantStreamArrayProjection {
  baselineLength: number;
  cacheable: boolean;
  entries: Map<number, Record<string, unknown>>;
  length: number;
  ownEntryCount: number;
}

interface AssistantStreamDeltaProjection {
  arrays: Map<unknown[], AssistantStreamArrayProjection>;
  cacheArrays: boolean;
  records: WeakMap<Record<string, any>, Map<string, unknown>>;
}

const assistantStreamArrayStates = new WeakMap<unknown[], AssistantStreamArrayState>();
const externallyMutableAssistantStreamValues = new WeakSet<object>();

function createAssistantStreamDeltaProjection(cacheArrays: boolean): AssistantStreamDeltaProjection {
  return { arrays: new Map(), cacheArrays, records: new WeakMap() };
}

function commitAssistantStreamArrayProjection(projection: AssistantStreamDeltaProjection): void {
  for (const [array, projected] of projection.arrays) {
    if (projected.cacheable && !externallyMutableAssistantStreamValues.has(array)) {
      assistantStreamArrayStates.set(array, {
        length: projected.length,
        ownEntryCount: projected.ownEntryCount,
      });
    } else {
      assistantStreamArrayStates.delete(array);
    }
  }
}

function isPrimitiveAssistantStreamValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number';
}

function isPrimitiveAssistantStreamArrayDelta(accumulator: unknown[], delta: unknown[]): boolean {
  return delta.every(isPrimitiveAssistantStreamValue) && accumulator.every(isPrimitiveAssistantStreamValue);
}

function assertValidAssistantStreamDeltaIndices(
  accumulator: Record<string, any>,
  delta: Record<string, any>,
  projection: AssistantStreamDeltaProjection,
): void {
  let projectedValues = projection.records.get(accumulator);

  for (const [key, deltaValue] of Object.entries(delta)) {
    if (key === 'index' || key === 'type') {
      continue;
    }

    let accumulatedValue: unknown;

    if (projectedValues?.has(key)) {
      accumulatedValue = projectedValues.get(key);
    } else if (hasOwn(accumulator, key)) {
      accumulatedValue = accumulator[key];
    }

    if (accumulatedValue === null || accumulatedValue === undefined) {
      if (!projectedValues) {
        projectedValues = new Map();
        projection.records.set(accumulator, projectedValues);
      }

      projectedValues.set(key, deltaValue);
      continue;
    }

    if (isObj(accumulatedValue) && isObj(deltaValue)) {
      assertValidAssistantStreamDeltaIndices(accumulatedValue, deltaValue, projection);
    } else if (
      Array.isArray(accumulatedValue) &&
      Array.isArray(deltaValue) &&
      !isPrimitiveAssistantStreamArrayDelta(accumulatedValue, deltaValue)
    ) {
      assertValidAssistantStreamArrayDelta(accumulatedValue, deltaValue, 'array', projection);
    }
  }
}

function assertValidAssistantStreamArrayDelta(
  accumulator: unknown[],
  delta: unknown[],
  kind: 'content' | 'array',
  projection: AssistantStreamDeltaProjection,
): void {
  let projectedArray = projection.arrays.get(accumulator);

  if (!projectedArray) {
    const cacheable =
      projection.cacheArrays && !externallyMutableAssistantStreamValues.has(accumulator);
    const cachedState = cacheable ? assistantStreamArrayStates.get(accumulator) : undefined;
    projectedArray = {
      baselineLength: accumulator.length,
      cacheable,
      entries: new Map(),
      length: accumulator.length,
      ownEntryCount:
        cachedState?.length === accumulator.length
          ? cachedState.ownEntryCount
          : countOwnAssistantStreamArrayEntries(accumulator),
    };
    projection.arrays.set(accumulator, projectedArray);
  }

  for (const deltaEntry of delta) {
    if (!isObj(deltaEntry)) {
      throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
    }

    const index = deltaEntry['index'];

    if (kind === 'array' && index == null) {
      console.error(deltaEntry);
      throw new Error('Expected array delta entry to have an `index` property');
    }

    if (kind === 'array' && typeof index !== 'number') {
      throw new TypeError(`Expected array delta entry \`index\` property to be a number but got ${index}`);
    }

    if (
      !Number.isSafeInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= projectedArray.baselineLength + MAX_ASSISTANT_STREAM_ARRAY_GROWTH
    ) {
      throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${index}`);
    }

    const validatedIndex = index as number;
    let accumulatedEntry: unknown;

    if (projectedArray.entries.has(validatedIndex)) {
      accumulatedEntry = projectedArray.entries.get(validatedIndex);
    } else if (hasOwn(accumulator, validatedIndex)) {
      accumulatedEntry = accumulator[validatedIndex];

      if (accumulatedEntry === null || accumulatedEntry === undefined) {
        projectedArray.entries.set(validatedIndex, deltaEntry);
      }
    } else {
      projectedArray.entries.set(validatedIndex, deltaEntry);
      projectedArray.ownEntryCount += 1;
    }

    const projectedLength = Math.max(projectedArray.length, validatedIndex + 1);
    if (projectedLength - projectedArray.ownEntryCount > MAX_ASSISTANT_STREAM_ARRAY_GROWTH) {
      throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${index}`);
    }

    if (isObj(accumulatedEntry)) {
      assertValidAssistantStreamDeltaIndices(accumulatedEntry, deltaEntry, projection);
    }

    projectedArray.length = projectedLength;
  }
}

function countOwnAssistantStreamArrayEntries(accumulator: unknown[]): number {
  let count = 0;
  for (const key of Object.keys(accumulator)) {
    const index = Number(key);
    if (Number.isSafeInteger(index) && index >= 0 && index < accumulator.length && String(index) === key) {
      count += 1;
    }
  }
  return count;
}

function applyAssistantStreamDelta(
  acc: Record<string, any>,
  delta: Record<string, any>,
  cacheArrays: boolean,
): Record<string, any> {
  const externallyMutable = externallyMutableAssistantStreamValues.has(acc);

  for (const [key, deltaValue] of Object.entries(delta)) {
    if (!hasOwn(acc, key)) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      acc[key] = deltaValue;
      continue;
    }

    let accValue = acc[key];
    if (accValue === null || accValue === undefined) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      acc[key] = deltaValue;
      continue;
    }

    if (key === 'index' || key === 'type') {
      acc[key] = deltaValue;
      continue;
    }

    if (typeof accValue === 'string' && typeof deltaValue === 'string') {
      accValue += deltaValue;
    } else if (typeof accValue === 'number' && typeof deltaValue === 'number') {
      accValue += deltaValue;
    } else if (isObj(accValue) && isObj(deltaValue)) {
      accValue = applyAssistantStreamDelta(accValue, deltaValue, cacheArrays);
    } else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
      if (isPrimitiveAssistantStreamArrayDelta(accValue, deltaValue)) {
        accValue.push(...deltaValue);
        assistantStreamArrayStates.delete(accValue);
        continue;
      }

      for (const deltaEntry of deltaValue) {
        if (!isObj(deltaEntry)) {
          throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
        }

        const index = deltaEntry['index'];
        if (index == null) {
          console.error(deltaEntry);
          throw new Error('Expected array delta entry to have an `index` property');
        }

        if (typeof index !== 'number') {
          throw new TypeError(
            `Expected array delta entry \`index\` property to be a number but got ${index}`,
          );
        }

        if (hasOwn(accValue, index)) {
          const accEntry = accValue[index];
          accValue[index] =
            accEntry == null ? deltaEntry : applyAssistantStreamDelta(accEntry, deltaEntry, cacheArrays);
        } else {
          defineAssistantStreamArrayEntry(accValue, index, deltaEntry);
        }
      }
      continue;
    } else {
      throw new TypeError(
        `Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`,
      );
    }
    acc[key] = accValue;
  }

  return acc;
}

export function accumulateAssistantStreamDelta(
  acc: Record<string, any>,
  delta: Record<string, any>,
  cacheArrays = false,
): Record<string, any> {
  assertSafeAssistantStreamDelta(delta);
  const projection = createAssistantStreamDeltaProjection(cacheArrays);
  assertValidAssistantStreamDeltaIndices(acc, delta, projection);
  applyAssistantStreamDelta(acc, delta, cacheArrays);
  commitAssistantStreamArrayProjection(projection);
  return acc;
}

export function createAssistantStreamArrayDeltaCommit(
  accumulator: unknown[],
  delta: unknown[],
  kind: 'content' | 'array',
): () => void {
  assertSafeAssistantStreamDelta(delta);
  const projection = createAssistantStreamDeltaProjection(true);
  assertValidAssistantStreamArrayDelta(accumulator, delta, kind, projection);
  return () => commitAssistantStreamArrayProjection(projection);
}

export function defineAssistantStreamArrayEntry(
  accumulator: unknown[],
  index: number,
  value: unknown,
): void {
  if (externallyMutableAssistantStreamValues.has(accumulator)) {
    markAssistantStreamValueExternallyMutable(value);
  }
  Object.defineProperty(accumulator, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function markAssistantStreamValueExternallyMutable(value: unknown): void {
  if ((!isObj(value) && !Array.isArray(value)) || externallyMutableAssistantStreamValues.has(value)) {
    return;
  }

  externallyMutableAssistantStreamValues.add(value);
  if (Array.isArray(value)) {
    assistantStreamArrayStates.delete(value);
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      markAssistantStreamValueExternallyMutable(descriptor.value);
    }
  }
}

export function assertSafeAssistantStreamDelta(value: unknown): void {
  if (!isObj(value) && !Array.isArray(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
    }

    assertSafeAssistantStreamDelta(nestedValue);
  }
}
