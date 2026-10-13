// Bounded observations for the two optional file examples.
// oxlint-disable-next-line eslint/max-classes-per-file -- FileState and its distinguishable cleanup timeout share this owner boundary.
import { AsyncLocalStorage } from 'node:async_hooks';

// Detect only Stop calls made from this owner's approval, including awaited callbacks.
export const approvingOwner = new AsyncLocalStorage();

export async function waitForDecision(work, signal) {
  if (!signal) {
    return work();
  }
  signal.throwIfAborted();
  let onAbort;
  // oxlint-disable-next-line promise/avoid-new -- Observe approval or effect-free eligibility without taking ownership of its work.
  const interrupted = new Promise((_resolve, reject) => {
    onAbort = () => reject(new Error('File decision interrupted.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // oxlint-disable-next-line promise/prefer-await-to-then -- Observe synchronous callback failures before cancellation can reject the race.
    const deciding = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    });
    const result = await Promise.race([deciding, interrupted]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// Match the file example's three-second transport bound. The cleanup task remains owned.
export class FileCleanupIncompleteError extends Error {
  name = 'FileCleanupIncompleteError';
}
export async function waitForFileCleanup(cleanup) {
  let timer;
  // oxlint-disable-next-line promise/avoid-new -- Bound only this caller's wait, preserving the exact cleanup operation.
  const expired = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new FileCleanupIncompleteError('File cleanup incomplete.')), 3000);
  });
  try {
    return await Promise.race([cleanup, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export class FileState {
  constructor(direction) {
    this.direction = direction;
    this.current = null;
    this.cleanup = 'not_started';
    this.earlierOmitted = false;
    this.recent = [];
  }

  append(change) {
    this.recent.push(change);
    if (this.recent.length > 32) {
      this.recent.shift();
      this.earlierOmitted = true;
    }
  }

  prepare(status) {
    this.append({ phase: 'prepare', status, effect: 'none' });
  }

  transfer(status, effect, current = true) {
    if (current) {
      this.current = { status, effect };
    }
    this.append({ phase: 'transfer', status, effect });
  }

  clean(status) {
    if (this.cleanup !== status && this.cleanup !== 'completed') {
      this.cleanup = status;
      this.append({ phase: 'cleanup', status });
    }
  }

  snapshot() {
    return {
      version: 1,
      direction: this.direction,
      current: this.current && { ...this.current },
      cleanup: this.cleanup,
      earlier_omitted: this.earlierOmitted,
      recent: this.recent.map((change) => ({ ...change })),
    };
  }
}
export function browserOutcome(receipt, interrupted, cleanup) {
  const result = JSON.parse(receipt);
  if (result.completed) {
    return { version: 1, status: 'completed', effect: 'completed', cleanup };
  }
  const effect = result.attempted ? 'unknown' : 'none';
  const status = interrupted ? 'interrupted' : result.status;
  return { version: 1, status, effect, cleanup };
}
