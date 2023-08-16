/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

// Use builtin web types if present; else never (user should
// add appropriate lib or types to tsconfig)

/**
 * >>> Confused? <<<
 *
 * If you're getting errors from these types, try adding "lib": ["DOM"]
 * to your tsconfig.json, or otherwise configure the appropriate builtin
 * `fetch` types for your environment.
 */

// @ts-ignore
type _fetch = unknown extends typeof fetch ? never : typeof fetch;
// @ts-ignore
type _Request = unknown extends Request ? never : Request;
// @ts-ignore
type _RequestInfo = unknown extends RequestInfo ? never : RequestInfo;
// @ts-ignore
type _RequestInit = unknown extends RequestInit ? never : RequestInit;
// @ts-ignore
type _Response = unknown extends Response ? never : Response;
// @ts-ignore
type _ResponseInit = unknown extends ResponseInit ? never : ResponseInit;
// @ts-ignore
type _ResponseType = unknown extends ResponseType ? never : ResponseType;
// @ts-ignore
type _BodyInit = unknown extends BodyInit ? never : BodyInit;
// @ts-ignore
type _Headers = unknown extends Headers ? never : Headers;
// @ts-ignore
type _HeadersInit = unknown extends HeadersInit ? never : HeadersInit;

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
