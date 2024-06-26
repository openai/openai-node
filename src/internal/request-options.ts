// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { type Agent, type Readable } from '../_shims/index';
import { BlobLike } from '../uploads';
import { isEmptyObj, hasOwn } from './utils';
import { Stream } from '../streaming';
import { type Headers, type HTTPMethod, type KeysEnum } from './types';

export type FinalRequestOptions<Req = unknown | Record<string, unknown> | Readable | DataView> =
  RequestOptions<Req> & {
    method: HTTPMethod;
    path: string;
  };

export type RequestOptions<
  Req = unknown | Record<string, unknown> | Readable | BlobLike | ArrayBufferView | ArrayBuffer,
> = {
  method?: HTTPMethod;
  path?: string;
  query?: Req | undefined;
  body?: Req | null | undefined;
  headers?: Headers | undefined;

  maxRetries?: number;
  stream?: boolean | undefined;
  timeout?: number;
  httpAgent?: Agent;
  signal?: AbortSignal | undefined | null;
  idempotencyKey?: string;

  __binaryRequest?: boolean | undefined;
  __binaryResponse?: boolean | undefined;
  __streamClass?: typeof Stream;
};

// This is required so that we can determine if a given object matches the RequestOptions
// type at runtime. While this requires duplication, it is enforced by the TypeScript
// compiler such that any missing / extraneous keys will cause an error.
const requestOptionsKeys: KeysEnum<RequestOptions> = {
  method: true,
  path: true,
  query: true,
  body: true,
  headers: true,

  maxRetries: true,
  stream: true,
  timeout: true,
  httpAgent: true,
  signal: true,
  idempotencyKey: true,

  __binaryRequest: true,
  __binaryResponse: true,
  __streamClass: true,
};

export const isRequestOptions = (obj: unknown): obj is RequestOptions => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !isEmptyObj(obj) &&
    Object.keys(obj).every((k) => hasOwn(requestOptionsKeys, k))
  );
};
