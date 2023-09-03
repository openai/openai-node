type _BlobPropertyBag = BlobPropertyBag;
type _FilePropertyBag = FilePropertyBag;

const _FormData = FormData;
type _FormData = FormData;
const _File = File;
type _File = File;
const _Blob = Blob;
type _Blob = Blob;

export const isPolyfilled = false;

export {
  _FormData as FormData,
  _File as File,
  _Blob as Blob,
  type _BlobPropertyBag as BlobPropertyBag,
  type _FilePropertyBag as FilePropertyBag,
};
