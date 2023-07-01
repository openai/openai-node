/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import type { BlobPart } from '../uploads';

type EndingType = 'native' | 'transparent';

export interface BlobPropertyBag {
  endings?: EndingType;
  type?: string;
}

export interface FilePropertyBag extends BlobPropertyBag {
  lastModified?: number;
}

// Use builtin web types if present; else never (user should
// add appropriate lib or types to tsconfig)

// @ts-ignore
type _FormData = unknown extends FormData ? never : FormData;
// @ts-ignore
type _File = unknown extends File ? never : File;
// @ts-ignore
type _Blob = unknown extends Blob ? never : Blob;

declare const _FormData: {
  new (form?: any): _FormData;
  prototype: _FormData;
};
declare const _File: {
  new (fileBits: BlobPart[], fileName: string, options?: FilePropertyBag | undefined): _File;
  prototype: _File;
};
declare const _Blob: {
  new (blobParts?: BlobPart[] | undefined, options?: BlobPropertyBag | undefined): _Blob;
  prototype: _Blob;
};

export const isPolyfilled = false;

export { _FormData as FormData, _File as File, _Blob as Blob };
