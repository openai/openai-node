/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

const fd = require('formdata-node');

exports.FormData = fd.FormData;
exports.File = fd.File;
exports.Blob = fd.Blob;

exports.isPolyfilled = true;
