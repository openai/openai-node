/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import * as undici from 'undici';

export { type Agent } from 'node:http';
import { ReadableStream as _ReadableStream } from 'node:stream/web';
export { type ReadStream as FsReadStream } from 'node:fs';
import { Blob as _Blob } from 'node:buffer';
import { Readable as _Readable } from 'node:stream';

export const fetch: typeof undici.fetch;

export type Readable = _Readable;

export const ReadableStream: typeof _ReadableStream;
export type ReadableStream = _ReadableStream;

export type Request = undici.Request;
export type RequestInfo = undici.RequestInfo;
export type RequestInit = undici.RequestInit;
export type RequestDuplex = undici.RequestDuplex;

export type Response = undici.Response;
export type ResponseInit = undici.ResponseInit;
export type ResponseType = undici.ResponseType;
export type BodyInit = undici.BodyInit;
export type Headers = undici.Headers;
export type HeadersInit = undici.HeadersInit;

type EndingType = 'native' | 'transparent';
export interface BlobPropertyBag {
  endings?: EndingType;
  type?: string;
}

export interface FilePropertyBag extends BlobPropertyBag {
  lastModified?: number;
}

export type FormData = undici.FormData;
export const FormData: typeof undici.FormData;
export type File = undici.File;
export const File: typeof undici.File;
export type Blob = _Blob;
export const Blob: typeof _Blob;
