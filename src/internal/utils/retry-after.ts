function parseNumericDelay(header: string): number {
  const value = Number(header);
  // Accept complete decimal numbers and keep overflowing delays above the retry limit.
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(header.trim())) {
    return Math.min(value, Number.MAX_VALUE);
  }
  // Preserve invalid nonfinite hints without accepting other Number syntax, such as hexadecimal.
  return Number.isFinite(value) ? Number.NaN : value;
}

/** Captures a server minimum and its absolute deadline when it is an HTTP date. */
export function parseRetryAfter(
  responseHeaders?: Headers,
): { delayMillis: number; retryAt?: number } | undefined {
  let timeoutMillis: number | undefined;
  let retryAt: number | undefined;
  // Note the `retry-after-ms` header may not be standard, but is a good idea and we'd like proactive support for it.
  const retryAfterMillisHeader = responseHeaders?.get('retry-after-ms');
  if (retryAfterMillisHeader) {
    const timeoutMs = parseNumericDelay(retryAfterMillisHeader);
    if (!Number.isNaN(timeoutMs)) {
      timeoutMillis = timeoutMs;
    }
  }

  // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
  const retryAfterHeader = responseHeaders?.get('retry-after');
  if (retryAfterHeader && timeoutMillis === undefined) {
    const timeoutSeconds = parseNumericDelay(retryAfterHeader);
    if (Number.isNaN(timeoutSeconds)) {
      retryAt = Date.parse(retryAfterHeader);
      timeoutMillis = retryAt - Date.now();
    } else {
      // Keep finite seconds over the limit distinguishable from invalid hints after scaling.
      timeoutMillis = Number.isFinite(timeoutSeconds)
        ? Math.min(timeoutSeconds * 1000, Number.MAX_VALUE)
        : timeoutSeconds;
    }
  }

  return timeoutMillis !== undefined && Number.isFinite(timeoutMillis) && timeoutMillis >= 0
    ? { delayMillis: timeoutMillis, ...(retryAt === undefined ? {} : { retryAt }) }
    : undefined;
}

/** Parses one server minimum, preserving positive overflow for retry-limit decisions. */
export function parseRetryAfterMillis(responseHeaders?: Headers): number | undefined {
  return parseRetryAfter(responseHeaders)?.delayMillis;
}
