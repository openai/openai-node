/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

const _FormData = FormData;
const _File = File;
const _Blob = Blob;

export { _FormData as FormData, _File as File, _Blob as Blob };

export const isPolyfilled = false;
