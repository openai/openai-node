import { OpenAIError } from '../../core/error';
import { encodeUTF8 } from './bytes';

interface BufferLike {
  from: (
    data: string | Uint8Array,
    encoding?: string,
  ) => Uint8Array & {
    toString: (encoding: string) => string;
  };
}

export const toBase64 = (data: string | Uint8Array | null | undefined): string => {
  if (!data) {
    return '';
  }

  const buffer = (globalThis as typeof globalThis & { Buffer?: BufferLike }).Buffer;
  if (buffer !== undefined) {
    return buffer.from(data).toString('base64');
  }

  const bytes = typeof data === 'string' ? encodeUTF8(data) : data;

  if (typeof btoa !== 'undefined') {
    return btoa(String.fromCharCode(...bytes));
  }

  throw new OpenAIError('Cannot generate base64 string; Expected `Buffer` or `btoa` to be defined');
};

export const fromBase64 = (str: string): Uint8Array => {
  const buffer = (globalThis as typeof globalThis & { Buffer?: BufferLike }).Buffer;
  if (buffer !== undefined) {
    const buf = buffer.from(str, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  if (typeof atob !== 'undefined') {
    const bstr = atob(str);
    const buf = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i += 1) {
      buf[i] = bstr.charCodeAt(i);
    }
    return buf;
  }

  throw new OpenAIError('Cannot decode base64 string; Expected `Buffer` or `atob` to be defined');
};

/**
 * Converts a Base64 encoded string to a Float32Array.
 * @param base64Str - The Base64 encoded string.
 * @returns An Array of numbers interpreted as Float32 values.
 */
export const toFloat32Array = (base64Str: string): number[] => {
  if (typeof Buffer === 'undefined') {
    // for legacy web platform APIs
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return [...new Float32Array(bytes.buffer)];
  }

  // for Node.js environment
  const buf = Buffer.from(base64Str, 'base64');
  return [...new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT)];
};
