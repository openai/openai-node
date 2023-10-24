/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import uf from 'undici';
import type { File, Agent, FormData } from 'undici';
import type { FilePropertyBag } from 'formdata-node';
import { FormDataEncoder } from 'form-data-encoder';
import { ReadStream as FsReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { Blob } from 'node:buffer';
import { type RequestOptions } from '../core';
import { MultipartBody } from './MultipartBody';
import { type Shims } from './registry';

type FileFromPathOptions = Omit<FilePropertyBag, 'lastModified'>;

let fileFromPathWarned = false;

/**
 * @deprecated use fs.createReadStream('./my/file.txt') instead
 */
async function fileFromPath(path: string): Promise<File>;
async function fileFromPath(path: string, filename?: string): Promise<File>;
async function fileFromPath(path: string, options?: FileFromPathOptions): Promise<File>;
async function fileFromPath(path: string, filename?: string, options?: FileFromPathOptions): Promise<File>;
async function fileFromPath(path: string, ...args: any[]): Promise<File> {
  // this import fails in environments that don't handle export maps correctly, like old versions of Jest
  const { fileFromPath: _fileFromPath } = await import('formdata-node/file-from-path');

  if (!fileFromPathWarned) {
    console.warn(`fileFromPath is deprecated; use fs.createReadStream(${JSON.stringify(path)}) instead`);
    fileFromPathWarned = true;
  }
  // @ts-ignore
  return await _fileFromPath(path, ...args);
}

const defaultHttpAgent = new uf.Agent({ keepAliveTimeout: 5 * 60 * 1000 });
const defaultHttpsAgent = new uf.Agent({ keepAliveTimeout: 5 * 60 * 1000 });

async function getMultipartRequestOptions<T extends {} = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  const encoder = new FormDataEncoder(form);
  const readable = Readable.from(encoder);
  const body = new MultipartBody(readable);
  const headers = {
    ...opts.headers,
    ...encoder.headers,
    'Content-Length': encoder.contentLength,
  };

  return { ...opts, body: body as any, headers };
}

export function getRuntime(): Shims {
  // Polyfill global object if needed.
  if (typeof AbortController === 'undefined') {
    // @ts-expect-error (the types are subtly different, but compatible in practice)
    globalThis.AbortController = AbortControllerPolyfill;
  }
  return {
    kind: 'node',
    fetch: uf.fetch,
    Request: uf.Request,
    Response: uf.Response,
    Headers: uf.Headers,
    FormData: uf.FormData,
    Blob: Blob,
    File: uf.File,
    ReadableStream,
    getMultipartRequestOptions,
    getDefaultAgent: (url: string): Agent => (url.startsWith('https') ? defaultHttpsAgent : defaultHttpAgent),
    fileFromPath,
    isFsReadStream: (value: any): value is FsReadStream => value instanceof FsReadStream,
  };
}
