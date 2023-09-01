/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 *
 * This is a stub for non-node environments.
 * In node environments, it gets replaced agent-node.ts by the package export map
 */

export type Agent = any;

export const getDefaultAgent = (url: string): any => {
  return undefined;
};
