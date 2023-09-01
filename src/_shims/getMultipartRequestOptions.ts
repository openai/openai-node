/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { FormData } from './form-data';
import type { RequestOptions } from '../core';
import { MultipartBody } from '../uploads';

export async function getMultipartRequestOptions<T extends {} = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  return { ...opts, body: new MultipartBody(form) as any };
}
