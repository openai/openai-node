/**
 * This file polyfills the global `File` object for you if it's not already defined
 * when running on Node.js
 *
 * This is only needed on Node.js v18 & v19. Newer versions already define `File`
 * as a global.
 */

// @ts-ignore
type nodeBuffer = typeof import('node:buffer');
declare const File: typeof globalThis extends { File: unknown } ? (typeof globalThis)['File']
: nodeBuffer extends { File: unknown } ? nodeBuffer['File']
: any;
export {};
