/**
 * This file polyfill's the global `File` object for you if it's not already defined
 * when running on Node.js
 *
 * You will only need this on Node.js v18 & v19. Newer versions already define `File`
 * as a global.
 */

import { File } from 'node:buffer';

if (!(globalThis as any).File) {
  // @ts-ignore
  globalThis.File = File;
}

export { File };
