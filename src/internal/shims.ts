// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { type Fetch } from './types';

export function getDefaultFetch(): Fetch {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }

  throw new Error(
    '`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`',
  );
}
