// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { type RequestInfo, type RequestInit, type Response } from '../_shims/index';

export { type Response, type RequestInfo, type RequestInit };

export type PromiseOrValue<T> = T | Promise<T>;
export type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;
export type RequestClient = { fetch: Fetch };
export type Headers = Record<string, string | null | undefined>;
export type DefaultQuery = Record<string, string | undefined>;
export type KeysEnum<T> = { [P in keyof Required<T>]: true };
