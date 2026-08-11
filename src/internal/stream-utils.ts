/**
 * Exposes a readable stream as an async iterator across runtimes with different
 * built-in stream iteration support.
 *
 * Existing async iterators are reused; async-iterable streams that are not
 * themselves iterators are converted through `Symbol.asyncIterator`. Iterator
 * results without their own async-iterator method are adapted while preserving
 * cancellation and error propagation. Streams without built-in iteration are
 * locked with `getReader()` until iteration completes, fails, or is canceled.
 * Returning early cancels a fallback stream and releases its reader lock.
 *
 * Adapted from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490.
 */
export function ReadableStreamToAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
  if (stream[Symbol.asyncIterator]) {
    if (typeof stream.next === 'function') {
      return stream;
    }

    const iterator = stream[Symbol.asyncIterator]();
    if (typeof iterator[Symbol.asyncIterator] === 'function') {
      return iterator;
    }

    const iterableIterator: AsyncIterableIterator<T> = {
      next: iterator.next.bind(iterator),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    if (typeof iterator.return === 'function') {
      iterableIterator.return = iterator.return.bind(iterator);
    }
    if (typeof iterator.throw === 'function') {
      iterableIterator.throw = iterator.throw.bind(iterator);
    }
    return iterableIterator;
  }

  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) {
          reader.releaseLock();
        } // release lock when stream becomes closed
        return result;
      } catch (e) {
        reader.releaseLock(); // release lock when stream becomes errored
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
