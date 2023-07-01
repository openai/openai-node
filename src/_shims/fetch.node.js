/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

const nf = require('node-fetch');

exports.fetch = nf.default;
exports.Request = nf.Request;
exports.Response = nf.Response;
exports.Headers = nf.Headers;

exports.isPolyfilled = true;
