/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import * as nf from 'node-fetch';

// Use builtin web types if present; else node-fetch types

/**
 * >>> Confused? <<<
 *
 * If you're getting errors from these types, try adding "lib": ["DOM"]
 * to your tsconfig.json, or otherwise configure the appropriate builtin
 * `fetch` types for your environment.
 */

// @ts-ignore
type _fetch = unknown extends typeof fetch ? typeof nf.default : typeof fetch;
// @ts-ignore
type _Request = unknown extends Request ? nf.Request : Request;
// @ts-ignore
type _RequestInfo = unknown extends RequestInfo ? nf.RequestInfo : RequestInfo;
// @ts-ignore
type _RequestInit = unknown extends RequestInit ? nf.RequestInit : RequestInit;
// @ts-ignore
type _Response = unknown extends Response ? nf.Response : Response;
// @ts-ignore
type _ResponseInit = unknown extends ResponseInit ? nf.ResponseInit : ResponseInit;
type _ResponseType =
  // @ts-ignore
  unknown extends ResponseType ? 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect'
  : // @ts-ignore
    ResponseType;
// @ts-ignore
type _BodyInit = unknown extends BodyInit ? nf.BodyInit : BodyInit;
// @ts-ignore
type _Headers = unknown extends Headers ? nf.Headers : Headers;
// @ts-ignore
type _HeadersInit = unknown extends HeadersInit ? nf.HeadersInit : HeadersInit;

declare const _fetch: _fetch;
declare const _Request: {
  prototype: _Request;
  new (input: _RequestInfo | URL, init?: _RequestInit): _Request;
};
declare const _Response: {
  prototype: _Response;
  new (body?: _BodyInit | null, init?: _ResponseInit): _Response;
};
declare const _Headers: {
  prototype: _Headers;
  new (init?: _HeadersInit): _Headers;
};

export const isPolyfilled = false;

export { _fetch as fetch, _Request as Request, _Response as Response, _Headers as Headers };
export type {
  _RequestInit as RequestInit,
  _RequestInfo as RequestInfo,
  _ResponseType as ResponseType,
  _BodyInit as BodyInit,
};
