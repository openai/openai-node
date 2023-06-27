/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import fetch, { Request, Response, Headers } from 'node-fetch';
import type { RequestInfo, RequestInit, BodyInit } from 'node-fetch';

export { fetch, Request, Response, Headers };
export type { RequestInfo, RequestInit, BodyInit };

export const isPolyfilled = true;
