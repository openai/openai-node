import { getBuiltinModule } from './getBuiltinModule';

export let getFile = function lazyGetFile(): FileConstructor {
  if (getFile !== lazyGetFile) return getFile();
  // We can drop getBuiltinModule once we no longer support Node < 20.0.0
  const File = (globalThis as any).File ?? (getBuiltinModule?.('node:buffer') as any)?.File;
  if (!File) throw new Error('`File` is not defined as a global, which is required for file uploads.');
  getFile = () => File;
  return File;
};

type FileConstructor =
  typeof globalThis extends { File: infer fileConstructor } ? fileConstructor : typeof FallbackFile;
export type File = InstanceType<FileConstructor>;

// The infer is to make TS show it as a nice union type,
// instead of literally `ConstructorParameters<typeof Blob>[0]`
type FallbackBlobSource = ConstructorParameters<typeof Blob>[0] extends infer T ? T : never;
/**
 * A [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) provides information about files.
 */
declare class FallbackFile extends Blob {
  constructor(sources: FallbackBlobSource, fileName: string, options?: any);
  /**
   * The name of the `File`.
   */
  readonly name: string;
  /**
   * The last modified date of the `File`.
   */
  readonly lastModified: number;
}
