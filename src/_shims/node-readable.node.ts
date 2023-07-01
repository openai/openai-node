/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
export type { Readable } from 'node:stream';
import { ReadStream as FsReadStream } from 'node:fs';
export type { FsReadStream };

export function isFsReadStream(value: any): value is FsReadStream {
  return value instanceof FsReadStream;
}
