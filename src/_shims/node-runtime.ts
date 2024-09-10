/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import { FormDataEncoder, FormDataLike } from 'form-data-encoder';
import { ReadStream as FsReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { Blob, File } from 'node:buffer';
import { type RequestOptions } from '../internal/request-options';
import { MultipartBody } from './MultipartBody';
import { type Shims } from './registry';

async function getMultipartRequestOptions<T = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  const encoder = new FormDataEncoder(form as unknown as FormDataLike);
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
  return {
    kind: 'node',
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
    Blob: Blob,
    File: File,
    ReadableStream,
    getMultipartRequestOptions,
    // @ts-expect-error
    getDefaultAgent: (): any => globalThis[Symbol.for('undici.globalDispatcher.1')],
    isFsReadStream: (value: any): value is FsReadStream => value instanceof FsReadStream,
    isReadable: (value: any) => value instanceof Readable,
    readableFromWeb: (value: ReadableStream<any>) => Readable.fromWeb(value),
  };
}
