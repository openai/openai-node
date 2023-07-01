/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

// If we accidentally call fetch with the wrong this binding,
// in the browser it would throw:
//   TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
exports.fetch = fetch.bind(undefined);
exports.Request = Request;
exports.Response = Response;
exports.Headers = Headers;

exports.isPolyfilled = true;
