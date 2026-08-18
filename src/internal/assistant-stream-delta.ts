import { OpenAIError } from '../error';
import { hasOwn, isObj } from './utils';

const MAX_ASSISTANT_STREAM_ARRAY_GROWTH = 1024;
const MAX_EXTERNALLY_MUTABLE_ASSISTANT_STREAM_ARRAY_LENGTH = 65_536;

type AssistantStreamRecord = Record<string, unknown>;

function getAssistantStreamDiagnosticProperty(property: string): string {
  switch (property) {
    case 'value':
    case 'arguments':
    case 'input':
    case 'text':
    case 'content':
    case 'annotations':
    case 'metadata':
    case 'name':
    case 'role':
    case 'status':
    case 'tool_calls':
    case 'step_details': {
      return property;
    }
    default: {
      return 'unknown';
    }
  }
}

interface AssistantStreamArrayState {
  length: number;
  ownEntryCount: number;
}

interface AssistantStreamArrayProjection {
  baselineLength: number;
  cacheable: boolean;
  enforceSparseHoleBudget: boolean;
  entries: Map<number, AssistantStreamRecord>;
  length: number;
  ownEntryCount: number;
}

interface AssistantStreamDeltaProjection {
  arrays: Map<unknown[], AssistantStreamArrayProjection>;
  cacheArrays: boolean;
  records: WeakMap<AssistantStreamRecord, Map<string, unknown>>;
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

function getAssistantStreamArrayOwnEntryCount(
  accumulator: unknown[],
  enforceSparseHoleBudget: boolean,
  cachedState: AssistantStreamArrayState | undefined,
): number {
  if (!enforceSparseHoleBudget) {
    return 0;
  }
  if (cachedState?.length === accumulator.length) {
    return cachedState.ownEntryCount;
  }
  return countOwnAssistantStreamArrayEntries(accumulator);
}

function getAssistantStreamDeltaIndex(
  deltaEntry: AssistantStreamRecord,
  kind: 'content' | 'array',
  baselineLength: number,
): number {
  const { index } = deltaEntry;

  if (kind === 'array' && (index === null || index === undefined)) {
    throw new Error('Expected array delta entry to have an `index` property');
  }

  if (kind === 'array' && typeof index !== 'number') {
    throw new TypeError(
      'Expected array delta entry `index` property to be a number but got an invalid value',
    );
  }

  if (
    !Number.isSafeInteger(index) ||
    (index as number) < 0 ||
    (index as number) >= baselineLength + MAX_ASSISTANT_STREAM_ARRAY_GROWTH ||
    (index as number) >= MAX_EXTERNALLY_MUTABLE_ASSISTANT_STREAM_ARRAY_LENGTH
  ) {
    const safeIndex = typeof index === 'number' ? index : 'unknown';
    throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${safeIndex}`);
  }

  return index as number;
}

type ValidateAssistantStreamRecord = (
  accumulator: AssistantStreamRecord,
  delta: AssistantStreamRecord,
  projection: AssistantStreamDeltaProjection,
) => void;

function assertValidAssistantStreamArrayDelta(
  accumulator: unknown[],
  delta: unknown[],
  kind: 'content' | 'array',
  projection: AssistantStreamDeltaProjection,
  validateRecord: ValidateAssistantStreamRecord,
): void {
  let projectedArray = projection.arrays.get(accumulator);

  if (!projectedArray) {
    const enforceSparseHoleBudget =
      projection.cacheArrays && !externallyMutableAssistantStreamValues.has(accumulator);
    const cachedState = enforceSparseHoleBudget ? assistantStreamArrayStates.get(accumulator) : undefined;
    projectedArray = {
      baselineLength: accumulator.length,
      cacheable: enforceSparseHoleBudget,
      enforceSparseHoleBudget,
      entries: new Map(),
      length: accumulator.length,
      ownEntryCount: getAssistantStreamArrayOwnEntryCount(accumulator, enforceSparseHoleBudget, cachedState),
    };
    projection.arrays.set(accumulator, projectedArray);
  }

  for (const deltaEntry of delta) {
    if (!isObj(deltaEntry)) {
      throw new Error('Expected array delta entry to be an object but got an invalid value');
    }

    const validatedIndex = getAssistantStreamDeltaIndex(deltaEntry, kind, projectedArray.baselineLength);
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
    if (
      projectedArray.enforceSparseHoleBudget &&
      projectedLength - projectedArray.ownEntryCount > MAX_ASSISTANT_STREAM_ARRAY_GROWTH
    ) {
      throw new OpenAIError(`Assistant stream delta contains an invalid ${kind} index: ${validatedIndex}`);
    }

    if (isObj(accumulatedEntry)) {
      validateRecord(accumulatedEntry, deltaEntry, projection);
    }

    projectedArray.length = projectedLength;
  }
}

function assertValidAssistantStreamDeltaIndices(
  accumulator: AssistantStreamRecord,
  delta: AssistantStreamRecord,
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
      assertValidAssistantStreamArrayDelta(
        accumulatedValue,
        deltaValue,
        'array',
        projection,
        assertValidAssistantStreamDeltaIndices,
      );
    }
  }
}

export function isAssistantStreamValueExternallyMutable(value: unknown): boolean {
  return (isObj(value) || Array.isArray(value)) && externallyMutableAssistantStreamValues.has(value);
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

export function defineAssistantStreamArrayEntry(accumulator: unknown[], index: number, value: unknown): void {
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

function getRequiredAssistantStreamArrayIndex(deltaEntry: AssistantStreamRecord): number {
  const { index } = deltaEntry;
  if (index === null || index === undefined) {
    throw new Error('Expected array delta entry to have an `index` property');
  }
  if (typeof index !== 'number') {
    throw new TypeError(
      'Expected array delta entry `index` property to be a number but got an invalid value',
    );
  }
  return index;
}

type ApplyAssistantStreamRecord = (
  accumulator: AssistantStreamRecord,
  delta: AssistantStreamRecord,
) => AssistantStreamRecord;

function applyAssistantStreamArrayDelta(
  accumulator: unknown[],
  delta: unknown[],
  applyRecord: ApplyAssistantStreamRecord,
): void {
  if (isPrimitiveAssistantStreamArrayDelta(accumulator, delta)) {
    accumulator.push(...delta);
    assistantStreamArrayStates.delete(accumulator);
    return;
  }

  for (const deltaEntry of delta) {
    if (!isObj(deltaEntry)) {
      throw new Error('Expected array delta entry to be an object but got an invalid value');
    }

    const index = getRequiredAssistantStreamArrayIndex(deltaEntry);
    if (hasOwn(accumulator, index)) {
      const accumulatedEntry = accumulator[index];
      if (accumulatedEntry === null || accumulatedEntry === undefined) {
        if (externallyMutableAssistantStreamValues.has(accumulator)) {
          markAssistantStreamValueExternallyMutable(deltaEntry);
        }
        accumulator[index] = deltaEntry;
      } else {
        accumulator[index] = applyRecord(accumulatedEntry as AssistantStreamRecord, deltaEntry);
      }
    } else {
      defineAssistantStreamArrayEntry(accumulator, index, deltaEntry);
    }
  }
}

function applyAssistantStreamDelta(
  accumulator: AssistantStreamRecord,
  delta: AssistantStreamRecord,
): AssistantStreamRecord {
  const externallyMutable = externallyMutableAssistantStreamValues.has(accumulator);

  for (const [key, deltaValue] of Object.entries(delta)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
    }

    if (!hasOwn(accumulator, key)) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      accumulator[key] = deltaValue;
      continue;
    }

    let accumulatedValue = accumulator[key];
    if (accumulatedValue === null || accumulatedValue === undefined) {
      if (externallyMutable) {
        markAssistantStreamValueExternallyMutable(deltaValue);
      }
      accumulator[key] = deltaValue;
      continue;
    }

    if (key === 'index' || key === 'type') {
      accumulator[key] = deltaValue;
      continue;
    }

    if (typeof accumulatedValue === 'string' && typeof deltaValue === 'string') {
      accumulatedValue += deltaValue;
    } else if (typeof accumulatedValue === 'number' && typeof deltaValue === 'number') {
      accumulatedValue += deltaValue;
    } else if (isObj(accumulatedValue) && isObj(deltaValue)) {
      accumulatedValue = applyAssistantStreamDelta(accumulatedValue, deltaValue);
    } else if (Array.isArray(accumulatedValue) && Array.isArray(deltaValue)) {
      applyAssistantStreamArrayDelta(accumulatedValue, deltaValue, applyAssistantStreamDelta);
      continue;
    } else {
      throw new TypeError(`Unhandled record type: ${getAssistantStreamDiagnosticProperty(key)}`);
    }
    accumulator[key] = accumulatedValue;
  }

  return accumulator;
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

export function accumulateAssistantStreamDelta<Accumulator extends object>(
  accumulator: Accumulator,
  delta: object,
  cacheArrays = false,
): Accumulator {
  assertSafeAssistantStreamDelta(delta);
  const accumulatorRecord = accumulator as AssistantStreamRecord;
  const deltaRecord = delta as AssistantStreamRecord;
  const projection = createAssistantStreamDeltaProjection(
    cacheArrays && !isAssistantStreamValueExternallyMutable(accumulator),
  );
  assertValidAssistantStreamDeltaIndices(accumulatorRecord, deltaRecord, projection);
  applyAssistantStreamDelta(accumulatorRecord, deltaRecord);
  commitAssistantStreamArrayProjection(projection);
  return accumulator;
}

export function createAssistantStreamArrayDeltaCommit(
  accumulator: unknown[],
  delta: unknown[],
  kind: 'content' | 'array',
  cacheArrays = true,
): () => void {
  assertSafeAssistantStreamDelta(delta);
  const projection = createAssistantStreamDeltaProjection(
    cacheArrays && !isAssistantStreamValueExternallyMutable(accumulator),
  );
  assertValidAssistantStreamArrayDelta(
    accumulator,
    delta,
    kind,
    projection,
    assertValidAssistantStreamDeltaIndices,
  );
  return () => commitAssistantStreamArrayProjection(projection);
}
