import { concatBytes, decodeUTF8, encodeUTF8 } from '../utils/bytes';

/** Text or UTF-8 bytes accepted by the incremental line decoder. */
export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

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
  #carriageReturnIndex: number | null;

  /** Creates a decoder with no buffered bytes or pending carriage return. */
  constructor() {
    this.#buffer = new Uint8Array();
    this.#carriageReturnIndex = null;
  }

  /**
   * Appends a text or UTF-8 byte chunk and returns every newly completed line.
   *
   * Incomplete lines remain buffered for the next call. `null` and `undefined`
   * are ignored and do not flush buffered content.
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

    this.#buffer = concatBytes([this.#buffer, binaryChunk]);

    const lines: string[] = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(this.#buffer, this.#carriageReturnIndex)) != null) {
      if (patternIndex.carriage && this.#carriageReturnIndex == null) {
        // skip until we either get a corresponding `\n`, a new `\r` or nothing
        this.#carriageReturnIndex = patternIndex.index;
        continue;
      }

      // we got double \r or \rtext\n
      if (
        this.#carriageReturnIndex != null &&
        (patternIndex.index !== this.#carriageReturnIndex + 1 || patternIndex.carriage)
      ) {
        lines.push(decodeUTF8(this.#buffer.subarray(0, this.#carriageReturnIndex - 1)));
        this.#buffer = this.#buffer.subarray(this.#carriageReturnIndex);
        this.#carriageReturnIndex = null;
        continue;
      }

      const endIndex =
        this.#carriageReturnIndex === null ? patternIndex.preceding : patternIndex.preceding - 1;

      const line = decodeUTF8(this.#buffer.subarray(0, endIndex));
      lines.push(line);

      this.#buffer = this.#buffer.subarray(patternIndex.index);
      this.#carriageReturnIndex = null;
    }

    return lines;
  }

  /** Emits the remaining unterminated line, or returns an empty array when idle. */
  flush(): string[] {
    if (!this.#buffer.length) {
      return [];
    }
    return this.decode('\n');
  }
}

/**
 * Searches for the next CR or LF byte and returns its zero-based position,
 * the position immediately after it, and whether the byte was a carriage return.
 * Returns `null` when no newline byte exists after the requested start index.
 *
 * ```ts
 * findNewlineIndex(new TextEncoder().encode('abc\ndef'), null)
 * // => { preceding: 3, index: 4, carriage: false }
 * ```
 */
function findNewlineIndex(
  buffer: Uint8Array,
  startIndex: number | null,
): { preceding: number; index: number; carriage: boolean } | null {
  const newline = 0x0a; // \n
  const carriage = 0x0d; // \r

  for (let i = startIndex ?? 0; i < buffer.length; i++) {
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
        const secondEndingCouldBecomeCRLF =
          buffer[secondEndingIndex] === 0x0d && secondEndingIndex === buffer.length - 1;
        const isUnambiguousDoubleCR = buffer[i] === 0x0d && firstEndingLength === 1;
        if (secondEndingCouldBecomeCRLF && !isUnambiguousDoubleCR) {
          continue;
        }
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
