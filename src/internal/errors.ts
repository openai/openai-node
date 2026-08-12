export function isAbortError(err: unknown) {
  return (
    typeof err === 'object' &&
    err !== null &&
    // Spec-compliant fetch implementations
    (('name' in err && err.name === 'AbortError') ||
      // Expo fetch
      ('message' in err && String(err.message).includes('FetchRequestCanceledException')))
  );
}

export const castToError = (err: any): Error => {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === 'object' && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === '[object Error]') {
        const errorLike = err as { message?: string; cause?: unknown; stack?: string; name?: string };
        // @ts-ignore - not all envs have native support for cause yet
        const error = new Error(errorLike.message, errorLike.cause ? { cause: errorLike.cause } : {});
        if (errorLike.stack) {
          error.stack = errorLike.stack;
        }
        if (errorLike.cause && !(error as Error & { cause?: unknown }).cause) {
          // @ts-ignore - not all environments have native support for cause yet.
          error.cause = errorLike.cause;
        }
        if (errorLike.name) {
          error.name = errorLike.name;
        }
        return error;
      }
    } catch {
      // Fall through when a cross-runtime error shape cannot be inspected.
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
      // Fall through when the value cannot be serialized.
    }
  }
  return new Error(err as string | undefined);
};
