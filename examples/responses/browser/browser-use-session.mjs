import { BrowserUse } from 'browser-use-sdk';
import { isIP } from 'node:net';
import { withBorrowedBrowser } from './browserbase-session.mjs';

export class BrowserUseSessionError extends Error {
  constructor(cancelled, cleanup, notification = false) {
    let message = cancelled ? 'Browser session stopped.' : 'Browser session failed.';
    if (notification) {
      message = 'Browser cleanup notification failed.';
    }
    super(message);
    // oxlint-disable-next-line unicorn/custom-error-definition -- Match the existing AbortSignal cancellation contract.
    this.name = cancelled ? 'AbortError' : 'BrowserUseSessionError';
    Object.defineProperty(this, 'cleanup', { value: cleanup });
  }
}

function canonicalId(value) {
  return typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : undefined;
}

function standalone(actual, id) {
  return (
    actual &&
    canonicalId(actual.id) === id &&
    Object.hasOwn(actual, 'agentSessionId') &&
    actual.agentSessionId === null
  );
}

function sessionOrigins(allowedOrigins, work, apiKey, baseUrl) {
  if (
    typeof apiKey !== 'string' ||
    !apiKey.trim() ||
    typeof baseUrl !== 'string' ||
    !baseUrl.trim() ||
    typeof work !== 'function' ||
    !Array.isArray(allowedOrigins) ||
    allowedOrigins.length === 0
  ) {
    throw new BrowserUseSessionError(false);
  }
  const destination = new URL(baseUrl);
  const host = destination.hostname.replaceAll(/^\[|\]$/gu, '');
  const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  if (
    !/^https?:\/\/[^/?#@\\\s]+(?:[/?][^#\\\s]*)?$/iu.test(baseUrl) ||
    destination.username ||
    destination.password ||
    destination.hash ||
    (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && loopback))
  ) {
    throw new BrowserUseSessionError(false);
  }
  return allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (typeof origin !== 'string' || !/^https?:\/\/[^/?#@\\\s]+$/iu.test(origin)) {
      throw new BrowserUseSessionError(false);
    }
    return parsed.origin;
  });
}

function notifyCleanup(onCleanup, cleanup) {
  try {
    const notification = onCleanup(cleanup);
    if (notification && typeof notification.then === 'function') {
      // oxlint-disable-next-line promise/prefer-await-to-then -- An accidental async callback is observed but is not part of session cleanup.
      void Promise.resolve(notification).catch(() => {
        // The caller receives the synchronous notification-contract error below.
      });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function withStandaloneBrowser(
  chromium,
  allowedOrigins,
  work,
  { apiKey, baseUrl, onCleanup, signal } = {},
) {
  if (typeof onCleanup !== 'function') {
    throw new TypeError('onCleanup must be a synchronous function.');
  }
  let client;
  let id;
  let browser;
  let inner;
  let drained = false;
  let complete = false;
  let attempt;
  let browserClose;
  let failed = false;
  let notificationFailed = false;
  let result;
  let status = 'unverified';
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) {
    stop();
  }

  async function cleanupOnce() {
    if (complete) {
      return { status: 'complete' };
    }
    try {
      let localOK = true;
      if (inner) {
        const innerResult = await inner.retry();
        localOK = innerResult.status === 'complete';
        if (localOK) {
          inner = undefined;
        }
      }
      if (browser && !inner) {
        // Keep an unresolved close across retries, but retry a failed close.
        // oxlint-disable promise/prefer-await-to-then -- Retain and drain the exact close promise.
        browserClose ??= Promise.resolve()
          .then(() => browser.close())
          .then(
            () => {
              browser = undefined;
              browserClose = undefined;
              return true;
            },
            () => {
              browserClose = undefined;
              return false;
            },
          );
        // oxlint-enable promise/prefer-await-to-then
        let timer;
        try {
          localOK = await Promise.race([
            browserClose,
            // oxlint-disable-next-line promise/avoid-new -- Clear the attempt timer when close settles.
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(false), 2500);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (!client || !id) {
        return { status: 'unverified' };
      }
      let actual = await client.browsers.get(id);
      if (!standalone(actual, id)) {
        return { status: 'unverified' };
      }
      if (actual.status === 'active') {
        await client.browsers.stop(id);
        actual = await client.browsers.get(id);
        if (!standalone(actual, id)) {
          return { status: 'unverified' };
        }
      }
      if (actual.status !== 'stopped') {
        return { status: 'pending' };
      }
      complete = localOK;
      if (complete) {
        client = undefined;
      }
      return { status: complete ? 'complete' : 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }
  const cleanup = Object.freeze({
    toJSON: () => {
      // Keep the private cleanup handle out of serialized output.
    },
    retry() {
      if (!drained) {
        return Promise.reject(new BrowserUseSessionError(false));
      }
      if (!attempt) {
        // oxlint-disable-next-line promise/prefer-await-to-then -- Concurrent cleanup calls share this exact attempt.
        attempt = cleanupOnce().finally(() => {
          attempt = undefined;
        });
      }
      return attempt;
    },
  });
  function check() {
    if (stopped.signal.aborted) {
      throw new BrowserUseSessionError(true, cleanup);
    }
  }
  try {
    check();
    const origins = sessionOrigins(allowedOrigins, work, apiKey, baseUrl);
    client = new BrowserUse({ apiKey, baseUrl, maxRetries: 0, timeout: 2500 });
    const created = await client.browsers.create({
      timeout: 1,
      proxyCountryCode: null,
      enableRecording: false,
      browserScreenWidth: 1024,
      browserScreenHeight: 768,
      allowResizing: false,
    });
    id = canonicalId(created.id);
    if (!id) {
      throw new BrowserUseSessionError(false, cleanup);
    }
    check();
    const actual = await client.browsers.get(id);
    check();
    if (
      !standalone(actual, id) ||
      actual.status !== 'active' ||
      typeof actual.cdpUrl !== 'string' ||
      !actual.cdpUrl
    ) {
      throw new BrowserUseSessionError(false, cleanup);
    }
    browser = await chromium.connectOverCDP(actual.cdpUrl, { timeout: 2500 });
    check();
    try {
      const outcome = await withBorrowedBrowser(browser, { allowedOrigins: origins }, work, {
        signal: stopped.signal,
      });
      ({ cleanup: inner, result } = outcome);
    } catch (error) {
      inner = error.cleanup;
      throw error;
    }
    check();
  } catch {
    failed = true;
  } finally {
    drained = true;
    ({ status } = await cleanup.retry());
    notificationFailed = !notifyCleanup(onCleanup, cleanup);
    signal?.removeEventListener('abort', stop);
  }
  if (stopped.signal.aborted || failed || notificationFailed) {
    throw new BrowserUseSessionError(stopped.signal.aborted, cleanup, notificationFailed);
  }
  return Object.freeze({ result, status, cleanup });
}
