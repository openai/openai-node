// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { type RequestInfo } from '../_shims/index';

export { type RequestInfo };

type _RequestInit = RequestInit;
export type { _RequestInit as RequestInit };

type _Response = Response;
export type { _Response as Response };

export type PromiseOrValue<T> = T | Promise<T>;
export type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type Fetch = typeof fetch;
export type RequestClient = { fetch: Fetch };
export type Headers = Record<string, string | null | undefined>;
export type DefaultQuery = Record<string, string | undefined>;
export type KeysEnum<T> = { [P in keyof Required<T>]: true };
