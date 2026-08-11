/**
 * Exposes a readable stream as an async iterator across runtimes with different
 * built-in stream iteration support.
 *
 * Existing async iterators are reused; async-iterable streams that are not
 * themselves iterators are converted through `Symbol.asyncIterator`. Streams
 * without built-in iteration are locked with `getReader()` until iteration
 * completes, fails, or is canceled. Returning early cancels a fallback stream
 * and releases its reader lock.
 *
 * Adapted from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490.
 */
export function ReadableStreamToAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
  if (stream[Symbol.asyncIterator]) {
    return typeof stream.next === 'function' ? stream : stream[Symbol.asyncIterator]();
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
