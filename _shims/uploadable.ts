/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import type * as fs from 'node:fs';
import type { toFile } from 'openai/_shims/toFile'; // eslint-disable-line

export type BlobPart = string | ArrayBuffer | ArrayBufferView | BlobLike | Uint8Array | DataView;

/**
 * Typically, this is a native "File" class.
 *
 * We provide the {@link toFile} utility to convert a variety of objects
 * into the File class.
 *
 * For convenience, you can also pass a fetch Response
 * or, on Node, the result of {@link fs.createReadStream}('./myfile').
 */
export type Uploadable = FileLike | ResponseLike | fs.ReadStream;

/**
 * Intended to match web.Blob, node.Blob, node-fetch.Blob, etc.
 */
export interface BlobLike {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/size) */
  readonly size: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/type) */
  readonly type: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/text) */
  text(): Promise<string>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/slice) */
  slice(start?: number, end?: number): BlobLike;
  // unfortunately @types/node-fetch@^2.6.4 doesn't type the arrayBuffer method
}

/**
 * Intended to match web.File, node.File, node-fetch.File, etc.
 */
export interface FileLike extends BlobLike {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/lastModified) */
  readonly lastModified: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/name) */
  readonly name: string;
}

/**
 * Intended to match web.Response, node.Response, node-fetch.Response, etc.
 */
export interface ResponseLike {
  url: string;
  blob(): Promise<BlobLike>;
}

export const isResponseLike = (value: any): value is ResponseLike =>
  value != null &&
  typeof value === 'object' &&
  typeof value.url === 'string' &&
  typeof value.blob === 'function';

export const isFileLike = (value: any): value is FileLike =>
  value != null &&
  typeof value === 'object' &&
  typeof value.name === 'string' &&
  typeof value.lastModified === 'number' &&
  isBlobLike(value);

/**
 * The BlobLike type omits arrayBuffer() because @types/node-fetch@^2.6.4 lacks it; but this check
 * adds the arrayBuffer() method type because it is available and used at runtime
 */
export const isBlobLike = (value: any): value is BlobLike & { arrayBuffer(): Promise<ArrayBuffer> } =>
  value != null &&
  typeof value === 'object' &&
  typeof value.size === 'number' &&
  typeof value.type === 'string' &&
  typeof value.text === 'function' &&
  typeof value.slice === 'function' &&
  typeof value.arrayBuffer === 'function';

export const isUploadable = (value: any): value is Uploadable => {
  return isFileLike(value) || isResponseLike(value);
};
