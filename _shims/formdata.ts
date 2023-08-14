type _BlobPropertyBag = BlobPropertyBag;
type _FilePropertyBag = FilePropertyBag;

const _FormData = FormData;
const _File = File;
const _Blob = Blob;

export const isPolyfilled = false;

export {
  _Blob as Blob,
  type _BlobPropertyBag as BlobPropertyBag,
  _File as File,
  type _FilePropertyBag as FilePropertyBag,
  _FormData as FormData,
};
