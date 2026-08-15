import type { ReadableStream } from './shim-types';
import { ReadableStreamToAsyncIterable } from './shims';
import type { BlobPart, StreamingFileInput } from './uploads';

/** A captured multipart source and its cleanup when encoding stops before consumption. */
export type MultipartDataSnapshot = Readonly<{
  /** Source chunks captured before later multipart fields can replace their methods. */
  data: StreamingFileInput;

  /** Releases an unused iterator or readable-stream reader after cancellation or failure. */
  dispose?: (() => void) | undefined;
}>;

const replayMultipartSnapshot = Symbol('replayMultipartSnapshot');

type ReplayableMultipartDataSnapshot = MultipartDataSnapshot & {
  readonly [replayMultipartSnapshot]: () => MultipartDataSnapshot;
};

async function ignoreCleanupResult(cleanup: () => unknown): Promise<void> {
  try {
    await cleanup();
  } catch {
    // Cleanup failures must not mask the primary multipart result.
  }
}

function snapshotIteratorReturn(iterator: AsyncIterator<BlobPart>): AsyncIterator<BlobPart>['return'] {
  try {
    let prototype: object | null = iterator;
    while (prototype !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'return');
      if (descriptor) {
        const returnIterator = Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'];
        return returnIterator
          ? (...args: [] | [unknown]) => Reflect.apply(returnIterator, iterator, args)
          : undefined;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
  } catch (error) {
    return () => {
      throw error;
    };
  }

  let captured:
    | Readonly<{ returnIterator: AsyncIterator<BlobPart>['return'] }>
    | Readonly<{ error: unknown }>
    | undefined;
  return (...args: [] | [unknown]) => {
    if (!captured) {
      try {
        captured = { returnIterator: Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'] };
      } catch (error) {
        captured = { error };
      }
    }
    if ('error' in captured) {
      throw captured.error;
    }

    const { returnIterator } = captured;
    return returnIterator
      ? Reflect.apply(returnIterator, iterator, args)
      : Promise.resolve({ done: true as const, value: args[0] });
  };
}

function snapshotIterator(
  value: StreamingFileInput,
  createIterator: () => AsyncIterator<BlobPart>,
): MultipartDataSnapshot {
  const iterator = Reflect.apply(createIterator, value, []) as AsyncIterator<BlobPart>;
  let next: AsyncIterator<BlobPart>['next'];
  try {
    ({ next } = iterator);
  } catch (error) {
    const returnIterator = snapshotIteratorReturn(iterator);
    void ignoreCleanupResult(() => returnIterator?.());
    throw error;
  }
  const returnIterator = snapshotIteratorReturn(iterator);

  let consumed = false;
  return {
    data: {
      [Symbol.asyncIterator]() {
        consumed = true;
        return {
          next(...args: [] | [undefined]) {
            return Reflect.apply(next, iterator, args);
          },
          return(...args: [] | [unknown]) {
            return returnIterator
              ? returnIterator(...args)
              : Promise.resolve({ done: true as const, value: args[0] });
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    },
    dispose() {
      if (!consumed) {
        consumed = true;
        void ignoreCleanupResult(() => returnIterator?.());
      }
    },
  };
}

function snapshotReader(
  value: StreamingFileInput,
  getReader: ReadableStream<BlobPart>['getReader'],
): MultipartDataSnapshot {
  const reader = Reflect.apply(getReader, value, []) as ReadableStreamDefaultReader<BlobPart>;
  let read: ReadableStreamDefaultReader<BlobPart>['read'];
  try {
    ({ read } = reader);
  } catch (error) {
    void ignoreCleanupResult(() => reader.cancel());
    try {
      reader.releaseLock();
    } catch {
      // Cleanup failures must not mask the primary multipart result.
    }
    throw error;
  }

  let cancelReader: ReadableStreamDefaultReader<BlobPart>['cancel'];
  try {
    cancelReader = reader.cancel;
  } catch (error) {
    cancelReader = () => {
      throw error;
    };
  }

  let releaseReader: ReadableStreamDefaultReader<BlobPart>['releaseLock'];
  try {
    releaseReader = reader.releaseLock;
  } catch (error) {
    releaseReader = () => {
      throw error;
    };
  }

  interface PendingCancellation {
    releaseError?: Readonly<{ error: unknown }>;
  }
  let pendingCancellation: PendingCancellation | undefined;
  const settleCancellation = async (
    cancellation: Promise<void>,
    current: PendingCancellation,
  ): Promise<void> => {
    try {
      await cancellation;
    } finally {
      if (pendingCancellation === current) {
        pendingCancellation = undefined;
      }
    }
    if (current.releaseError) {
      throw current.releaseError.error;
    }
  };
  const cancel: ReadableStreamDefaultReader<BlobPart>['cancel'] = (...args) => {
    let cancellation: Promise<void>;
    try {
      cancellation = Promise.resolve(Reflect.apply(cancelReader, reader, args));
    } catch (error) {
      cancellation = Promise.reject(error);
    }

    const current: PendingCancellation = {};
    pendingCancellation = current;
    const settledCancellation = settleCancellation(cancellation, current);
    // Keep rejections observed even if a stream adapter exits before awaiting cleanup.
    void ignoreCleanupResult(() => settledCancellation);
    return settledCancellation;
  };
  const releaseLock: ReadableStreamDefaultReader<BlobPart>['releaseLock'] = () => {
    try {
      Reflect.apply(releaseReader, reader, []);
    } catch (error) {
      if (!pendingCancellation) {
        throw error;
      }
      // The generated adapter releases synchronously before awaiting cancellation.
      pendingCancellation.releaseError = { error };
    }
  };

  const capturedReader = {
    read: () => Reflect.apply(read, reader, []),
    cancel,
    releaseLock,
  };
  let consumed = false;
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        if (consumed) {
          return;
        }
        consumed = true;
        yield* ReadableStreamToAsyncIterable<BlobPart>({ getReader: () => capturedReader });
      },
    },
    dispose() {
      if (!consumed) {
        consumed = true;
        void ignoreCleanupResult(cancel);
        try {
          releaseLock();
        } catch {
          // Cleanup failures must not mask the primary multipart result.
        }
      }
    },
  };
}

function deferredMultipartSnapshot(capture: () => MultipartDataSnapshot): MultipartDataSnapshot {
  let snapshot: MultipartDataSnapshot | undefined;
  let disposed = false;
  return {
    data: {
      [Symbol.asyncIterator]() {
        if (disposed) {
          return {
            next: () => Promise.resolve({ done: true as const, value: undefined }),
            [Symbol.asyncIterator]() {
              return this;
            },
          };
        }

        snapshot = capture();
        const { data } = snapshot;
        const createIterator = (data as AsyncIterable<BlobPart>)[Symbol.asyncIterator];
        return Reflect.apply(createIterator, data, []) as AsyncIterator<BlobPart>;
      },
    },
    dispose() {
      disposed = true;
      snapshot?.dispose?.();
    },
  };
}

/** Capture an upload iterator or readable-stream reader without prefetching its contents. */
export function snapshotStreamingFileData(
  value: StreamingFileInput,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const cached = snapshots.get(value) as ReplayableMultipartDataSnapshot | undefined;
  if (cached) {
    return cached[replayMultipartSnapshot]();
  }

  const { [Symbol.asyncIterator]: createIterator } = value as AsyncIterable<BlobPart>;
  let capture: () => MultipartDataSnapshot;
  if (typeof createIterator === 'function') {
    capture = () => snapshotIterator(value, createIterator);
  } else {
    const { getReader } = value as ReadableStream<BlobPart>;
    if (typeof getReader !== 'function') {
      throw new TypeError('Streaming file data must be an async iterable or readable stream');
    }
    capture = () => snapshotReader(value, getReader);
  }

  const snapshot: ReplayableMultipartDataSnapshot = {
    ...capture(),
    [replayMultipartSnapshot]: () => deferredMultipartSnapshot(capture),
  };
  snapshots.set(value, snapshot);
  return snapshot;
}

function hasOriginalBlobRead(value: Blob, originalDescriptor: PropertyDescriptor | undefined): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'arrayBuffer');
  if (!originalDescriptor || !descriptor) {
    return originalDescriptor === descriptor;
  }

  return (
    originalDescriptor.value === descriptor.value &&
    originalDescriptor.get === descriptor.get &&
    originalDescriptor.set === descriptor.set
  );
}

/** Capture Blob contents lazily while rejecting methods substituted by later multipart fields. */
export function snapshotBlobData(
  value: Blob,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const { stream } = value as Blob & { stream?: Blob['stream'] };
  if (typeof stream === 'function') {
    return snapshotStreamingFileData(Reflect.apply(stream, value, []) as ReadableStream<BlobPart>, snapshots);
  }

  const immutableBlob = Reflect.apply(Blob.prototype.slice, value, []) as Blob;
  const { arrayBuffer: readImmutableBlob } = Blob.prototype;
  const { arrayBuffer: read } = value;
  const originalReadDescriptor = Object.getOwnPropertyDescriptor(value, 'arrayBuffer');

  return {
    data: {
      async *[Symbol.asyncIterator]() {
        const useOriginalRead = hasOriginalBlobRead(value, originalReadDescriptor);
        yield useOriginalRead
          ? await Reflect.apply(read, value, [])
          : await Reflect.apply(readImmutableBlob, immutableBlob, []);
      },
    },
  };
}

/** Capture a response body or Blob fallback without letting cleanup failures escape. */
export function snapshotResponseData(
  value: Response,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const { body } = value;
  if (body) {
    return snapshotStreamingFileData(body, snapshots);
  }

  const { slice, stream, arrayBuffer } = Blob.prototype;
  const blob = value.blob();
  void ignoreCleanupResult(() => blob);
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        const immutableBlob = Reflect.apply(slice, await blob, []) as Blob;
        if (typeof stream === 'function') {
          const immutableBody = Reflect.apply(stream, immutableBlob, []) as ReadableStream<BlobPart>;
          yield* ReadableStreamToAsyncIterable<BlobPart>(immutableBody);
        } else {
          yield await Reflect.apply(arrayBuffer, immutableBlob, []);
        }
      },
    },
  };
}
