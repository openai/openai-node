/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { File } from 'formdata-node';
import { type ToFileInput, newFileArgs, type FilePropertyBag } from './newFileArgs';
import type { Uploadable, BlobPart, FileLike } from './uploadable.node'; // eslint-disable-line

/**
 * Helper for creating a {@link File} to pass to an SDK upload method from a variety of different data formats
 * @param bits the raw content of the file.  Can be an {@link Uploadable}, {@link BlobPart}, or {@link AsyncIterable} of {@link BlobPart}s
 * @param name the name of the file. If omitted, toFile will try to determine a file name from bits if possible
 * @param {Object=} options additional properties
 * @param {string=} options.type the MIME type of the content
 * @param {number=} options.lastModified the last modified timestamp
 * @returns a {@link File} with the given properties
 */
export async function toFile(
  bits: ToFileInput,
  name?: string | null | undefined,
  options: FilePropertyBag | undefined = {},
): Promise<FileLike> {
  const args = await newFileArgs(bits, name, options);
  return new File(args.bits, args.name, args.options);
}
