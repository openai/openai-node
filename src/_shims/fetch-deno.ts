const _fetch = fetch;
type _fetch = typeof fetch;
const _Request = Request;
type _Request = Request;
type _RequestInfo = RequestInfo;
type _RequestInit = RequestInit;
const _Response = Response;
type _Response = Response;
type _ResponseInit = ResponseInit;
type _BodyInit = BodyInit;
const _Headers = Headers;
type _Headers = Headers;
type _HeadersInit = HeadersInit;

export const isPolyfilled = false;

export {
  _fetch as fetch,
  _Request as Request,
  type _RequestInfo as RequestInfo,
  type _RequestInit as RequestInit,
  _Response as Response,
  type _ResponseInit as ResponseInit,
  type _BodyInit as BodyInit,
  _Headers as Headers,
  type _HeadersInit as HeadersInit,
};
