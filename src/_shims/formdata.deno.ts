type _BlobPropertyBag = BlobPropertyBag;
type _FilePropertyBag = FilePropertyBag;

const _FormData = FormData;
const _File = File;
const _Blob = Blob;

export const isPolyfilled = false;

export {
  _FormData as FormData,
  _File as File,
  _Blob as Blob,
  type _BlobPropertyBag as BlobPropertyBag,
  type _FilePropertyBag as FilePropertyBag,
};
