/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import { type Shims } from './registry';
import { getRuntime as getWebRuntime } from './web-runtime';
import { ReadStream as FsReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export function getRuntime(): Shims {
  const runtime = getWebRuntime();
  function isFsReadStream(value: any): value is FsReadStream {
    return value instanceof FsReadStream;
  }
  function isReadableStream(value: any): value is Readable {
    return value instanceof Readable;
  }
  return { ...runtime, isFsReadStream, isReadableStream };
}
