import { decodeUTF8, encodeUTF8 } from '../utils/bytes';

/** Text or UTF-8 bytes accepted by the incremental line decoder. */
export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

/** Maximum backing-buffer capacity retained when completed lines leave little active data. */
const MAX_RETAINED_BUFFER_BYTES = 64 * 1024;

/**
 * Incrementally decodes UTF-8 text into lines without losing partial characters
 * or newline sequences that span multiple chunks.
 *
 * Supports `\n`, `\r`, and `\r\n` line endings. Call {@link flush} after the
 * final chunk to emit a trailing line that does not end with a newline.
 *
 * Based on the line decoder used by the Python `httpx` project:
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
export class LineDecoder {
  // prettier-ignore
  /** Individual characters recognized as possible line terminators. */
  static NEWLINE_CHARS = new Set(['\n', '\r']);

  /** Matches complete CRLF terminators as well as standalone CR and LF characters. */
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

  #buffer: Uint8Array;
  #start: number;
  #end: number;
  #searchIndex: number;
  #skipLeadingLF: boolean;

  /** Creates a decoder with no buffered bytes or pending newline continuation. */
  constructor() {
    this.#buffer = new Uint8Array();
    this.#start = 0;
    this.#end = 0;
    this.#searchIndex = 0;
    this.#skipLeadingLF = false;
  }

  /**
   * Appends a text or UTF-8 byte chunk and returns every newly completed line.
   *
   * Incomplete lines remain buffered for the next call. A trailing `\r`
   * completes its line immediately, and a following `\n` is consumed as its
   * continuation. `null` and `undefined` are ignored and do not flush buffered
   * content.
   */
  decode(chunk: Bytes): string[] {
    if (chunk == null) {
      return [];
    }

    let binaryChunk: Uint8Array;
    if (chunk instanceof ArrayBuffer) {
      binaryChunk = new Uint8Array(chunk);
    } else if (typeof chunk === 'string') {
      binaryChunk = encodeUTF8(chunk);
    } else {
      binaryChunk = chunk;
    }

    if (binaryChunk.length === 0) {
      return [];
    }

    if (this.#skipLeadingLF) {
      this.#skipLeadingLF = false;
      if (binaryChunk[0] === 0x0a) {
        binaryChunk = binaryChunk.subarray(1);
      }
      if (binaryChunk.length === 0) {
        return [];
      }
    }

    this.#append(binaryChunk);

    const lines: string[] = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(this.#buffer, this.#searchIndex, this.#end)) != null) {
      const line = decodeUTF8(this.#buffer.subarray(this.#start, patternIndex.preceding));
      lines.push(line);

      this.#start = patternIndex.index;
      if (patternIndex.carriage) {
        if (this.#start < this.#end && this.#buffer[this.#start] === 0x0a) {
          this.#start += 1;
        } else if (this.#start === this.#end) {
          this.#skipLeadingLF = true;
        }
      }
      this.#searchIndex = this.#start;
    }

    this.#searchIndex = this.#end;
    if (this.#start === this.#end) {
      this.#start = 0;
      this.#end = 0;
      this.#searchIndex = 0;
      if (this.#buffer.length > MAX_RETAINED_BUFFER_BYTES) {
        this.#buffer = new Uint8Array();
      }
    } else if (lines.length > 0 && this.#buffer.length > MAX_RETAINED_BUFFER_BYTES) {
      const length = this.#end - this.#start;
      if (length <= MAX_RETAINED_BUFFER_BYTES || this.#buffer.length > length * 4) {
        const capacity =
          length <= MAX_RETAINED_BUFFER_BYTES
            ? Math.min(Math.max(length * 2, 256), MAX_RETAINED_BUFFER_BYTES)
            : length * 2;
        const buffer = new Uint8Array(capacity);
        buffer.set(this.#buffer.subarray(this.#start, this.#end));
        this.#buffer = buffer;
        this.#start = 0;
        this.#end = length;
        this.#searchIndex = length;
      }
    }

    return lines;
  }

  #append(chunk: Uint8Array): void {
    if (this.#end + chunk.length > this.#buffer.length) {
      const length = this.#end - this.#start;
      if (this.#start >= this.#buffer.length / 2 && length + chunk.length <= this.#buffer.length) {
        this.#buffer.copyWithin(0, this.#start, this.#end);
      } else {
        const capacity = Math.max(this.#buffer.length * 2, length + chunk.length, 256);
        const buffer = new Uint8Array(capacity);
        buffer.set(this.#buffer.subarray(this.#start, this.#end));
        this.#buffer = buffer;
      }

      this.#searchIndex -= this.#start;
      this.#end = length;
      this.#start = 0;
    }

    this.#buffer.set(chunk, this.#end);
    this.#end += chunk.length;
  }

  /** Emits the remaining unterminated line, or returns an empty array when idle. */
  flush(): string[] {
    this.#skipLeadingLF = false;
    if (this.#start === this.#end) {
      return [];
    }
    return this.decode('\n');
  }
}

/**
 * Searches the active buffer range for the next CR or LF byte and returns its
 * zero-based position, the position immediately after it, and whether the byte
 * was a carriage return. Returns `null` when the range contains no newline byte.
 *
 * ```ts
 * findNewlineIndex(new TextEncoder().encode('abc\ndef'), 0, 7)
 * // => { preceding: 3, index: 4, carriage: false }
 * ```
 */
function findNewlineIndex(
  buffer: Uint8Array,
  start: number,
  end: number,
): { preceding: number; index: number; carriage: boolean } | null {
  const newline = 0x0a; // \n
  const carriage = 0x0d; // \r

  for (let i = start; i < end; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }

    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }

  return null;
}

/**
 * Finds the first blank-line separator used to delimit streamed event records.
 *
 * @returns The byte offset immediately after the first pair of consecutive
 * line endings, or `-1` when the buffer contains no complete separator.
 */
export function findDoubleNewlineIndex(buffer: Uint8Array): number {
  for (let i = 0; i < buffer.length - 1; i++) {
    const firstEndingLength = lineEndingLength(buffer, i);
    if (firstEndingLength > 0) {
      const secondEndingIndex = i + firstEndingLength;
      const secondEndingLength = lineEndingLength(buffer, secondEndingIndex);
      if (secondEndingLength > 0) {
        return secondEndingIndex + secondEndingLength;
      }
    }
  }

  return -1;
}

function lineEndingLength(buffer: Uint8Array, index: number): number {
  const newline = 0x0a; // \n
  const carriage = 0x0d; // \r

  if (buffer[index] === newline) {
    return 1;
  }
  if (buffer[index] === carriage) {
    return buffer[index + 1] === newline ? 2 : 1;
  }
  return 0;
}
