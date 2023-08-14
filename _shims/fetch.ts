const _fetch = fetch;
const _Request = Request;
type _RequestInfo = RequestInfo;
type _RequestInit = RequestInit;
const _Response = Response;
type _ResponseInit = ResponseInit;
type _BodyInit = BodyInit;
const _Headers = Headers;
type _HeadersInit = HeadersInit;

export const isPolyfilled = false;

export {
  type _BodyInit as BodyInit,
  _fetch as fetch,
  _Headers as Headers,
  type _HeadersInit as HeadersInit,
  _Request as Request,
  type _RequestInfo as RequestInfo,
  type _RequestInit as RequestInit,
  _Response as Response,
  type _ResponseInit as ResponseInit,
};
