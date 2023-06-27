/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { ReadStream } from 'node:fs';
import {
  BlobPart,
  Uploadable,
  BlobLike,
  FileLike,
  ResponseLike,
  isBlobLike,
  isFileLike,
  isResponseLike,
} from './uploadable';

export { BlobPart, BlobLike, FileLike, ResponseLike, isBlobLike, Uploadable };

export const isUploadable = (value: any): value is Uploadable => {
  return isFileLike(value) || isResponseLike(value) || value instanceof ReadStream;
};
