/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import * as nf from 'node-fetch';

const _fetch = nf.default;
const _Request = nf.Request;
const _Response = nf.Response;
const _Headers = nf.Headers;

export { _fetch as fetch, _Request as Request, _Response as Response, _Headers as Headers };

export const isPolyfilled = true;
