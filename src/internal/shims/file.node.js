if (typeof require !== 'undefined') {
  if (globalThis.File) {
    exports.File = globalThis.File;
  } else {
    try {
      // Use [require][0](...) and not require(...) so bundlers don't try to bundle the
      // buffer module.
      exports.File = [require][0]('node:buffer').File;
    } catch (e) {}
  }
}
