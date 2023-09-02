/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

// shim these Node types to avoid importing @types/node and polluting the user's
// type environment in non-node projects

export declare class Readable {
  readable: boolean;
  readonly readableEnded: boolean;
  readonly readableFlowing: boolean | null;
  readonly readableHighWaterMark: number;
  readonly readableLength: number;
  readonly readableObjectMode: boolean;
  destroyed: boolean;
  read(size?: number): any;
  pause(): this;
  resume(): this;
  isPaused(): boolean;
  destroy(error?: Error): this;
  [Symbol.asyncIterator](): AsyncIterableIterator<any>;
}

export declare class FsReadStream extends Readable {
  path: {}; // node type is string | Buffer
}

export function isFsReadStream(value: any): value is FsReadStream {
  return false;
}
