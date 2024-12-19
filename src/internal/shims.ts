// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

/**
 * This module provides internal shims and utility functions for environments where certain Node.js or global types may not be available.
 *
 * These are used to ensure we can provide a consistent behaviour between different JavaScript environments and good error
 * messages in cases where an environment isn't fully supported.
 */

import { type Fetch } from './builtin-types';
import { type ReadableStream } from './shim-types';

/**
 * A minimal copy of the `Agent` type from `undici-types` so we can
 * use it in the `ClientOptions` type.
 *
 * https://nodejs.org/api/http.html#class-httpagent
 */
export interface Agent {
  dispatch(options: any, handler: any): boolean;
  closed: boolean;
  destroyed: boolean;
}

export function getDefaultFetch(): Fetch {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }

  throw new Error(
    '`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`',
  );
}

/**
 * A minimal copy of the NodeJS `stream.Readable` class so that we can
 * accept the NodeJS types in certain places, e.g. file uploads
 *
 * https://nodejs.org/api/stream.html#class-streamreadable
 */
export interface ReadableLike {
  readable: boolean;
  readonly readableEnded: boolean;
  readonly readableFlowing: boolean | null;
  readonly readableHighWaterMark: number;
  readonly readableLength: number;
  readonly readableObjectMode: boolean;
  destroyed: boolean;
  read(size?: number): any;
  pause(): this;
  resume(): this;
  isPaused(): boolean;
  destroy(error?: Error): this;
  [Symbol.asyncIterator](): AsyncIterableIterator<any>;
}

/**
 * Determines if the given value looks like a NodeJS `stream.Readable`
 * object and that it is readable, i.e. has not been consumed.
 *
 * https://nodejs.org/api/stream.html#class-streamreadable
 */
export function isReadableLike(value: any) {
  // We declare our own class of Readable here, so it's not feasible to
  // do an 'instanceof' check. Instead, check for Readable-like properties.
  return !!value && value.readable === true && typeof value.read === 'function';
}

/**
 * A minimal copy of the NodeJS `fs.ReadStream` class for usage within file uploads.
 *
 * https://nodejs.org/api/fs.html#class-fsreadstream
 */
export interface FsReadStreamLike extends ReadableLike {
  path: {}; // real type is string | Buffer but we can't reference `Buffer` here
}

/**
 * Determines if the given value looks like a NodeJS `fs.ReadStream`
 * object.
 *
 * This just checks if the object matches our `Readable` interface
 * and defines a `path` property, there may be false positives.
 *
 * https://nodejs.org/api/fs.html#class-fsreadstream
 */
export function isFsReadStreamLike(value: any): value is FsReadStreamLike {
  return isReadableLike(value) && 'path' in value;
}

type ReadableStreamArgs = ConstructorParameters<typeof ReadableStream>;

export function makeReadableStream(...args: ReadableStreamArgs): ReadableStream {
  const ReadableStream = (globalThis as any).ReadableStream;
  if (typeof ReadableStream === 'undefined') {
    // Note: All of the platforms / runtimes we officially support already define
    // `ReadableStream` as a global, so this should only ever be hit on unsupported runtimes.
    throw new Error(
      '`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`',
    );
  }

  return new ReadableStream(...args);
}

export function ReadableStreamFrom<T>(iterable: Iterable<T> | AsyncIterable<T>): ReadableStream<T> {
  let iter: AsyncIterator<T> | Iterator<T> =
    Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();

  return makeReadableStream({
    start() {},
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    },
  });
}
