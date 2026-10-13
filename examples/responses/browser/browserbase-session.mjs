import { createBrowserDriver, guardBrowserContext } from './driver.mjs';

const terminal = new Set(['COMPLETED', 'TIMED_OUT', 'ERROR']);
const live = new Set(['PENDING', 'RUNNING']);
export class BrowserSessionError extends Error {
  constructor(category, cleanup) {
    super(category === 'cancelled' ? 'Browser session stopped.' : 'Browser session failed.');
    // oxlint-disable-next-line unicorn/custom-error-definition -- AbortError remains the established signal cancellation result.
    this.name = category === 'cancelled' ? 'AbortError' : 'BrowserSessionError';
    this.category = category;
    Object.defineProperty(this, 'cleanup', { value: cleanup });
  }
}

// oxlint-disable-next-line eslint/complexity -- one lifetime must own setup, Stop, drain and retirement.
async function scope({ client, chromium, browser: suppliedBrowser, config, work, signal, owned }) {
  let browser = suppliedBrowser;
  let context;
  let id;
  let project;
  let result;
  let failed = false;
  let request;
  let closed = false;
  let complete = false;
  let attempt;
  let contextClose;
  let contextOpening;
  let browserClose;
  let status = owned ? 'unverified' : 'pending';
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) {
    stop();
  }

  const check = () => {
    if (stopped.signal.aborted) {
      throw new BrowserSessionError('cancelled');
    }
  };
  // oxlint-disable-next-line eslint/complexity -- One attempt owns both local closes and matching provider release.
  async function cleanupOnce() {
    if (complete) {
      return { status: 'complete' };
    }
    const localDeadline = Date.now() + 2500;
    const settled = async (promise) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          // oxlint-disable-next-line promise/avoid-new -- Cancel the deadline timer once the owned close settles.
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), Math.max(0, localDeadline - Date.now()));
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    let localOK = contextOpening === undefined;
    if (context) {
      // Retain an unresolved close across retries; failure permits a fresh attempt.
      // oxlint-disable promise/prefer-await-to-then -- Both completion paths settle and release this exact retained promise.
      contextClose ??= Promise.resolve()
        .then(() => context.close())
        .then(
          () => {
            context = undefined;
            contextClose = undefined;
            return true;
          },
          () => {
            contextClose = undefined;
            return false;
          },
        );
      localOK = (await settled(contextClose)) && localOK;
    }
    if (owned && browser && !contextClose) {
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
      localOK = (await settled(browserClose)) && localOK;
    }
    // oxlint-enable promise/prefer-await-to-then
    if (!owned) {
      complete = localOK;
      return { status: complete ? 'complete' : 'pending' };
    }
    if (!id) {
      return { status: 'unverified' };
    }
    const deadline = Date.now() + 2500;
    const opts = () => ({ maxRetries: 0, timeout: Math.max(1, deadline - Date.now()) });
    try {
      let sent = false;
      for (let reads = 0; reads < 3 && Date.now() < deadline; reads += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each readback decides whether a single later release is allowed.
        const actual = await client.sessions.retrieve(id, opts());
        if (
          actual.id !== id ||
          actual.projectId !== project ||
          (!live.has(actual.status) && !terminal.has(actual.status))
        ) {
          return { status: 'pending' };
        }
        if (terminal.has(actual.status)) {
          complete = localOK;
          return { status: complete ? 'complete' : 'pending' };
        }
        if (!sent) {
          sent = true;
          // oxlint-disable-next-line eslint/no-await-in-loop -- release depends on matching identity in the preceding read.
          await client.sessions.update(id, { status: 'REQUEST_RELEASE', projectId: project }, opts());
        }
      }
    } catch {
      return { status: 'pending' };
    }
    return { status: 'pending' };
  }
  const cleanup = Object.freeze({
    toJSON: () => {
      // Private receipt: JSON.stringify must omit it.
    },
    retry() {
      if (!closed) {
        return Promise.reject(new BrowserSessionError('not_drained'));
      }
      if (attempt) {
        return attempt;
      }
      // oxlint-disable-next-line promise/prefer-await-to-then -- store one exact shared promise until the attempt has settled.
      attempt = cleanupOnce().finally(() => {
        attempt = undefined;
      });
      return attempt;
    },
  });
  try {
    check();
    if (
      !config ||
      typeof work !== 'function' ||
      !Array.isArray(config.allowedOrigins) ||
      config.allowedOrigins.length === 0 ||
      [
        'ownedFixture',
        'owned_fixture_urls',
        'publicValues',
        'public_values',
        'publicViewports',
        'public_viewports',
      ].some((k) => k in config)
    ) {
      throw new BrowserSessionError('configuration');
    }
    const allowed = new Set(
      config.allowedOrigins.map((origin) => {
        const u = new URL(origin);
        if (typeof origin !== 'string' || !/^https?:\/\/[^/?#@\\\s]+$/iu.test(origin)) {
          throw new BrowserSessionError('configuration');
        }
        return u.origin;
      }),
    );
    if (owned) {
      if (typeof config.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(config.projectId)) {
        throw new BrowserSessionError('configuration');
      }
      project = config.projectId;
      const created = await client.sessions.create(
        {
          api_timeout: 60,
          keepAlive: false,
          projectId: project,
          proxies: false,
          browserSettings: {
            recordSession: false,
            logSession: false,
            solveCaptchas: false,
            verified: false,
            advancedStealth: false,
          },
        },
        { maxRetries: 0, timeout: 2500 },
      );
      if (typeof created.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(created.id)) {
        throw new BrowserSessionError('identity');
      }
      ({ id } = created);
      if (created.projectId !== project) {
        throw new BrowserSessionError('identity');
      }
      check();
      browser = await chromium.connectOverCDP(created.connectUrl, { timeout: 2500 });
    }
    check();
    const contextBrowser = browser;
    // Own creation and guards before invoking the provider, including synchronous cancellation.
    contextOpening = (async () => {
      await Promise.resolve();
      try {
        check();
        const opened = await contextBrowser.newContext({
          serviceWorkers: 'block',
          acceptDownloads: false,
          viewport: { width: 1024, height: 768 },
        });
        context = opened;
        check();
        await guardBrowserContext(
          {
            routeWebSocket: (...args) => {
              check();
              return opened.routeWebSocket(...args);
            },
            route: (...args) => {
              check();
              return opened.route(...args);
            },
          },
          (url) => {
            try {
              return allowed.has(new URL(url).origin);
            } catch {
              return false;
            }
          },
        );
        check();
        return true;
      } catch {
        return false;
      } finally {
        contextOpening = undefined;
        if (closed) {
          await attempt;
          await cleanup.retry();
        }
      }
    })();
    let stopOpening;
    try {
      // oxlint-disable-next-line promise/avoid-new -- Pending creation and guards remain owned after this Stop race ends.
      const interrupted = new Promise((resolve) => {
        stopOpening = () => resolve(false);
        stopped.signal.addEventListener('abort', stopOpening, { once: true });
        if (stopped.signal.aborted) {
          stopOpening();
        }
      });
      if (!(await Promise.race([contextOpening, interrupted]))) {
        throw new BrowserSessionError(stopped.signal.aborted ? 'cancelled' : 'failed');
      }
    } finally {
      stopped.signal.removeEventListener('abort', stopOpening);
    }
    check();
    const driver = createBrowserDriver(context);
    result = await work(driver, stopped.signal);
    check();
  } catch {
    failed = true;
  } finally {
    closed = true;
    request = await cleanup.retry();
    ({ status } = request);
    signal?.removeEventListener('abort', stop);
  }
  if (failed || stopped.signal.aborted) {
    throw new BrowserSessionError(stopped.signal.aborted ? 'cancelled' : 'failed', cleanup);
  }
  return Object.freeze({ result, status, cleanup });
}

export function withBrowserbaseSession(client, chromium, config, work, { signal } = {}) {
  return scope({ client, chromium, config, work, signal, owned: true });
}
export function withBorrowedBrowser(browser, config, work, { signal } = {}) {
  return scope({ browser, config, work, signal, owned: false });
}
