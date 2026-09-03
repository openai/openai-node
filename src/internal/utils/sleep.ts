export const sleep = (ms: number, ...signals: (AbortSignal | null | undefined)[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const activeSignals = [...new Set(signals.filter((signal): signal is AbortSignal => signal != null))];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      for (const signal of activeSignals) {
        signal.removeEventListener('abort', abort);
      }
    };
    const abort = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      cleanup();
      reject();
    };

    if (activeSignals.some((signal) => signal.aborted)) {
      abort();
      return;
    }

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    for (const signal of activeSignals) {
      signal.addEventListener('abort', abort, { once: true });
    }
  });
