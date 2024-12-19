// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { NullableHeaders } from './headers';

import type { Agent } from './shims';
import type { BodyInit } from './builtin-types';
import { isEmptyObj, hasOwn } from './utils/values';
import { Stream } from '../streaming';
import type { HTTPMethod, KeysEnum } from './types';
import { type HeadersLike } from './headers';

export type FinalRequestOptions = RequestOptions & { method: HTTPMethod; path: string };

export type RequestOptions = {
  method?: HTTPMethod;
  path?: string;
  query?: object | undefined | null;
  body?: unknown;
  headers?: HeadersLike;
  maxRetries?: number;
  stream?: boolean | undefined;
  timeout?: number;
  httpAgent?: Agent;
  signal?: AbortSignal | undefined | null;
  idempotencyKey?: string;

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

export type EncodedContent = { bodyHeaders: HeadersLike; body: BodyInit };
export type RequestEncoder = (request: { headers: NullableHeaders; body: unknown }) => EncodedContent;

export const FallbackEncoder: RequestEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
};
