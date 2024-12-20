// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

declare const Deno: any;

/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
export const readEnv = (env: string): string | undefined => {
  if (typeof process !== 'undefined') {
    return process.env?.[env]?.trim() ?? undefined;
  }
  if (typeof Deno !== 'undefined') {
    return Deno.env?.get?.(env)?.trim();
  }
  return undefined;
};
