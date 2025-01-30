// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

export function isAbortError(err: unknown) {
  return (
    typeof err === 'object' &&
    err !== null &&
    // Spec-compliant fetch implementations
    (('name' in err && (err as any).name === 'AbortError') ||
      // Expo fetch
      ('message' in err && String((err as any).message).includes('FetchRequestCanceledException')))
  );
}

export const castToError = (err: any): Error => {
  if (err instanceof Error) return err;
  if (typeof err === 'object' && err !== null) {
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(err);
};
