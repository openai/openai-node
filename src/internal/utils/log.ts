// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { readEnv } from './env';

export function debug(action: string, ...args: any[]) {
  if (readEnv('DEBUG') === 'true') {
    console.log(`OpenAI:DEBUG:${action}`, ...args);
  }
}
