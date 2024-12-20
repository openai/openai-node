if (typeof require !== 'undefined') {
  if (globalThis.crypto) {
    exports.crypto = globalThis.crypto;
  } else {
    try {
      // Use [require][0](...) and not require(...) so bundlers don't try to bundle the
      // crypto module.
      exports.crypto = [require][0]('node:crypto').webcrypto;
    } catch (e) {}
  }
}
