import { CancelReadableStream } from './shims';

interface BodyReference {
  deref: () => object | undefined;
}

interface CloneGroup {
  leaves: Set<BodyReference>;
  unverified: boolean;
}

interface CloneLeaf {
  group: CloneGroup;
  reference: BodyReference;
}

// Keep source navigation compatible with ES2020 libs and runtimes that omit WeakRef.
const NativeWeakRef = (globalThis as typeof globalThis & { WeakRef?: new (target: object) => BodyReference })
  .WeakRef;
const getReader = globalThis.ReadableStream?.prototype.getReader;
const releaseReader = globalThis.ReadableStreamDefaultReader?.prototype.releaseLock;
const readerClosed = globalThis.ReadableStreamDefaultReader
  ? Object.getOwnPropertyDescriptor(globalThis.ReadableStreamDefaultReader.prototype, 'closed')?.get
  : undefined;
const sharedBodies = new WeakMap<object, CloneLeaf | null>();

/** Records the two branches created by a verified native response clone. */
export const recordResponseTee = (original: object | undefined, source: object, copy: object): void => {
  if (!NativeWeakRef) {
    sharedBodies.set(source, null);
    sharedBodies.set(copy, null);
    return;
  }
  const previous = original ? sharedBodies.get(original) : undefined;
  const group = previous?.group ?? { leaves: new Set<BodyReference>(), unverified: false };
  if (previous) {
    group.leaves.delete(previous.reference);
  }
  if (original) {
    sharedBodies.delete(original);
  }
  for (const body of [source, copy]) {
    const reference = new NativeWeakRef(body);
    group.leaves.add(reference);
    sharedBodies.set(body, { group, reference });
  }
};

const bodyIsClosed = async (body: object): Promise<boolean> => {
  if (!getReader || !releaseReader || !readerClosed) {
    return false;
  }
  try {
    const reader = Reflect.apply(getReader, body, []);
    let closed: Promise<unknown>;
    try {
      closed = Reflect.apply(readerClosed, reader, []);
    } finally {
      // Capture the old promise first: release rejects it only when the stream is still open.
      // No bytes are read, and no lock is held across an asynchronous boundary.
      Reflect.apply(releaseReader, reader, []);
    }
    return await closed.then(
      () => true,
      () => false,
    );
  } catch {
    // A locked or unrecognized sibling cannot be proven released without disturbing its reader.
    return false;
  }
};

const hasRetainedSibling = async (body: object): Promise<boolean> => {
  const leaf = sharedBodies.get(body);
  if (leaf === undefined) {
    return false;
  }
  if (leaf === null) {
    return true;
  }
  const { group } = leaf;
  const retained = await Promise.all(
    [...group.leaves].map(async (reference) => {
      const sibling = reference.deref();
      if (!sibling) {
        // Collection alone does not prove the branch's cancellation completed.
        group.unverified = true;
        group.leaves.delete(reference);
        return true;
      }
      if (sibling === body) {
        return false;
      }
      if (!(await bodyIsClosed(sibling))) {
        return true;
      }
      group.leaves.delete(reference);
      sharedBodies.delete(sibling);
      return false;
    }),
  );
  return group.unverified || retained.some(Boolean);
};

const handleDetachedCancellation = async (cancelled: Promise<void>): Promise<void> => {
  try {
    await cancelled;
  } catch {
    // A retained sibling requires detaching cleanup, including its eventual rejection.
  }
};

/** Awaits transport cleanup unless a retained or unverifiable tee sibling could block it. */
export const cancelResponseForRetry = async (response: Response): Promise<void> => {
  const { body } = response;
  const cancelled = CancelReadableStream(body);
  if (body && sharedBodies.has(body)) {
    // Handle immediate rejection while checking siblings; awaiting the original still propagates it.
    void handleDetachedCancellation(cancelled);
    if (await hasRetainedSibling(body)) {
      return;
    }
  }
  await cancelled;
};
