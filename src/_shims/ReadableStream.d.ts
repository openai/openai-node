/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

/**
 * >>> Confused? <<<
 *
 * If you're getting errors from these types, try adding "lib": ["DOM"]
 * to your tsconfig.json, or otherwise configure the appropriate builtin
 * `ReadableStream` type for your environment.
 */

// @ts-ignore
type _ReadableStream<R = any> = unknown extends ReadableStream ? never : ReadableStream<R>;
declare const _ReadableStream: {
  prototype: _ReadableStream;
  new (
    underlyingSource: _UnderlyingByteSource,
    strategy?: { highWaterMark?: number },
  ): _ReadableStream<Uint8Array>;
  new <R = any>(
    underlyingSource: _UnderlyingDefaultSource<R>,
    strategy?: _QueuingStrategy<R>,
  ): _ReadableStream<R>;
  new <R = any>(underlyingSource?: _UnderlyingSource<R>, strategy?: _QueuingStrategy<R>): _ReadableStream<R>;
};

// @ts-ignore
type _UnderlyingSource<R = any> = unknown extends UnderlyingSource ? never : UnderlyingSource<R>;
// @ts-ignore
type _UnderlyingByteSource = unknown extends UnderlyingByteSource ? never : UnderlyingByteSource;
type _UnderlyingDefaultSource<R = any> =
  // @ts-ignore
  unknown extends UnderlyingDefaultSource ? never : UnderlyingDefaultSource<R>;
// @ts-ignore
type _QueuingStrategy<R = any> = unknown extends QueuingStrategy ? never : QueuingStrategy<R>;

export { _ReadableStream as ReadableStream };
