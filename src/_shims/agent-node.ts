/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */

import KeepAliveAgent from 'agentkeepalive';
import type { Agent } from 'node:http';
import { AbortController as AbortControllerPolyfill } from 'abort-controller';

export type { Agent };

const defaultHttpAgent: Agent = new KeepAliveAgent({ keepAlive: true, timeout: 5 * 60 * 1000 });
const defaultHttpsAgent: Agent = new KeepAliveAgent.HttpsAgent({ keepAlive: true, timeout: 5 * 60 * 1000 });

// Polyfill global object if needed.
if (typeof AbortController === 'undefined') {
  AbortController = AbortControllerPolyfill as any as typeof AbortController;
}

export const getDefaultAgent = (url: string): Agent | undefined => {
  if (defaultHttpsAgent && url.startsWith('https')) return defaultHttpsAgent;
  return defaultHttpAgent;
};
