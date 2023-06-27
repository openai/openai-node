/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { type BlobPart, type Uploadable, isResponseLike, isBlobLike } from './uploadable';

export type ToFileInput = Uploadable | Exclude<BlobPart, string> | AsyncIterable<BlobPart>;

export type FilePropertyBag = {
  type?: string;
  lastModified?: number;
};

export async function newFileArgs(
  value: ToFileInput,
  name?: string | null,
  options: FilePropertyBag = {},
): Promise<{
  bits: BlobPart[];
  name: string;
  options: FilePropertyBag;
}> {
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name ||= new URL(value.url).pathname.split(/[\\/]/).pop() ?? 'unknown_file';

    return { bits: [blob as any], name, options };
  }

  const bits = await getBytes(value);

  name ||= getName(value) ?? 'unknown_file';

  if (!options.type) {
    const type = (bits[0] as any)?.type;
    if (typeof type === 'string') {
      options = { ...options, type };
    }
  }

  return { bits, name, options };
}

async function getBytes(value: ToFileInput): Promise<Array<BlobPart>> {
  if (value instanceof Promise) return getBytes(await (value as any));

  let parts: Array<BlobPart> = [];
  if (
    typeof value === 'string' ||
    ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
    value instanceof ArrayBuffer
  ) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(await value.arrayBuffer());
  } else if (
    isAsyncIterableIterator(value) // includes Readable, ReadableStream, etc.
  ) {
    for await (const chunk of value) {
      parts.push(chunk as BlobPart); // TODO, consider validating?
    }
  } else {
    throw new Error(
      `Unexpected data type: ${typeof value}; constructor: ${
        value?.constructor?.name
      }; props: ${propsForError(value)}`,
    );
  }

  return parts;
}

function propsForError(value: any): string {
  const props = Object.getOwnPropertyNames(value);
  return `[${props.map((p) => `"${p}"`).join(', ')}]`;
}

function getName(value: any): string | undefined {
  return (
    getStringFromMaybeBuffer(value.name) ||
    getStringFromMaybeBuffer(value.filename) ||
    // For fs.ReadStream
    getStringFromMaybeBuffer(value.path)?.split(/[\\/]/).pop()
  );
}

const getStringFromMaybeBuffer = (x: string | Buffer | unknown): string | undefined => {
  if (typeof x === 'string') return x;
  if (typeof Buffer !== 'undefined' && x instanceof Buffer) return String(x);
  return undefined;
};

const isAsyncIterableIterator = (value: any): value is AsyncIterableIterator<unknown> =>
  value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
