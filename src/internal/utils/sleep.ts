import { APIUserAbortError } from '../../core/error';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for `milliseconds`, or rejects with {@link APIUserAbortError} if `signal`
 * aborts first. Clears the timer and removes the abort listener on settle.
 */
export function sleepUntilAborted(milliseconds: number, signal: AbortSignal): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- Timer and abort callbacks need a portable Promise bridge.
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let registered: (() => void) | undefined;
    let settled = false;

    const removeAbortListener = (listener: () => void) => {
      try {
        signal.removeEventListener('abort', listener);
      } catch {
        // Caller-controlled cleanup must never prevent the wait from settling.
      }
    };

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (registered) {
        const listener = registered;
        registered = undefined;
        removeAbortListener(listener);
      }
    };

    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      try {
        const error = new APIUserAbortError();
        Object.defineProperty(error, 'cause', {
          value: signal.reason,
          writable: true,
          configurable: true,
        });
        reject(error);
      } catch (error) {
        reject(error);
      }
    };

    if (signal.aborted) {
      abort();
      return;
    }

    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }, milliseconds);

    registered = abort;

    try {
      signal.addEventListener('abort', abort, { once: true });

      if (settled) {
        removeAbortListener(abort);
      } else if (signal.aborted) {
        abort();
      }
    } catch (error) {
      if (settled) {
        removeAbortListener(abort);
      } else {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}
