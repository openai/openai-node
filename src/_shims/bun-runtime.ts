/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import { Readable } from 'node:stream';
import { type Shims } from './registry';
import { getRuntime as getWebRuntime } from './web-runtime';
import { ReadStream as FsReadStream } from 'node:fs';

export function getRuntime(): Shims {
  const runtime = getWebRuntime();
  function isFsReadStream(value: any): value is FsReadStream {
    return value instanceof FsReadStream;
  }

  function isReadable(value: any) {
    return value instanceof Readable;
  }

  return { ...runtime, isFsReadStream, isReadable };
}
