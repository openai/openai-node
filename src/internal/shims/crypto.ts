import { getBuiltinModule } from './getBuiltinModule';

type Crypto = {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/getRandomValues) */
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  /**
   * Available only in secure contexts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID)
   */
  randomUUID?: () => string;
};
export let getCrypto: () => Crypto | undefined = function lazyGetCrypto() {
  if (getCrypto !== lazyGetCrypto) return getCrypto();
  const crypto: Crypto = (globalThis as any).crypto || (getBuiltinModule?.('node:crypto') as any)?.webcrypto;
  getCrypto = () => crypto;
  return crypto;
};
