import { OpenAIError } from '../../core/error';
import { decodeUTF8, encodeUTF8 } from '../utils/bytes';
import { readEnv } from '../utils/env';

/** Text or UTF-8 bytes accepted by the incremental line decoder. */
export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

/** Maximum backing-buffer capacity retained when completed lines leave little active data. */
const MAX_RETAINED_BUFFER_BYTES = 64 * 1024;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_LINE_ENDING_BYTES = 2;

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
  #maxLineBytes: number;
  #maxBufferedBytes: number;

  /**
   * Creates an empty decoder with an optional maximum UTF-8 line size.
   *
   * Defaults to 8 MiB unless `OPENAI_MAX_NDJSON_LINE_BYTES` supplies a valid
   * positive integer. Explicit limits take precedence; invalid limits throw
   * `RangeError`, and decoding a line above the limit throws `OpenAIError`.
   */
  constructor(options?: { maxLineBytes?: number }) {
    const configuredMaximum = options?.maxLineBytes;
    if (configuredMaximum === undefined) {
      const configuredEnvironmentMaximum = readEnv('OPENAI_MAX_NDJSON_LINE_BYTES');
      const environmentMaximum = Number(configuredEnvironmentMaximum);
      this.#maxLineBytes =
        configuredEnvironmentMaximum !== undefined &&
        Number.isSafeInteger(environmentMaximum) &&
        environmentMaximum > 0 &&
        environmentMaximum <= Number.MAX_SAFE_INTEGER - MAX_LINE_ENDING_BYTES
          ? environmentMaximum
          : DEFAULT_MAX_LINE_BYTES;
    } else {
      if (
        !Number.isSafeInteger(configuredMaximum) ||
        configuredMaximum <= 0 ||
        configuredMaximum > Number.MAX_SAFE_INTEGER - MAX_LINE_ENDING_BYTES
      ) {
        throw new RangeError('The maximum line size must be a positive safe integer.');
      }
      this.#maxLineBytes = configuredMaximum;
    }
    this.#maxBufferedBytes = this.#maxLineBytes + MAX_LINE_ENDING_BYTES;
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

    if (chunk instanceof ArrayBuffer) {
      return this.#decodeBinaryChunk(new Uint8Array(chunk));
    }

    if (typeof chunk === 'string') {
      return this.#decodeTextChunk(chunk);
    }

    return this.#decodeBinaryChunk(chunk);
  }

  #decodeTextChunk(chunk: string): string[] {
    if (chunk.length === 0) {
      return [];
    }

    const activeLength = this.#end - this.#start;
    if (activeLength + chunk.length * 3 <= this.#maxLineBytes) {
      return this.#decodeBinaryChunk(encodeUTF8(chunk));
    }

    const byteLength = this.#validateTextChunk(chunk);
    if (byteLength <= this.#maxBufferedBytes) {
      return this.#decodeBinaryChunk(encodeUTF8(chunk));
    }

    const lines: string[] = [];
    let segmentStart = 0;
    let segmentLength = 0;

    for (let index = 0; index < chunk.length;) {
      const codePoint = chunk.codePointAt(index) ?? 0;
      const codeUnits = codePoint > 0xff_ff ? 2 : 1;
      const bytes = utf8CodePointByteLength(codePoint);

      if (segmentLength + bytes > this.#maxBufferedBytes) {
        for (const line of this.#decodeBinaryChunk(encodeUTF8(chunk.slice(segmentStart, index)))) {
          lines.push(line);
        }
        segmentStart = index;
        segmentLength = 0;
      }

      segmentLength += bytes;
      index += codeUnits;
    }

    if (segmentStart < chunk.length) {
      for (const line of this.#decodeBinaryChunk(encodeUTF8(chunk.slice(segmentStart)))) {
        lines.push(line);
      }
    }

    return lines;
  }

  #validateTextChunk(chunk: string): number {
    let activeLength = this.#end - this.#start;
    let byteLength = 0;

    for (let index = 0; index < chunk.length;) {
      const codePoint = chunk.codePointAt(index) ?? 0;
      index += codePoint > 0xff_ff ? 2 : 1;
      if (codePoint === 0x0a || codePoint === 0x0d) {
        activeLength = 0;
        byteLength += 1;
        continue;
      }

      const bytes = utf8CodePointByteLength(codePoint);
      if (bytes > this.#maxLineBytes - activeLength) {
        this.#throwLineTooLarge();
      }

      activeLength += bytes;
      byteLength += bytes;
    }

    return byteLength;
  }

  #decodeBinaryChunk(binaryChunk: Uint8Array): string[] {
    if (binaryChunk.length === 0) {
      return [];
    }

    this.#validateBinaryChunk(binaryChunk);

    const lines: string[] = [];
    let offset = 0;

    while (offset < binaryChunk.length) {
      if (this.#skipLeadingLF) {
        this.#skipLeadingLF = false;
        if (binaryChunk[offset] === 0x0a) {
          offset += 1;
          if (offset === binaryChunk.length) {
            break;
          }
        }
      }

      const activeLength = this.#end - this.#start;
      const end = Math.min(binaryChunk.length, offset + this.#maxBufferedBytes - activeLength);
      const segment =
        offset === 0 && end === binaryChunk.length ? binaryChunk : binaryChunk.subarray(offset, end);
      this.#append(segment);
      this.#extractLines(lines);
      offset = end;
    }

    return lines;
  }

  #validateBinaryChunk(chunk: Uint8Array): void {
    let activeLength = this.#end - this.#start;
    if (activeLength + chunk.length <= this.#maxLineBytes) {
      return;
    }

    for (const byte of chunk) {
      if (byte === 0x0a || byte === 0x0d) {
        activeLength = 0;
      } else {
        if (activeLength === this.#maxLineBytes) {
          this.#throwLineTooLarge();
        }
        activeLength += 1;
      }
    }
  }

  #extractLines(lines: string[]): void {
    const originalLineCount = lines.length;
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
    } else if (lines.length > originalLineCount && this.#buffer.length > MAX_RETAINED_BUFFER_BYTES) {
      const length = this.#end - this.#start;
      if (length <= MAX_RETAINED_BUFFER_BYTES || this.#buffer.length > length * 4) {
        const capacity = Math.min(
          length <= MAX_RETAINED_BUFFER_BYTES
            ? Math.min(Math.max(length * 2, 256), MAX_RETAINED_BUFFER_BYTES)
            : length * 2,
          this.#maxBufferedBytes,
        );
        const buffer = new Uint8Array(capacity);
        buffer.set(this.#buffer.subarray(this.#start, this.#end));
        this.#buffer = buffer;
        this.#start = 0;
        this.#end = length;
        this.#searchIndex = length;
      }
    }
  }

  #append(chunk: Uint8Array): void {
    const activeLength = this.#end - this.#start;
    if (activeLength + chunk.length > this.#maxBufferedBytes) {
      this.#throwLineTooLarge();
    }

    if (this.#end + chunk.length > this.#buffer.length) {
      const length = activeLength;
      if (this.#start >= this.#buffer.length / 2 && length + chunk.length <= this.#buffer.length) {
        this.#buffer.copyWithin(0, this.#start, this.#end);
      } else {
        const capacity = Math.min(
          Math.max(this.#buffer.length * 2, length + chunk.length, 256),
          this.#maxBufferedBytes,
        );
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

  #throwLineTooLarge(): never {
    throw new OpenAIError(`Line exceeds the maximum size of ${this.#maxLineBytes} bytes.`);
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

function utf8CodePointByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7_ff) {
    return 2;
  }
  if (codePoint <= 0xff_ff) {
    return 3;
  }
  return 4;
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
