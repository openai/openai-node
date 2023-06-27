/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 *
 * This is a stub for non-node environments.
 * In node environments, it gets replaced agent.node.ts by the package export map
 */

import type { Agent } from 'node:http';

export const getDefaultAgent = (url: string): Agent | undefined => {
  return undefined;
};
