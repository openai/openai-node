/**
 * This file polyfills the global `File` object for you if it's not already defined
 * when running on Node.js
 *
 * This is only needed on Node.js v18 & v19. Newer versions already define `File`
 * as a global.
 */

if (typeof require !== 'undefined') {
  if (!globalThis.File) {
    try {
      // Use [require][0](...) and not require(...) so bundlers don't try to bundle the
      // buffer module.
      globalThis.File = [require][0]('node:buffer').File;
    } catch (e) {}
  }
}
