export const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
