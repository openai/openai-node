/** Copies byte arrays into one contiguous `Uint8Array` while preserving their order. */
export function concatBytes(buffers: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }

  return output;
}

let encodeUTF8_: (str: string) => Uint8Array;

/** Encodes text as UTF-8 bytes, reusing the platform encoder after its first call. */
export function encodeUTF8(str: string) {
  let encoder;
  return (
    encodeUTF8_ ??
    ((encoder = new (globalThis as any).TextEncoder()), (encodeUTF8_ = encoder.encode.bind(encoder)))
  )(str);
}

let decodeUTF8_: (bytes: Uint8Array) => string;

/** Decodes UTF-8 bytes as text, reusing the platform decoder after its first call. */
export function decodeUTF8(bytes: Uint8Array) {
  let decoder;
  return (
    decodeUTF8_ ??
    ((decoder = new (globalThis as any).TextDecoder()), (decodeUTF8_ = decoder.decode.bind(decoder)))
  )(bytes);
}
