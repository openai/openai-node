/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { FormData } from './formdata.node';
import type { RequestOptions } from '../core';
import { Readable } from 'node:stream';
import { FormDataEncoder } from 'form-data-encoder';

export async function getMultipartRequestOptions<T extends {} = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  const encoder = new FormDataEncoder(form);
  const readable = Readable.from(encoder);
  const body = { __multipartBody__: readable };
  const headers = {
    ...opts.headers,
    ...encoder.headers,
    'Content-Length': encoder.contentLength,
  };

  return { ...opts, body: body as any, headers };
}
