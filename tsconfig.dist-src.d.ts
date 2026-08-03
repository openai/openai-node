// Keep published source navigation independent of consumers installing @types/node.
declare const process: {
  readonly env: Record<string, string | undefined>;
};

declare const Buffer: {
  from(input: string, encoding: string): Uint8Array & { readonly buffer: ArrayBuffer };
};
