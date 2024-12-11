// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { crypto } from '../polyfill/crypto.node';

/**
 * https://stackoverflow.com/a/2117523
 */
export function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16),
  );
}
