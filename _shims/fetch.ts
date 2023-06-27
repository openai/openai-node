/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import type * as nf from 'node-fetch';

const _fetch: typeof nf.default =
  // @ts-ignore
  fetch as any;
type _fetch = typeof nf.default;
const _Request: typeof nf.Request =
  // @ts-ignore
  Request as any;
type _Request = nf.Request;
const _Response: typeof nf.Response =
  // @ts-ignore
  Response as any;
type _Response = nf.Response;
const _Headers: typeof nf.Headers =
  // @ts-ignore
  Headers as any;
type _Headers = nf.Headers;

export const isPolyfilled = false;

export { _fetch as fetch, _Request as Request, _Response as Response, _Headers as Headers };

type _RequestInfo = nf.RequestInfo;
type _RequestInit = nf.RequestInit;
type _BodyInit = nf.BodyInit;

export type { _RequestInit as RequestInit, _RequestInfo as RequestInfo, _BodyInit as BodyInit };
