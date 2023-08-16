/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

// If we accidentally call fetch with the wrong this binding,
// in the browser it would throw:
//   TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
const _fetch = fetch.bind(undefined);
const _Request = Request;
const _Response = Response;
const _Headers = Headers;

export const isPolyfilled = false;

export { _fetch as fetch, _Request as Request, _Response as Response, _Headers as Headers };
