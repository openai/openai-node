import type { BlobPart } from './uploads';
import { getName, makeFile, isAsyncIterable, checkFileSupport } from './uploads';
import type { FilePropertyBag } from './builtin-types';

/** Text, binary content, or a Blob-compatible value accepted inside a file stream. */
type BlobLikePart = string | ArrayBuffer | ArrayBufferView | BlobLike | DataView;

/**
 * Structural Blob compatibility across DOM, `node-fetch`, and Node.js runtimes.
 *
 * `arrayBuffer()` is intentionally checked separately because some older
 * third-party Blob types do not declare it.
 */
interface BlobLike {
  /** Size of the Blob contents in bytes. */
  readonly size: number;

  /** MIME type associated with the Blob contents, or an empty string. */
  readonly type: string;

  /** Reads the Blob contents as UTF-8 text. */
  text(): Promise<string>;

  /** Returns a Blob-compatible view of the requested byte range. */
  slice(start?: number, end?: number): BlobLike;
}

/**
 * This check adds the arrayBuffer() method type because it is available and used at runtime
 */
const isBlobLike = (value: any): value is BlobLike & { arrayBuffer(): Promise<ArrayBuffer> } =>
  value != null &&
  typeof value === 'object' &&
  typeof value.size === 'number' &&
  typeof value.type === 'string' &&
  typeof value.text === 'function' &&
  typeof value.slice === 'function' &&
  typeof value.arrayBuffer === 'function';

/**
 * Structural File compatibility across DOM, `node:buffer`, and `undici` runtimes.
 */
interface FileLike extends BlobLike {
  /** Last modification time as milliseconds since the Unix epoch. */
  readonly lastModified: number;

  /** Filename associated with the underlying File-compatible object. */
  readonly name?: string | undefined;
}

/**
 * This check adds the arrayBuffer() method type because it is available and used at runtime
 */
const isFileLike = (value: any): value is FileLike & { arrayBuffer(): Promise<ArrayBuffer> } =>
  value != null &&
  typeof value === 'object' &&
  typeof value.name === 'string' &&
  typeof value.lastModified === 'number' &&
  isBlobLike(value);

/**
 * Structural fetch-response compatibility across browser and server runtimes.
 */
export interface ResponseLike {
  /** Absolute response URL used to infer a filename from its final path segment. */
  url: string;

  /** Reads the response body into a Blob-compatible value. */
  blob(): Promise<BlobLike>;
}

const isResponseLike = (value: any): value is ResponseLike =>
  value != null &&
  typeof value === 'object' &&
  typeof value.url === 'string' &&
  typeof value.blob === 'function';

const hasFilePropertyOverrides = (value: FileLike, options: FilePropertyBag | undefined): boolean =>
  (options?.type != null && options.type !== value.type) ||
  (options?.lastModified != null && options.lastModified !== value.lastModified) ||
  options?.endings != null;

const canReuseNativeFile = (
  value: File,
  name: string | null | undefined,
  options: FilePropertyBag | undefined,
): boolean => (name == null || name === value.name) && !hasFilePropertyOverrides(value, options);

/**
 * File-compatible values that can be buffered into a native `File`.
 *
 * Includes existing files, fetch responses, binary buffers, Blob-compatible
 * values, and async streams of file parts. Top-level strings are intentionally
 * excluded so filesystem paths are not accidentally treated as file contents.
 */
export type ToFileInput =
  | FileLike
  | ResponseLike
  | Exclude<BlobLikePart, string>
  | AsyncIterable<BlobLikePart>;

/**
 * Buffers compatible content into a native {@link File} for an SDK upload.
 *
 * Existing native `File` objects are returned unchanged when their effective
 * filename and metadata are unchanged. Renamed native files reuse the original
 * file contents without buffering and retain their MIME type and modification
 * time unless explicitly overridden. Other filenames are inferred from response
 * URLs or input metadata when omitted, falling back to `unknown_file`. Responses,
 * native or compatible `Blob` values, and compatible non-native files supply
 * their MIME type unless `options.type` provides an explicit override.
 *
 * @param value An existing file, response, binary buffer, Blob-like object, async
 * stream of file parts, or a promise resolving to one of those values.
 * @param name Optional filename overriding inferred metadata or an existing filename.
 * @param options Optional file metadata, including MIME type and modification time.
 * @returns A native `File` containing the complete buffered input.
 * @throws {Error} If the runtime lacks a global `File` constructor or the input
 * cannot be converted into file contents.
 */
export async function toFile(
  value: ToFileInput | PromiseLike<ToFileInput>,
  name?: string | null | undefined,
  options?: FilePropertyBag | undefined,
): Promise<File> {
  checkFileSupport();

  // If it's a promise, resolve it.
  value = await value;

  if (isFileLike(value)) {
    const fileOptions = {
      ...options,
      type: options?.type ?? value.type,
      lastModified: options?.lastModified ?? value.lastModified,
    };

    if (value instanceof File) {
      if (canReuseNativeFile(value, name, options)) {
        return value;
      }

      return makeFile([value], name ?? value.name, fileOptions);
    }

    return makeFile([await value.arrayBuffer()], name ?? value.name, fileOptions);
  }

  if (isResponseLike(value)) {
    const blob = await value.blob();
    name ||= getName(value);

    const responseOptions =
      options?.type === undefined && blob.type ? { ...options, type: blob.type } : options;
    return makeFile(await getBytes(blob), name, responseOptions);
  }

  const parts = await getBytes(value);

  name ||= getName(value);

  if (options?.type === undefined) {
    const typedPart = parts.find(
      (part): part is Blob => typeof part === 'object' && 'type' in part && !!part.type,
    );
    if (typedPart) {
      options = { ...options, type: typedPart.type };
    }
  }

  return makeFile(parts, name, options);
}

async function getBytes(value: BlobLikePart | AsyncIterable<BlobLikePart>): Promise<BlobPart[]> {
  const parts: BlobPart[] = [];
  if (
    typeof value === 'string' ||
    ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
    value instanceof ArrayBuffer
  ) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : new Blob([await value.arrayBuffer()], { type: value.type }));
  } else if (
    isAsyncIterable(value) // includes Readable, ReadableStream, etc.
  ) {
    for await (const chunk of value) {
      parts.push(...(await getBytes(chunk as BlobLikePart)));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(
      `Unexpected data type: ${typeof value}${
        constructor ? `; constructor: ${constructor}` : ''
      }${propsForError(value)}`,
    );
  }

  return parts;
}

function propsForError(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(', ')}]`;
}
