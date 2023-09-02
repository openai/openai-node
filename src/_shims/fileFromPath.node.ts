/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { fileFromPath as _fileFromPath } from 'formdata-node/file-from-path';
import type { File, FilePropertyBag } from './formdata.node';

export type FileFromPathOptions = Omit<FilePropertyBag, 'lastModified'>;

let warned = false;

/**
 * @deprecated use fs.createReadStream('./my/file.txt') instead
 */
export async function fileFromPath(path: string): Promise<File>;
export async function fileFromPath(path: string, filename?: string): Promise<File>;
export async function fileFromPath(path: string, options?: FileFromPathOptions): Promise<File>;
export async function fileFromPath(
  path: string,
  filename?: string,
  options?: FileFromPathOptions,
): Promise<File>;
export async function fileFromPath(path: string, ...args: any[]): Promise<File> {
  if (!warned) {
    console.warn(`fileFromPath is deprecated; use fs.createReadStream(${JSON.stringify(path)}) instead`);
    warned = true;
  }
  return await _fileFromPath(path, ...args);
}
