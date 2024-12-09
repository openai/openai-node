// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

export type PromiseOrValue<T> = T | Promise<T>;
export type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type Headers = Record<string, string | null | undefined>;
export type DefaultQuery = Record<string, string | undefined>;
export type KeysEnum<T> = { [P in keyof Required<T>]: true };
