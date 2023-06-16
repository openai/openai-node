import type NodeFetch from 'node-fetch';
import type { RequestInfo, RequestInit, Response } from 'node-fetch';
import type KeepAliveAgent from 'agentkeepalive';
import type { Agent } from 'http';
import { AbortController as AbortControllerPolyfill } from 'abort-controller';

declare const Deno: any;
// For now, we just pretend that Fetch is the same type as NodeFetch.
declare const fetch: Fetch | undefined;

let nodeFetch: typeof NodeFetch | undefined = undefined;
let nodeFetchImportError: unknown;
let defaultHttpAgent: Agent;
let defaultHttpsAgent: Agent;

// In a Node environment, we prefer `node-fetch` to other fetch implementations
// which may be present, because it allows keepAlive and others don't.
// Alternative, "Web Standards"-based environments typically provide fetch implementations
// which provide good performance for this by default, and may not support node-fetch.
const isProbablyNode = typeof process !== 'undefined' && typeof Deno === 'undefined';
if (isProbablyNode) {
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    nodeFetch = require('node-fetch').default;
    const KeepAliveHttpAgent: typeof KeepAliveAgent = require('agentkeepalive');
    /* eslint-enable @typescript-eslint/no-var-requires */

    defaultHttpAgent = new KeepAliveHttpAgent({ keepAlive: true, timeout: 5 * 60 * 1000 });
    defaultHttpsAgent = new KeepAliveHttpAgent.HttpsAgent({ keepAlive: true, timeout: 5 * 60 * 1000 });
  } catch (e) {
    // We can fall back to a built-in "fetch".
    nodeFetchImportError = e;
  }
}

// Polyfill global object if needed.
if (typeof AbortController === 'undefined') {
  AbortController = AbortControllerPolyfill as typeof AbortController;
}

export type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

export const getFetch = (): Fetch => {
  if (isProbablyNode && nodeFetch) {
    return nodeFetch;
  }

  // For other environments, use a global fetch function expected to already be present
  if (typeof fetch === 'undefined' || typeof fetch !== 'function') {
    if (isProbablyNode) {
      throw new Error(
        `Could not import "node-fetch", and no global "fetch" function is defined.`,
        // @ts-expect-error This is only Node 16.9.0+, but isn't harmful in other contexts.
        { cause: nodeFetchImportError },
      );
    }
    throw new Error(
      `Unexpected: running in a non-Node environment without a global "fetch" function defined.`,
    );
  }

  return fetch;
};

export const getDefaultAgent = (url: string): Agent | undefined => {
  if (defaultHttpsAgent && url.startsWith('https')) return defaultHttpsAgent;
  if (defaultHttpAgent) return defaultHttpAgent;
  return undefined;
};
