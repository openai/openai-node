/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import undici from 'undici';

export { type Agent } from 'node:http';
export { type ReadableStream } from 'node:stream/web';
export { type ReadStream as FsReadStream } from 'node:fs';
import { Blob } from 'node:buffer';

export const fetch: typeof undici.fetch;

export type Request = undici.Request;
export type RequestInfo = undici.RequestInfo;
export type RequestInit = undici.RequestInit;

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

export type FileFromPathOptions = Omit<FilePropertyBag, 'lastModified'>;

export type FormData = undici.FormData;
export const FormData: typeof undici.FormData;
export type File = undici.File;
export const File: typeof undici.File;
export type Blob = Blob;
export const Blob: typeof Blob;
