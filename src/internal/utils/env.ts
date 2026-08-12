/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
export const readEnv = (env: string): string | undefined => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  };

  if (runtime.process !== undefined) {
    return runtime.process.env?.[env]?.trim() || undefined;
  }
  if (runtime.Deno !== undefined) {
    return runtime.Deno.env?.get?.(env)?.trim() || undefined;
  }
  return undefined;
};
