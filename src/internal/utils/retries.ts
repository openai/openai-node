/**
 * Reads a server-provided retry delay, accepting the SDK's millisecond extension
 * before the standard numeric-seconds or HTTP-date `Retry-After` forms.
 */
export function parseRetryAfterMillis(headers: Headers, now = Date.now()): number | undefined {
  const retryAfterMillis = headers.get('retry-after-ms');
  if (retryAfterMillis) {
    // oxlint-disable-next-line unicorn/prefer-number-coercion -- Preserve the client's established lenient header parsing.
    const parsed = Number.parseFloat(retryAfterMillis);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const retryAfter = headers.get('retry-after');
  if (!retryAfter) {
    return undefined;
  }

  // oxlint-disable-next-line unicorn/prefer-number-coercion -- Preserve the client's established lenient header parsing.
  const seconds = Number.parseFloat(retryAfter);
  return Number.isNaN(seconds) ? Date.parse(retryAfter) - now : seconds * 1000;
}
