/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

export {
  fetch,
  Response,
  Headers,
  FormData,
  Request,
  RequestInfo,
  RequestInit,
  RequestDuplex,
  ResponseInit,
  ResponseType,
  BodyInit,
  HeadersInit,
} from 'undici-types';
export { type Agent } from 'node:http';
export { type ReadStream as FsReadStream } from 'node:fs';
export type { Readable } from 'node:stream';

import { Blob as _Blob, File as _File } from 'node:buffer';

export type File = _File;
export const File: typeof _File;
export type Blob = _Blob;
export const Blob: typeof _Blob;

import { ReadableStream as _ReadableStream } from 'node:stream/web';
export type ReadableStream = _ReadableStream;
export const ReadableStream: typeof _ReadableStream;

type EndingType = 'native' | 'transparent';
export interface BlobPropertyBag {
  endings?: EndingType;
  type?: string;
}

export interface FilePropertyBag extends BlobPropertyBag {
  lastModified?: number;
}
