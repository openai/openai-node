/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
export const readEnv = (env: string): string | undefined => {
  try {
    if (typeof (globalThis as any).process !== 'undefined') {
      return (globalThis as any).process.env?.[env]?.trim() || undefined;
    }
    if (typeof (globalThis as any).Deno !== 'undefined') {
      return (globalThis as any).Deno.env?.get?.(env)?.trim() || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};
