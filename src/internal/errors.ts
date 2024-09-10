// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

export function isAbortError(err: unknown) {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' && err && 'name' in err && (err as any).name === 'AbortError')
  );
}
