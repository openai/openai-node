/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import type * as fd from 'formdata-node';

const _FormData: typeof fd.FormData =
  // @ts-ignore
  FormData as any;
type _FormData = fd.FormData;
const _File: typeof fd.File =
  // @ts-ignore
  File as any;
type _File = fd.File;
const _Blob: typeof fd.Blob =
  // @ts-ignore
  Blob as any;
type _Blob = fd.Blob;

export const isPolyfilled = false;

export { _FormData as FormData, _File as File, _Blob as Blob };
