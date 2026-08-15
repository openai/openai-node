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

function isNativeReadableStream(value: StreamingFileInput, requireLocked = false): boolean {
  if (typeof globalThis.ReadableStream !== 'function') {
    return false;
  }

  try {
    const getLocked = Object.getOwnPropertyDescriptor(globalThis.ReadableStream.prototype, 'locked')?.get;
    const locked = getLocked?.call(value);
    return typeof locked === 'boolean' && (!requireLocked || locked);
  } catch {
    // Ordinary async iterables and reader-like objects do not satisfy the native stream brand.
    return false;
  }
}

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
        if ('value' in descriptor) {
          const returnIterator = descriptor.value as AsyncIterator<BlobPart>['return'];
          return returnIterator
            ? (...args: [] | [unknown]) => Reflect.apply(returnIterator, iterator, args)
            : undefined;
        }

        const getReturn = descriptor.get;
        if (!getReturn) {
          return undefined;
        }

        return (...args: [] | [unknown]) => {
          const returnIterator = Reflect.apply(getReturn, iterator, []) as AsyncIterator<BlobPart>['return'];
          return returnIterator
            ? Reflect.apply(returnIterator, iterator, args)
            : Promise.resolve({ done: true as const, value: args[0] });
        };
      }
      prototype = Object.getPrototypeOf(prototype);
    }
  } catch (error) {
    return () => {
      throw error;
    };
  }

  return (...args: [] | [unknown]) => {
    const returnIterator = Reflect.get(iterator, 'return') as AsyncIterator<BlobPart>['return'];
    return returnIterator
      ? Reflect.apply(returnIterator, iterator, args)
      : Promise.resolve({ done: true as const, value: args[0] });
  };
}

/** Capture an upload iterator or readable-stream reader without prefetching its contents. */
export function snapshotStreamingFileData(
  value: StreamingFileInput,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const cached = snapshots.get(value);
  if (cached) {
    return cached;
  }

  const { [Symbol.asyncIterator]: createIterator } = value as AsyncIterable<BlobPart>;
  if (typeof createIterator === 'function') {
    const iterator = createIterator.call(value);
    const returnIterator = snapshotIteratorReturn(iterator);
    const isLockedNativeStream = isNativeReadableStream(value, true);
    let next: AsyncIterator<BlobPart>['next'];
    try {
      ({ next } = iterator);
    } catch (error) {
      void ignoreCleanupResult(() => returnIterator?.());
      throw error;
    }
    let consumed = false;
    const snapshot: MultipartDataSnapshot = {
      data: {
        [Symbol.asyncIterator]() {
          consumed = true;
          return {
            next(...args: [] | [undefined]) {
              return next.call(iterator, ...args);
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
    if (isLockedNativeStream) {
      snapshots.set(value, snapshot);
    }
    return snapshot;
  }

  const { getReader } = value as ReadableStream<BlobPart>;
  if (typeof getReader === 'function') {
    const reader = getReader.call(value) as ReadableStreamDefaultReader<BlobPart>;
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
      cancel = reader.cancel.bind(reader);
    } catch (error) {
      cancel = () => {
        throw error;
      };
    }

    let releaseLock: ReadableStreamDefaultReader<BlobPart>['releaseLock'];
    try {
      releaseLock = reader.releaseLock.bind(reader);
    } catch (error) {
      releaseLock = () => {
        throw error;
      };
    }

    const capturedReader = {
      read: () => read.call(reader),
      cancel,
      releaseLock,
    };
    let consumed = false;
    const snapshot: MultipartDataSnapshot = {
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
    if (isNativeReadableStream(value, true)) {
      snapshots.set(value, snapshot);
    }
    return snapshot;
  }

  throw new TypeError('Streaming file data must be an async iterable or readable stream');
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
    return snapshotStreamingFileData(stream.call(value) as ReadableStream<BlobPart>, snapshots);
  }

  const immutableBlob = Blob.prototype.slice.call(value);
  const { arrayBuffer: readImmutableBlob } = Blob.prototype;
  const { arrayBuffer: read } = value;
  const originalReadDescriptor = Object.getOwnPropertyDescriptor(value, 'arrayBuffer');

  return {
    data: {
      async *[Symbol.asyncIterator]() {
        const useOriginalRead = hasOriginalBlobRead(value, originalReadDescriptor);
        const buffer = await read.call(value);
        yield useOriginalRead ? buffer : await readImmutableBlob.call(immutableBlob);
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
