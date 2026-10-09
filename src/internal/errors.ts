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
      if (Object.prototype.toString.call(err) === '[object Error]') {
        const hasCause = 'cause' in err;
        // @ts-ignore - not all envs have native support for cause yet
        const error = new Error(err.message, hasCause ? { cause: err.cause } : {});
        if (err.stack) error.stack = err.stack;
        // @ts-ignore - not all envs have native support for cause yet
        if (hasCause && !Object.prototype.hasOwnProperty.call(error, 'cause')) error.cause = err.cause;
        if (err.name) error.name = err.name;
        return error;
      }
    } catch {}
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(err);
};
