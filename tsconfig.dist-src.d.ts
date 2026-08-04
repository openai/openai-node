// Keep published source navigation independent of consumers installing @types/node.
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
    }

    interface Process {
      env: ProcessEnv;
    }
  }

  var process: NodeJS.Process;

  interface Buffer<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> extends ArrayLike<number> {
    readonly buffer: TArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
  }

  interface BufferConstructor {
    from(input: string, encoding: 'base64' | 'utf-8'): Buffer<ArrayBuffer> & Uint8Array;
    from(input: ArrayBuffer): Buffer<ArrayBuffer> & Uint8Array;
    concat(list: readonly Buffer[]): Buffer<ArrayBuffer> & Uint8Array;
  }

  var Buffer: BufferConstructor;
}
