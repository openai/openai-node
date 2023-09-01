/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import { FormData, File, Blob } from 'formdata-node';

export { FormData, File, Blob };

export const isPolyfilled = true;
