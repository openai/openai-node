export function measureElementMovement<T>(operation: () => T) {
  const originalShift = Array.prototype.shift;
  const originalSplice = Array.prototype.splice;
  const originalSlice = Array.prototype.slice;
  let elementMoves = 0;

  function trackedShift(this: unknown[]) {
    elementMoves += this.length;
    return originalShift.call(this);
  }

  function trackedSplice(this: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
    // Count both the returned elements and the tail moved by front deletion.
    if (start === 0) {
      elementMoves += this.length;
    }
    if (deleteCount === undefined) {
      // oxlint-disable-next-line anti-slop/no-reflect-apply -- Preserve native splice's one-argument overload and omitted deleteCount in this instrumentation.
      return Reflect.apply(originalSplice, this, [start]);
    }
    return originalSplice.call(this, start, deleteCount, ...items);
  }

  function trackedSlice(this: unknown[], start?: number, end?: number) {
    const result = originalSlice.call(this, start, end);
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'shift', trackedShift);
  Reflect.set(Array.prototype, 'splice', trackedSplice);
  Reflect.set(Array.prototype, 'slice', trackedSlice);
  try {
    // All measured calls run synchronously; restore before awaiting promises or assertions.
    const result = operation();
    return { result, elementMoves };
  } finally {
    Reflect.set(Array.prototype, 'slice', originalSlice);
    Reflect.set(Array.prototype, 'splice', originalSplice);
    Reflect.set(Array.prototype, 'shift', originalShift);
  }
}
