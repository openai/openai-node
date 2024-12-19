// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

/**
 * Shims for types that we can't always rely on being available globally.
 *
 * Note: these only exist at the type-level, there is no corresponding runtime
 * version for any of these symbols.
 */

/**
 * In order to properly access the global `NodeJS` type, if it's available, we
 * need to make use of declaration shadowing. Without this, any checks for the
 * presence of `NodeJS.ReadableStream` will fail.
 */
declare namespace NodeJS {
  interface ReadableStream {}
}

type HasProperties<T> = keyof T extends never ? false : true;

// @ts-ignore
type _ReadableStream<R = any> =
  // @ts-ignore
  HasProperties<NodeJS.ReadableStream> extends true ? NodeJS.ReadableStream<R> : ReadableStream<R>;

// @ts-ignore
declare const _ReadableStream: unknown extends typeof ReadableStream ? never : typeof ReadableStream;
export { _ReadableStream as ReadableStream };
