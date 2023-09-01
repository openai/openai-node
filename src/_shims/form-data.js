/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

exports.FormData = FormData;
exports.Blob = Blob;
exports.File =
  typeof File !== 'undefined' ? File : (
    // Bun doesn't implement File yet, so just make a shim that throws a helpful error message
    class File extends Blob {
      constructor() {
        throw new Error(`file uploads aren't supported in this environment yet as 'File' is not defined`);
      }
    }
  );

exports.isPolyfilled = false;
