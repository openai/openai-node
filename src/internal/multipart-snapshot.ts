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

function hasOriginalIteratorReturn(
  iterator: AsyncIterator<BlobPart>,
  owner: object,
  getter: () => unknown,
): boolean {
  let prototype: object | null = iterator;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'return');
    if (descriptor) {
      return prototype === owner && !('value' in descriptor) && descriptor.get === getter;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function snapshotIteratorReturn(iterator: AsyncIterator<BlobPart>): AsyncIterator<BlobPart>['return'] {
  let readReturn = () => Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'];
  try {
    let prototype: object | null = iterator;
    while (prototype !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'return');
      if (descriptor) {
        if ('value' in descriptor) {
          const returnIterator = Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'];
          return returnIterator
            ? (...args: [] | [unknown]) => Reflect.apply(returnIterator, iterator, args)
            : undefined;
        }

        const getReturn = descriptor.get;
        const owner = prototype;
        readReturn = () => {
          if (!getReturn) {
            return;
          }
          return hasOriginalIteratorReturn(iterator, owner, getReturn)
            ? (Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'])
            : (Reflect.apply(getReturn, iterator, []) as AsyncIterator<BlobPart>['return']);
        };
        break;
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
        captured = { returnIterator: readReturn() };
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
  const returnIterator = snapshotIteratorReturn(iterator);
  let next: AsyncIterator<BlobPart>['next'];
  try {
    ({ next } = iterator);
  } catch (error) {
    void ignoreCleanupResult(() => returnIterator?.());
    throw error;
  }

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

  let cancel: ReadableStreamDefaultReader<BlobPart>['cancel'];
  try {
    const cancelReader = reader.cancel;
    cancel = (...args) => {
      try {
        return Promise.resolve(Reflect.apply(cancelReader, reader, args));
      } catch (error) {
        return Promise.reject(error);
      }
    };
  } catch (error) {
    cancel = () => Promise.reject(error);
  }

  let releaseLock: ReadableStreamDefaultReader<BlobPart>['releaseLock'];
  try {
    const releaseReader = reader.releaseLock;
    releaseLock = () => Reflect.apply(releaseReader, reader, []);
  } catch (error) {
    releaseLock = () => {
      throw error;
    };
  }

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

  const blob = value.blob();
  void ignoreCleanupResult(() => blob);
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        yield await blob;
      },
    },
  };
}
