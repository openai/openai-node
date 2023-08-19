/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

const _FormData = FormData;
const _Blob = Blob;

const _File =
  typeof File !== 'undefined' ? File : (
    // Bun doesn't implement File yet, so just make a shim that throws a helpful error message
    class File extends Blob {
      constructor() {
        throw new Error(`file uploads aren't supported in this environment yet as 'File' is not defined`);
      }
    }
  );

export { _FormData as FormData, _File as File, _Blob as Blob };

export const isPolyfilled = false;
