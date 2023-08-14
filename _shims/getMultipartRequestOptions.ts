/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { FormData } from "./formdata.ts";
import type { RequestOptions } from "../core.ts";
import { MultipartBody } from "../uploads.ts";

export async function getMultipartRequestOptions<
  T extends {} = Record<string, unknown>,
>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>> {
  return { ...opts, body: new MultipartBody(form) as any };
}
