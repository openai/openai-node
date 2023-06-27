/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { FormData } from './formdata';
import type { RequestOptions } from '../core';

export async function getMultipartRequestOptions<T extends {} = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  return { ...opts, body: { __multipartBody__: form } as any };
}
