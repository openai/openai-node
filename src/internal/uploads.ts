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
   * Logical source filename; ordinary uploads send its basename, while Skills can preserve
   * a validated relative directory path.
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
 * @param name Non-empty logical/source filename. Ordinary uploads send only its basename; Skills
 * uploads may preserve a validated relative path with normalized forward slashes.
 * @param options Optional MIME type for the streaming file.
 * @throws {TypeError} If `name` is empty or the content type contains control characters.
 */
export function toStreamingFile(
  data: StreamingFileInput,
  name: string,
  options?: Pick<FilePropertyBag, 'type'>,
): StreamingFile {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('toStreamingFile requires a non-empty file name');
  }

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
 * Supports native files, fetch responses, blobs, Node.js filesystem read
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
 * paths must be safe and relative, and use forward slashes. Paths inferred from URLs and filesystem streams
 * discard their directories.
 */
export function getName(value: any, options?: { stripFilename?: boolean | undefined }): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const name = 'name' in value ? value.name : undefined;
  const explicitName =
    (name && String(name)) || ('filename' in value && value.filename && String(value.filename));
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
  return value.split(/[\\/]/).pop() || undefined;
}

function normalizeFilenamePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new TypeError('Upload file name must be a safe relative path without parent directory segments');
  }
  return normalized;
}

/** Identifies objects that expose a callable `Symbol.asyncIterator` method. */
export const isAsyncIterable = (value: any): value is AsyncIterable<any> =>
  value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';

/**
 * Converts a request to multipart form data when its body contains an upload.
 *
 * Uploads include files, blobs, responses, async iterables, readable
 * streams, and {@link StreamingFile} values anywhere in a nested body. Bodies
 * containing streaming values are encoded lazily; other uploads use `FormData`.
 * Requests without uploads are returned unchanged.
 */
export const maybeMultipartFormRequestOptions = async (
  opts: RequestOptions,
  fetch: OpenAI | Fetch,
  formOptions?: CreateFormOptions,
): Promise<RequestOptions> => {
  if (!hasUploadableValue(opts.body)) {
    return opts;
  }

  if (hasStreamingUploadableValue(opts.body)) {
    return createStreamingFormRequestOptions(opts, formOptions);
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
  if (hasStreamingUploadableValue(opts.body)) {
    return createStreamingFormRequestOptions(opts, formOptions);
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
 * Strings, numbers, and booleans become text fields; responses, blobs,
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

// Native files, Bun files, and unnamed upload values all inherit from Blob.
const isBlob = (value: unknown): value is Blob => value instanceof Blob;

const isReadableStream = (value: unknown): value is ReadableStream<BlobPart> =>
  typeof value === 'object' &&
  value !== null &&
  'getReader' in value &&
  typeof value.getReader === 'function';

const isStreamingFile = (value: unknown): value is StreamingFile =>
  typeof value === 'object' && value !== null && brand_privateStreamingFile in value;

const isUploadable = (value: unknown): value is Uploadable =>
  typeof value === 'object' &&
  value !== null &&
  (value instanceof Response ||
    isAsyncIterable(value) ||
    isReadableStream(value) ||
    isStreamingFile(value) ||
    isBlob(value));

const hasStreamingUploadableValue = (value: unknown): boolean => {
  if (isStreamingFile(value) || isAsyncIterable(value) || isReadableStream(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasStreamingUploadableValue);
  }
  if (value && typeof value === 'object' && !isBlob(value) && !(value instanceof Response)) {
    // Own properties only, matching what form encoding serializes; inherited values are never encoded.
    for (const k of Object.keys(value)) {
      if (hasStreamingUploadableValue((value as Record<string, unknown>)[k])) {
        return true;
      }
    }
  }
  return false;
};

const hasUploadableValue = (value: unknown): boolean => {
  if (isUploadable(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasUploadableValue);
  }
  if (value && typeof value === 'object') {
    // Own properties only, matching what form encoding serializes; inherited values are never encoded.
    for (const k of Object.keys(value)) {
      if (hasUploadableValue((value as any)[k])) {
        return true;
      }
    }
  }
  return false;
};

type FormEntry = { key: string; value: unknown };

const snapshotPreservedUploadEntries = (
  entries: Iterable<FormEntry>,
  filenames: WeakMap<object, string>,
): FormEntry[] => {
  const snapshot: FormEntry[] = [];
  for (const entry of entries) {
    if (isUploadable(entry.value) && !filenames.has(entry.value)) {
      filenames.set(entry.value, getStreamingFileName(entry.value, { stripFilenames: false }));
    }
    snapshot.push(entry);
  }
  return snapshot;
};

const createStreamingFormRequestOptions = (
  opts: RequestOptions,
  options: CreateFormOptions = {},
): RequestOptions => {
  const entries = iterateFormEntries(opts.body);
  const preservedFilenames = options.stripFilenames === false ? new WeakMap<object, string>() : undefined;
  const multipartEntries = preservedFilenames
    ? snapshotPreservedUploadEntries(entries, preservedFilenames)
    : entries;

  const boundary = `openai-${Math.random().toString(36).slice(2)}`;
  const body = ReadableStreamFrom(
    iterateMultipartBody(multipartEntries, boundary, options, preservedFilenames),
  );

  return {
    ...opts,
    body,
    headers: buildHeaders([{ 'content-type': `multipart/form-data; boundary=${boundary}` }, opts.headers]),
  };
};

async function* iterateMultipartBody(
  entries: Iterable<FormEntry>,
  boundary: string,
  options: CreateFormOptions,
  preservedFilenames?: WeakMap<object, string>,
): AsyncGenerator<Uint8Array> {
  for await (const { key, value } of entries) {
    if (isUploadable(value)) {
      const filename = preservedFilenames?.get(value) ?? getStreamingFileName(value, options);
      const type = getStreamingFileType(value);
      yield encodeUTF8(`--${boundary}\r\n`);
      yield encodeUTF8(
        `Content-Disposition: form-data; name="${escapeHeaderValue(key)}"; filename="${escapeHeaderValue(
          filename,
        )}"\r\nContent-Type: ${type}\r\n\r\n`,
      );
      yield* iterateBytes(getStreamingFileData(value));
    } else {
      yield encodeUTF8(`--${boundary}\r\n`);
      yield encodeUTF8(
        `Content-Disposition: form-data; name="${escapeHeaderValue(key)}"\r\n\r\n${String(value)}`,
      );
    }
    yield encodeUTF8('\r\n');
  }
  yield encodeUTF8(`--${boundary}--\r\n`);
}

function* iterateFormEntries(body: unknown): Generator<FormEntry> {
  if (!body || typeof body !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(body)) {
    yield* iterateFormValue(key, value);
  }
}

function* iterateFormValue(key: string, value: unknown): Generator<FormEntry> {
  if (value === undefined) {
    return;
  }
  if (value == null) {
    throw new TypeError(
      `Received null for "${key}"; to pass null in FormData, you must use the string 'null'`,
    );
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isUploadable(value)
  ) {
    yield { key, value };
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      yield* iterateFormValue(key + '[]', entry);
    }
  } else if (typeof value === 'object') {
    for (const [name, prop] of Object.entries(value)) {
      yield* iterateFormValue(`${key}[${name}]`, prop);
    }
  } else {
    throw new TypeError(
      `Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`,
    );
  }
}

function getStreamingFileName(value: Uploadable, options: CreateFormOptions): string {
  if (isStreamingFile(value)) {
    const { name } = value;
    if (typeof name !== 'string' || !name) {
      throw new TypeError('Streaming upload file name must be a non-empty string');
    }

    return options.stripFilenames === false
      ? normalizeFilenamePath(name)
      : (basename(name) ?? 'unknown_file');
  }

  return getName(value, { stripFilename: options.stripFilenames }) ?? 'unknown_file';
}

function getStreamingFileType(value: Uploadable): string {
  let type: string | undefined;

  if (isStreamingFile(value) || isBlob(value)) {
    ({ type } = value);
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

function getStreamingFileData(value: Uploadable): unknown {
  if (isStreamingFile(value)) {
    return value.data;
  }
  return value;
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
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === '"' || character === '\\'
      ? encodeURIComponent(character)
      : character;
  }).join('');
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
    const blob = await value.blob();
    form.append(
      key,
      makeFile([blob], getName(value, { stripFilename: options.stripFilenames }), { type: blob.type }),
    );
  } else if (isAsyncIterable(value)) {
    form.append(
      key,
      makeFile(
        [await new Response(ReadableStreamFrom(value)).blob()],
        getName(value, { stripFilename: options.stripFilenames }),
      ),
    );
  } else if (isBlob(value)) {
    const filename = getName(value, { stripFilename: options.stripFilenames });
    if (filename === undefined) {
      form.append(key, value);
    } else {
      form.append(key, value, filename);
    }
  } else if (Array.isArray(value)) {
    // Prepare array elements concurrently, then preserve their repeated-field order.
    const entries = await Promise.all(
      value.map(async (entry) => {
        const entryForm = new FormData();
        await addFormValue(entryForm, key + '[]', entry, options);
        return entryForm;
      }),
    );

    for (const entryForm of entries) {
      if (!entryForm) {
        continue;
      }

      for (const [entryKey, entryValue] of entryForm.entries()) {
        form.append(entryKey, entryValue);
      }
    }
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
