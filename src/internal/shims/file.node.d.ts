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
export type File = InstanceType<typeof File>;
export const File: typeof globalThis extends { File: infer fileConstructor } ? fileConstructor
: typeof FallbackFile;
