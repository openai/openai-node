import type { Readable } from 'node:stream';
import type { RequestOptions } from './core';
import { type BodyInit } from 'openai/_shims/fetch';
import { FormData } from 'openai/_shims/formdata';
import { getMultipartRequestOptions } from 'openai/_shims/getMultipartRequestOptions';
import { isUploadable } from 'openai/_shims/uploadable';
import { toFile } from 'openai/_shims/toFile';
import { fileFromPath } from 'openai/_shims/fileFromPath';

export { toFile, fileFromPath };

type MultipartBody = {
  __multipartBody__: Readable | BodyInit;
};

export const isMultipartBody = (body: any): body is MultipartBody =>
  typeof body === 'object' && body?.__multipartBody__ != null;

/**
 * Returns a multipart/form-data request if any part of the given request body contains a File / Blob value.
 * Otherwise returns the request as is.
 */
export const maybeMultipartFormRequestOptions = async <T extends {} = Record<string, unknown>>(
  opts: RequestOptions<T>,
): Promise<RequestOptions<T | MultipartBody>> => {
  if (!hasUploadableValue(opts.body)) return opts;

  const form = await createForm(opts.body);
  return getMultipartRequestOptions(form, opts);
};

export const multipartFormRequestOptions = async <T extends {} = Record<string, unknown>>(
  opts: RequestOptions<T>,
): Promise<RequestOptions<T | MultipartBody>> => {
  const form = await createForm(opts.body);
  return getMultipartRequestOptions(form, opts);
};

export const createForm = async <T = Record<string, unknown>>(body: T | undefined): Promise<FormData> => {
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
  return form;
};

const hasUploadableValue = (value: unknown): boolean => {
  if (isUploadable(value)) return true;
  if (Array.isArray(value)) return value.some(hasUploadableValue);
  if (value && typeof value === 'object') {
    for (const k in value) {
      if (hasUploadableValue((value as any)[k])) return true;
    }
  }
  return false;
};

const addFormValue = async (form: FormData, key: string, value: unknown): Promise<void> => {
  if (value === undefined) return;
  if (value == null) {
    throw new TypeError(
      `Received null for "${key}"; to pass null in FormData, you must use the string 'null'`,
    );
  }

  // TODO: make nested formats configurable
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    form.append(key, value);
  } else if (isUploadable(value)) {
    const file = await toFile(value);
    form.append(key, file);
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + '[]', entry)));
  } else if (typeof value === 'object') {
    await Promise.all(
      Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)),
    );
  } else {
    throw new TypeError(
      `Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`,
    );
  }
};
