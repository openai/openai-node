/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 *
 * This is a stub that gets replaced by fileFromPath.node.js for node environments
 * in the package export map
 */

import type { FilePropertyBag } from 'formdata-node';
import type { File } from './formdata';

export type FileFromPathOptions = Omit<FilePropertyBag, 'lastModified'>;

/**
 * This is a stub for non-node environments that just throws an error.
 * In node environments, this module will be replaced by util/node/fileFromPath by the
 * package import map.
 */
export async function fileFromPath(path: string): Promise<File>;
export async function fileFromPath(path: string, filename?: string): Promise<File>;
export async function fileFromPath(path: string, options?: FileFromPathOptions): Promise<File>;
export async function fileFromPath(
  path: string,
  filename?: string,
  options?: FileFromPathOptions,
): Promise<File>;
export async function fileFromPath(): Promise<File> {
  throw new Error(
    'The `fileFromPath` function is only supported in Node. See the README for more details: https://www.github.com/openai/openai-node#file-uploads',
  );
}
