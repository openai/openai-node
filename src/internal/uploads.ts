import type { RequestOptions } from './request-options';
import type { FilePropertyBag, Fetch } from './builtin-types';
import type { OpenAI } from '../client';
import { buildHeaders } from './headers';
import { ReadableStreamFrom, ReadableStreamToAsyncIterable } from './shims';
import type { ReadableStream } from './shim-types';
import { encodeUTF8 } from './utils/bytes';

/** Text, binary data, or a blob that can contribute bytes to an uploaded file. */
export type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob | DataView;

/** Node.js-compatible byte stream carrying the source path used to infer a filename. */
type FsReadStream = AsyncIterable<Uint8Array> & {
  /** Source filesystem path, represented as a string or path-like object. */
  path:
    | string
    | {
        /** Converts the path-like value into its filesystem path. */
        toString(): string;
      };
};

/** Asynchronous chunks consumed lazily while encoding a streaming multipart upload. */
export type StreamingFileInput = AsyncIterable<BlobPart> | ReadableStream<BlobPart>;

const brand_privateStreamingFile = /* @__PURE__ */ Symbol('brand.privateStreamingFile');

/**
 * A file whose contents are read lazily while the multipart request is sent.
 * Create one with {@link toStreamingFile} when buffering an upload into a `File` is undesirable.
 */
export interface StreamingFile {
  /** Ensures streaming files are created with a filename through {@link toStreamingFile}. */
  readonly [brand_privateStreamingFile]: true;

  /** Source chunks read incrementally as the multipart request body is transmitted. */
  readonly data: StreamingFileInput;

  /**
   * Filename supplied for the multipart part. Most endpoints send only its basename;
   * endpoints that accept logical paths, such as Skills, preserve a normalized path.
   */
  readonly name: string;

  /** Optional MIME type; defaults to `application/octet-stream` when omitted. */
  readonly type?: string | undefined;
}

/**
 * Wrap a stream as an uploadable file without reading it into memory.
 *
 * Unlike {@link toFile}, this helper does not create a web `File`, because the `File` constructor
 * must consume all of its contents up front. The stream is instead encoded lazily as multipart
 * form data when the request is sent.
 *
 * @param data Async-iterable or readable-stream chunks containing text, binary data, or blobs.
 * @param name Non-empty filename for the multipart request. Most endpoints send only its basename;
 * endpoints that accept logical paths, such as Skills, preserve a normalized path.
 * @param options Optional MIME type for the streaming file.
 * @throws {TypeError} If `name` is not a non-empty string or the content type contains control characters.
 */
export function toStreamingFile(
  data: StreamingFileInput,
  name: string,
  options?: Pick<FilePropertyBag, 'type'>,
): StreamingFile {
  validateStreamingFileName(name);

  const type = options?.type;
  if (type) {
    validateStreamingFileType(type);
  }

  return {
    [brand_privateStreamingFile]: true,
    data,
    name,
    ...(type ? { type } : {}),
  };
}

/**
 * Bun file compatibility shape for file objects whose names are optional in their types.
 *
 * @see https://github.com/oven-sh/bun/issues/5980
 */
interface BunFile extends Blob {
  /** Filename exposed by Bun when one is available. */
  readonly name?: string | undefined;
}

/** Blob-compatible upload value that exposes a filename at runtime. */
type NamedBlob = Blob & {
  /** Filename supplied by a native `File` or another named Blob implementation. */
  readonly name?: string | undefined;
};

/**
 * Verifies that the current runtime exposes the global `File` constructor.
 *
 * @throws {Error} If `File` is unavailable; older Node.js runtimes receive an
 * additional upgrade or `node:buffer` compatibility suggestion.
 */
export const checkFileSupport = () => {
  if (typeof File === 'undefined') {
    const { process } = globalThis as any;
    const isOldNode =
      typeof process?.versions?.node === 'string' &&
      Number.parseInt(process.versions.node.split('.'), 10) < 20;
    throw new Error(
      '`File` is not defined as a global, which is required for file uploads.' +
        (isOldNode
          ? " Update to a supported Node.js LTS release, or set `globalThis.File` to `import('node:buffer').File`."
          : ''),
    );
  }
};

/**
 * Values accepted by SDK methods that upload multipart files.
 *
 * Supports native files, fetch responses, named blobs, Node.js filesystem read
 * streams, async byte sources, web readable streams, and files created with
 * {@link toStreamingFile}. Use {@link toFile} to materialize compatible content
 * as a native `File` when buffering the complete upload is acceptable.
 */
export type Uploadable =
  | File
  | Response
  | FsReadStream
  | BunFile
  | NamedBlob
  | AsyncIterable<BlobPart>
  | ReadableStream<BlobPart>
  | StreamingFile;

/**
 * Construct a `File` instance. This is used to ensure a helpful error is thrown
 * for environments that don't define a global `File` yet.
 *
 * A missing filename becomes `unknown_file`.
 */
export function makeFile(
  fileBits: BlobPart[],
  fileName: string | undefined,
  options?: FilePropertyBag,
): File {
  checkFileSupport();
  return new File(fileBits as any, fileName ?? 'unknown_file', options);
}

/**
 * Infers a filename from an object's `name`, `url`, `filename`, or `path` value.
 *
 * Directory components separated by either `/` or `\\` are discarded unless an
 * explicitly supplied `name` or `filename` opts into preserving its path. Preserved
 * paths use forward slashes. Paths inferred from URLs and filesystem streams always
 * discard their directories.
 */
export function getName(value: any, options?: { stripFilename?: boolean | undefined }): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const explicitName =
    ('name' in value && value.name && String(value.name)) ||
    ('filename' in value && value.filename && String(value.filename));
  if (explicitName) {
    return options?.stripFilename === false ? normalizeFilenamePath(explicitName) : basename(explicitName);
  }

  const url = 'url' in value && value.url && String(value.url);
  if (url) {
    try {
      return basename(new URL(url).pathname);
    } catch {
      return basename(url);
    }
  }

  const path = 'path' in value && value.path && String(value.path);
  return path ? basename(path) : undefined;
}

function basename(value: string): string | undefined {
  const name = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/^[A-Za-z]:/, '');
  return name || undefined;
}

function normalizeFilenamePath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Identifies objects that expose a callable `Symbol.asyncIterator` method. */
export const isAsyncIterable = (value: any): value is AsyncIterable<any> =>
  value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';

/**
 * Converts a request to multipart form data when its body contains an upload.
 *
 * Uploads include files, named blobs, responses, async iterables, readable
 * streams, and {@link StreamingFile} values anywhere in a nested body. Bodies
 * containing streaming values are encoded lazily; other uploads use `FormData`.
 * Requests without uploads are returned unchanged.
 */
export const maybeMultipartFormRequestOptions = async (
  opts: RequestOptions,
  fetch: OpenAI | Fetch,
  formOptions?: CreateFormOptions,
): Promise<RequestOptions> => {
  const uploadableKinds = new WeakMap<object, UploadableKind>();

  if (!hasUploadableValue(opts.body, uploadableKinds)) {
    return opts;
  }

  if (hasStreamingUploadableValue(opts.body, uploadableKinds)) {
    return createStreamingFormRequestOptions(opts, uploadableKinds, formOptions);
  }

  return { ...opts, body: await createForm(opts.body, fetch, formOptions) };
};

/** Request options whose body must be encoded as multipart form data. */
type MultipartFormRequestOptions = Omit<RequestOptions, 'body'> & {
  /** Nested fields and upload values to encode into the multipart request body. */
  body: unknown;
};

/**
 * Encodes a request body as multipart form data even when no file is present.
 *
 * Streaming uploads produce a lazy multipart `ReadableStream` and an explicit
 * boundary header; other values are materialized into platform `FormData`.
 */
export const multipartFormRequestOptions = async (
  opts: MultipartFormRequestOptions,
  fetch: OpenAI | Fetch,
  formOptions?: CreateFormOptions,
): Promise<RequestOptions> => {
  const uploadableKinds = new WeakMap<object, UploadableKind>();

  if (hasStreamingUploadableValue(opts.body, uploadableKinds)) {
    return createStreamingFormRequestOptions(opts, uploadableKinds, formOptions);
  }

  return { ...opts, body: await createForm(opts.body, fetch, formOptions) };
};

const supportsFormDataMap = /* @__PURE__ */ new WeakMap<Fetch, Promise<boolean>>();

/**
 * node-fetch doesn't support the global FormData object in recent node versions. Instead of sending
 * properly-encoded form data, it just stringifies the object, resulting in a request body of "[object FormData]".
 * This function detects if the fetch function provided supports the global FormData object to avoid
 * confusing error messages later on.
 */
function supportsFormData(fetchObject: OpenAI | Fetch): Promise<boolean> {
  const fetch: Fetch = typeof fetchObject === 'function' ? fetchObject : (fetchObject as any).fetch;
  const cached = supportsFormDataMap.get(fetch);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    try {
      let FetchResponse: typeof Response;
      if ('Response' in fetch) {
        FetchResponse = fetch.Response as typeof Response;
      } else {
        const response = await fetch('data:,');
        await response.arrayBuffer();
        FetchResponse = response.constructor as typeof Response;
      }
      const data = new FormData();
      if (data.toString() === (await new FetchResponse(data).text())) {
        return false;
      }
      return true;
    } catch {
      // avoid false negatives
      return true;
    }
  })();
  supportsFormDataMap.set(fetch, promise);
  return promise;
}

/** Controls whether explicitly supplied multipart filenames retain directory components. */
export type CreateFormOptions = {
  /** Keep directories in explicit filenames when false; inferred paths remain basename-only. */
  stripFilenames?: boolean;
};

/**
 * Materializes an object into platform `FormData` after verifying fetch support.
 *
 * Strings, numbers, and booleans become text fields; responses, named blobs,
 * and async byte sources become file fields. Arrays and nested objects use
 * bracketed field names, while `undefined` values are omitted.
 *
 * @throws {TypeError} If the fetch implementation cannot encode global
 * `FormData`, a field is `null`, or a field has an unsupported value.
 */
export const createForm = async <T = Record<string, unknown>>(
  body: T | undefined,
  fetch: OpenAI | Fetch,
  options: CreateFormOptions = {},
): Promise<FormData> => {
  if (!(await supportsFormData(fetch))) {
    throw new TypeError(
      'The provided fetch function does not support file uploads with the current global FormData class.',
    );
  }
  const form = new FormData();
  await Promise.all(
    Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value, options)),
  );
  return form;
};

// We check for Blob not File because Bun.File doesn't inherit from File,
// but they both inherit from Blob and have a `name` property at runtime.
const isNamedBlob = (value: unknown): value is NamedBlob => value instanceof Blob && 'name' in value;

const isReadableStream = (value: unknown): value is ReadableStream<BlobPart> =>
  typeof value === 'object' &&
  value !== null &&
  'getReader' in value &&
  typeof value.getReader === 'function';

const isStreamingFile = (value: unknown): value is StreamingFile =>
  typeof value === 'object' && value !== null && brand_privateStreamingFile in value;

type UploadableKind = 'upload' | 'streaming-upload' | 'streaming-file' | undefined;
type UploadableKinds = WeakMap<object, UploadableKind>;

const getUploadableKind = (value: unknown, uploadableKinds: UploadableKinds): UploadableKind => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (uploadableKinds.has(value)) {
    const cached = uploadableKinds.get(value);
    if (cached === 'streaming-file') {
      return cached;
    }
    if (isStreamingFile(value)) {
      uploadableKinds.set(value, 'streaming-file');
      return 'streaming-file';
    }
    if (cached === 'streaming-upload') {
      return cached;
    }
    if (isAsyncIterable(value) || isReadableStream(value)) {
      uploadableKinds.set(value, 'streaming-upload');
      return 'streaming-upload';
    }
    return cached;
  }

  let uploadableKind: UploadableKind;

  if (isStreamingFile(value)) {
    uploadableKind = 'streaming-file';
  } else if (isAsyncIterable(value) || isReadableStream(value)) {
    uploadableKind = 'streaming-upload';
  } else if (value instanceof Response || isNamedBlob(value)) {
    uploadableKind = 'upload';
  }

  if (uploadableKind) {
    uploadableKinds.set(value, uploadableKind);
  }

  return uploadableKind;
};

const isUploadable = (value: unknown, uploadableKinds: UploadableKinds): value is Uploadable =>
  getUploadableKind(value, uploadableKinds) !== undefined;

const hasStreamingUploadableValue = (value: unknown, uploadableKinds: UploadableKinds): boolean => {
  const uploadableKind = getUploadableKind(value, uploadableKinds);

  if (uploadableKind === 'streaming-file' || uploadableKind === 'streaming-upload') {
    return true;
  }
  if (uploadableKind === 'upload') {
    return false;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (hasStreamingUploadableValue(entry, uploadableKinds)) {
        return true;
      }
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (hasStreamingUploadableValue((value as Record<string, unknown>)[key], uploadableKinds)) {
        return true;
      }
    }
  }
  return false;
};

const hasUploadableValue = (value: unknown, uploadableKinds: UploadableKinds): boolean => {
  if (isUploadable(value, uploadableKinds)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasUploadableValue(entry, uploadableKinds));
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (hasUploadableValue((value as Record<string, unknown>)[key], uploadableKinds)) {
        return true;
      }
    }
  }
  return false;
};

type FormEntry =
  | Readonly<{ key: string; value: string | number | boolean; kind: 'field'; streamingFile: false }>
  | Readonly<{
      key: string;
      value: Uploadable;
      data: unknown;
      dispose?: (() => void) | undefined;
      filename: string;
      kind: 'upload';
      streamingFile: boolean;
      type: string;
    }>;

type MultipartEntry = FormEntry;

type MultipartDataSnapshot = Readonly<{
  data: StreamingFileInput;
  dispose?: (() => void) | undefined;
}>;

function isNativeReadableStream(value: StreamingFileInput): boolean {
  if (typeof globalThis.ReadableStream !== 'function') {
    return false;
  }

  try {
    const getLocked = Object.getOwnPropertyDescriptor(globalThis.ReadableStream.prototype, 'locked')?.get;
    return typeof getLocked?.call(value) === 'boolean';
  } catch {
    // Ordinary async iterables and reader-like objects do not satisfy the native stream brand.
    return false;
  }
}

async function ignoreCleanupResult(cleanup: () => unknown): Promise<void> {
  try {
    await cleanup();
  } catch {
    // Cleanup failures must not mask the primary multipart result.
  }
}

function snapshotStreamingFileData(
  value: StreamingFileInput,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const cached = snapshots.get(value);
  if (cached) {
    return cached;
  }

  const { [Symbol.asyncIterator]: createIterator } = value as AsyncIterable<BlobPart>;
  if (typeof createIterator === 'function') {
    const iterator = createIterator.call(value);
    const { next } = iterator;
    let consumed = false;
    const snapshot: MultipartDataSnapshot = {
      data: {
        [Symbol.asyncIterator]() {
          consumed = true;
          return {
            next(...args: [] | [undefined]) {
              return next.call(iterator, ...args);
            },
            return(...args: [] | [unknown]) {
              const returnIterator = iterator.return;
              return returnIterator
                ? returnIterator.call(iterator, ...args)
                : Promise.resolve({ done: true as const, value: args[0] });
            },
            [Symbol.asyncIterator]() {
              return this;
            },
          };
        },
      },
      dispose() {
        if (!consumed) {
          consumed = true;
          void ignoreCleanupResult(() => iterator.return?.());
        }
      },
    };
    if (isNativeReadableStream(value)) {
      snapshots.set(value, snapshot);
    }
    return snapshot;
  }

  const { getReader } = value as ReadableStream<BlobPart>;
  if (typeof getReader === 'function') {
    const reader = getReader.call(value) as ReadableStreamDefaultReader<BlobPart>;
    let read: ReadableStreamDefaultReader<BlobPart>['read'];
    try {
      ({ read } = reader);
    } catch (error) {
      void ignoreCleanupResult(() => reader.cancel());
      try {
        reader.releaseLock();
      } catch {
        // Cleanup failures must not mask the primary multipart result.
      }
      throw error;
    }
    const capturedReader = {
      read: () => read.call(reader),
      cancel: () => reader.cancel(),
      releaseLock: () => reader.releaseLock(),
    };
    let consumed = false;
    const snapshot: MultipartDataSnapshot = {
      data: {
        async *[Symbol.asyncIterator]() {
          if (consumed) {
            return;
          }
          consumed = true;
          yield* ReadableStreamToAsyncIterable<BlobPart>({ getReader: () => capturedReader });
        },
      },
      dispose() {
        if (!consumed) {
          consumed = true;
          void ignoreCleanupResult(() => reader.cancel());
          try {
            reader.releaseLock();
          } catch {
            // Cleanup failures must not mask the primary multipart result.
          }
        }
      },
    };
    if (isNativeReadableStream(value)) {
      snapshots.set(value, snapshot);
    }
    return snapshot;
  }

  throw new TypeError('Streaming file data must be an async iterable or readable stream');
}

function snapshotBlobData(
  value: Blob,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const { stream } = value as Blob & { stream?: Blob['stream'] };
  if (typeof stream === 'function') {
    return snapshotStreamingFileData(stream.call(value) as ReadableStream<BlobPart>, snapshots);
  }

  const immutableBlob = Blob.prototype.slice.call(value);
  const { arrayBuffer: readImmutableBlob } = Blob.prototype;
  const { arrayBuffer: read } = value;
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        if (read === readImmutableBlob) {
          yield await read.call(value);
        } else {
          await read.call(value);
          yield await readImmutableBlob.call(immutableBlob);
        }
      },
    },
  };
}

function snapshotResponseData(
  value: Response,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): MultipartDataSnapshot {
  const { body } = value;
  if (body) {
    return snapshotStreamingFileData(body, snapshots);
  }

  const blob = value.blob();
  void ignoreCleanupResult(() => blob);
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        yield await blob;
      },
    },
  };
}

const createStreamingFormRequestOptions = (
  opts: RequestOptions,
  uploadableKinds: UploadableKinds,
  options: CreateFormOptions = {},
): RequestOptions => {
  const boundary = `openai-${Math.random().toString(36).slice(2)}`;
  const body = ReadableStreamFrom(iterateMultipartBody(opts.body, boundary, options, uploadableKinds), {
    highWaterMark: 0,
  });

  return {
    ...opts,
    body,
    headers: buildHeaders([{ 'content-type': `multipart/form-data; boundary=${boundary}` }, opts.headers]),
  };
};

async function* iterateMultipartBody(
  body: unknown,
  boundary: string,
  options: CreateFormOptions,
  uploadableKinds: UploadableKinds,
): AsyncGenerator<Uint8Array> {
  const entries: MultipartEntry[] = [];
  const pendingDisposals = new Set<() => void>();
  const snapshots = new WeakMap<object, MultipartDataSnapshot>();

  try {
    for await (const entry of iterateFormEntries(body, uploadableKinds, options, snapshots)) {
      if (entry.kind === 'upload' && entry.dispose) {
        pendingDisposals.add(entry.dispose);
      }
      entries.push(entry);
    }

    for (const entry of entries) {
      const { key, value } = entry;

      if (entry.kind === 'upload') {
        const { filename } = entry;
        yield encodeUTF8(`--${boundary}\r\n`);
        yield encodeUTF8(
          `Content-Disposition: form-data; name="${escapeHeaderValue(key)}"; filename="${escapeHeaderValue(
            filename,
          )}"\r\nContent-Type: ${entry.type}\r\n\r\n`,
        );
        yield* iterateBytes(entry.data);
        if (entry.dispose) {
          pendingDisposals.delete(entry.dispose);
        }
      } else {
        yield encodeUTF8(`--${boundary}\r\n`);
        yield encodeUTF8(
          `Content-Disposition: form-data; name="${escapeHeaderValue(key)}"\r\n\r\n${String(value)}`,
        );
      }
      yield encodeUTF8('\r\n');
    }
    yield encodeUTF8(`--${boundary}--\r\n`);
  } finally {
    for (const dispose of pendingDisposals) {
      dispose();
    }
  }
}

async function* iterateFormEntries(
  body: unknown,
  uploadableKinds: UploadableKinds,
  options: CreateFormOptions,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): AsyncGenerator<FormEntry> {
  if (!body || typeof body !== 'object') {
    return;
  }

  for (const key of Object.keys(body)) {
    yield* iterateFormValue(key, (body as Record<string, unknown>)[key], uploadableKinds, options, snapshots);
  }
}

async function* iterateFormValue(
  key: string,
  value: unknown,
  uploadableKinds: UploadableKinds,
  options: CreateFormOptions,
  snapshots: WeakMap<object, MultipartDataSnapshot>,
): AsyncGenerator<FormEntry> {
  if (value === undefined) {
    return;
  }
  if (value == null) {
    throw new TypeError(
      `Received null for "${key}"; to pass null in FormData, you must use the string 'null'`,
    );
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    yield { key, value, kind: 'field', streamingFile: false };
    return;
  }

  const wasClassified = typeof value === 'object' && uploadableKinds.has(value);
  let uploadKind = getUploadableKind(value, uploadableKinds);
  if (!wasClassified && uploadKind !== 'streaming-file') {
    uploadKind = getUploadableKind(value, uploadableKinds);
  }
  if (uploadKind) {
    const upload = value as Uploadable;
    const streamingFile = uploadKind === 'streaming-file';
    const filename = getStreamingFileName(upload, options, streamingFile);
    const type = getStreamingFileType(upload, streamingFile);
    let snapshot: MultipartDataSnapshot;
    if (streamingFile) {
      snapshot = snapshotStreamingFileData((upload as StreamingFile).data, snapshots);
    } else if (upload instanceof Response) {
      snapshot = snapshotResponseData(upload, snapshots);
    } else if (upload instanceof Blob) {
      snapshot = snapshotBlobData(upload, snapshots);
    } else {
      snapshot = snapshotStreamingFileData(upload as StreamingFileInput, snapshots);
    }
    yield {
      key,
      value: upload,
      data: snapshot.data,
      dispose: snapshot.dispose,
      filename,
      kind: 'upload',
      streamingFile,
      type,
    };
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      yield* iterateFormValue(key + '[]', entry, uploadableKinds, options, snapshots);
    }
  } else if (typeof value === 'object') {
    for (const name of Object.keys(value)) {
      yield* iterateFormValue(
        `${key}[${name}]`,
        (value as Record<string, unknown>)[name],
        uploadableKinds,
        options,
        snapshots,
      );
    }
  } else {
    throw new TypeError(
      `Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`,
    );
  }
}

function validateStreamingFileName(name: unknown): string {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('toStreamingFile requires a non-empty file name');
  }

  return name;
}

function getStreamingFileName(value: Uploadable, options: CreateFormOptions, streamingFile: boolean): string {
  const source = streamingFile ? { name: validateStreamingFileName((value as StreamingFile).name) } : value;

  return getName(source, { stripFilename: options.stripFilenames }) ?? 'unknown_file';
}

function getStreamingFileType(value: Uploadable, streamingFile: boolean): string {
  let type: string | undefined;

  if (streamingFile || isNamedBlob(value)) {
    ({ type } = value as StreamingFile | NamedBlob);
  } else if (value instanceof Response) {
    type = value.headers.get('content-type') ?? undefined;
  }

  return validateStreamingFileType(type || 'application/octet-stream');
}

function validateStreamingFileType(type: string): string {
  if (typeof type !== 'string') {
    throw new TypeError('Streaming upload content type must be a string');
  }

  for (let index = 0; index < type.length; index += 1) {
    const character = type.codePointAt(index) ?? 0;
    if (character <= 0x1f || character === 0x7f) {
      throw new TypeError('Streaming upload content type must not contain control characters');
    }
  }

  return type;
}

async function* iterateBytes(value: unknown): AsyncGenerator<Uint8Array> {
  if (typeof value === 'string') {
    yield encodeUTF8(value);
  } else if (ArrayBuffer.isView(value)) {
    yield new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    yield new Uint8Array(value);
  } else if (value instanceof Response) {
    yield* iterateBytes(value.body || (await value.blob()));
  } else if (value instanceof Blob) {
    if (typeof value.stream === 'function') {
      yield* iterateBytes(value.stream());
    } else {
      yield new Uint8Array(await value.arrayBuffer());
    }
  } else if (isReadableStream(value)) {
    for await (const chunk of ReadableStreamToAsyncIterable<unknown>(value)) {
      yield* iterateBytes(chunk);
    }
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      yield* iterateBytes(chunk);
    }
  } else {
    throw new TypeError(`Invalid streaming file chunk: ${String(value)}`);
  }
}

function escapeHeaderValue(value: string): string {
  let escaped = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    escaped +=
      codePoint <= 0x1f || codePoint === 0x7f || character === '"' || character === '\\'
        ? encodeURIComponent(character)
        : character;
  }

  return escaped;
}

const addFormValue = async (
  form: FormData,
  key: string,
  value: unknown,
  options: CreateFormOptions,
): Promise<void> => {
  if (value === undefined) {
    return;
  }
  if (value == null) {
    throw new TypeError(
      `Received null for "${key}"; to pass null in FormData, you must use the string 'null'`,
    );
  }

  // Nested form keys use the current bracketed encoding.
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    form.append(
      key,
      makeFile([await value.blob()], getName(value, { stripFilename: options.stripFilenames })),
    );
  } else if (isAsyncIterable(value)) {
    form.append(
      key,
      makeFile(
        [await new Response(ReadableStreamFrom(value)).blob()],
        getName(value, { stripFilename: options.stripFilenames }),
      ),
    );
  } else if (isNamedBlob(value)) {
    form.append(key, value, getName(value, { stripFilename: options.stripFilenames }));
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + '[]', entry, options)));
  } else if (typeof value === 'object') {
    await Promise.all(
      Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop, options)),
    );
  } else {
    throw new TypeError(
      `Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`,
    );
  }
};
