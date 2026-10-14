import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { tasks } from './tasks.mjs';
import { createDemoSession, executeDemo } from './runner.mjs';
import { exampleBrowserChannel, waitForDecision } from './booking.mjs';

const templates = await Promise.all(
  ['index.html', 'fixture.html'].map((name) => readFile(new URL(name, import.meta.url), 'utf-8')),
);

async function readKey(path) {
  if (typeof process.getuid !== 'function') {
    throw new TypeError('--key-file is unavailable on this platform. Set OPENAI_API_KEY instead.');
  }
  // File-open flags must be combined; no-follow prevents symlink replacement of the selected file.
  // oxlint-disable-next-line no-bitwise
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    // Check the permission bits as supplied by the filesystem.
    // oxlint-disable-next-line no-bitwise
    const permissions = stat.mode & 0o777;
    if (!stat.isFile() || stat.uid !== process.getuid() || permissions !== 0o600) {
      throw new Error('The key file must be an owner-only regular file (0600).');
    }
    const limit = 16 * 1024;
    if (stat.size > limit) {
      throw new Error('The key file must be at most 16 KiB.');
    }
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      // oxlint-disable-next-line no-await-in-loop -- Read one bounded descriptor through short reads and concurrent growth.
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size);
      if (!bytesRead) {
        break;
      }
      size += bytesRead;
    }
    if (size > limit) {
      throw new Error('The key file must be at most 16 KiB.');
    }
    return buffer.toString('utf-8', 0, size).trim();
  } finally {
    await handle.close();
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function matchesImage(url, binding) {
  return Boolean(
    binding &&
    url.searchParams.get('tabId') === binding.tabId &&
    url.searchParams.get('sequence') === String(binding.sequence),
  );
}

function runBusy(run) {
  return Boolean(
    run &&
    (run.owner !== 'stopped' ||
      run.agentActive ||
      run.cleanup === 'pending' ||
      run.cleanup === 'failed' ||
      run.humanPromise ||
      run.transferActive ||
      run.session?.refreshing ||
      (run.session && !run.session.closed)),
  );
}

function currentView(run) {
  if (run.owner === 'stopped' || run.session?.closed) {
    return { ...run.liveView?.state, status: 'closed' };
  }
  if (run.session?.matches(run.session.viewBinding)) {
    return run.liveView.state;
  }
  return { status: 'starting' };
}

async function refreshPolledView(run) {
  if (!run?.session || run.session.refreshing) {
    return;
  }
  try {
    await run.session.refreshView();
  } catch {
    // A failed view stays unavailable. The next authenticated poll can try again.
  }
}

// oxlint-disable-next-line eslint/complexity -- This allowlist is the only dashboard state projection; keep its fields reviewable together.
function snapshot(run) {
  if (!run) {
    return null;
  }
  run.uncertainEffects ||= run.session?.hasUncertainEffects() === true;
  const failure = run.apiFailure;
  const browser = run.session?.browser?.() ?? null;
  return {
    id: run.id,
    taskId: run.taskId,
    api: run.api,
    mode: run.mode,
    environment: run.environment,
    status: run.status,
    owner: run.owner,
    ownerVersion: run.ownerVersion,
    browser,
    screenshotBinding: run.screenshotBinding ?? null,
    humanInputBusy: Boolean(run.humanPromise || run.transferActive),
    uncertainEffects: Boolean(run.uncertainEffects),
    closing: run.owner === 'stopped' && runBusy(run),
    sessionExpiresAt: run.sessionExpiresAt ?? null,
    turns: run.turns,
    stepLimit: run.stepLimit,
    result: run.result,
    requests: run.requests,
    requestHeadersMs: Math.round(run.requestHeadersMs),
    elapsedMs: Math.round(
      run.owner === 'stopped' && !run.agentActive ? run.elapsedMs : performance.now() - run.started,
    ),
    screenshotAt: run.screenshotAt,
    view: currentView(run),
    events: run.events,
    eventsDropped: run.eventsDropped,
    approval: run.approval,
    fixture: run.fixture,
    finalText: run.finalText ?? null,
    // The runner retains only safe API status fields; never expose its client, headers or key.
    apiFailure: failure
      ? { status: failure.status, requestId: failure.requestId, code: failure.code, message: failure.message }
      : null,
  };
}

async function readBody(request) {
  request.setEncoding('utf-8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) {
      throw new Error('The demo control request is too large.');
    }
  }
  return JSON.parse(body || '{}');
}

function servePage(pathname, response) {
  if (pathname === '/fixture/reservation') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'",
    });
    response.end(templates[1].replace('__TASK__', JSON.stringify(tasks.reservation)));
    return true;
  }
  if (pathname === '/') {
    const nonce = randomBytes(18).toString('hex');
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    });
    response.end(templates[0].replace('__NONCE__', nonce));
    return true;
  }
  return false;
}

function createRun(body) {
  let settle;
  return {
    id: randomUUID(),
    taskId: body.taskId,
    api: body.api,
    mode: body.mode,
    environment: body.environment ?? 'browser',
    status: 'running',
    stopReason: null,
    owner: 'agent',
    ownerVersion: 0,
    result: null,
    requests: 0,
    turns: 0,
    stepLimit: body.api === 'decisions' ? 20 : 24,
    requestHeadersMs: 0,
    events: [],
    eventsDropped: 0,
    controller: new AbortController(),
    started: performance.now(),
    elapsedMs: 0,
    setOwner(owner) {
      if (this.owner !== owner) {
        if (this.owner === 'human') {
          clearTimeout(this.expiryTimer);
          this.sessionExpiresAt = null;
        }
        this.owner = owner;
        this.ownerVersion += 1;
        this.addEvent('control', owner);
      }
    },
    addEvent(kind, text) {
      this.events.push({ kind, text, atMs: Math.round(performance.now() - this.started) });
      if (this.events.length > 256) {
        this.events.shift();
        this.eventsDropped += 1;
      }
    },
    settleApproval(value) {
      if (settle) {
        const resolve = settle;
        settle = undefined;
        this.approval = null;
        resolve(value);
      }
    },
    async askApproval(label, expiresAt, owner = 'agent') {
      if (this.refused || this.owner !== owner || (owner === 'agent' && this.controller.signal.aborted)) {
        return false;
      }
      const pending = Promise.withResolvers();
      settle = pending.resolve;
      this.approval = { id: randomUUID(), label, ...(expiresAt === undefined ? {} : { expiresAt }) };
      this.addEvent('approval', `Waiting for approval: ${label}`);
      const timeout = setTimeout(
        () => {
          this.approvalExpired = true;
          this.stop('approval_expired');
        },
        expiresAt === undefined ? 120_000 : Math.max(0, expiresAt - Date.now()),
      );
      try {
        return await pending.promise;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function finishCleanup(run) {
  if (
    ['pending', 'failed'].includes(run.cleanup) &&
    run.sessionCloseSettled &&
    !run.agentActive &&
    !run.humanPromise &&
    !run.transferActive
  ) {
    run.cleanup = run.cleanup === 'pending' ? 'completed' : run.cleanup;
  }
}

function closeRun(run) {
  clearTimeout(run.expiryTimer);
  run.sessionExpiresAt = null;
  run.closePromise ??= (async () => {
    if (run.cleanup !== 'failed') {
      run.cleanup = 'pending';
    }
    try {
      // Revoke a published context even when a later setup operation has not settled.
      try {
        await run.session?.close();
      } finally {
        try {
          await run.initialization;
        } catch {
          // Initialization records its safe failure and closes any partially created context.
        }
        await run.launchRetirement;
      }
      await run.session?.close();
    } catch (error) {
      run.cleanup = 'failed';
      run.status = 'cleanup_failed';
      throw error;
    } finally {
      run.sessionCloseSettled = true;
      finishCleanup(run);
    }
  })();
  return run.closePromise;
}

async function finishClose(run) {
  try {
    await closeRun(run);
  } catch {
    run.addEvent('control', 'Workspace cleanup failed. Restart the local server.');
  }
}

function stopRun(run, reason = 'stopped') {
  const previousOwner = run.owner;
  if (previousOwner !== 'stopped') {
    run.stopReason = reason;
  }
  run.setOwner('stopped');
  run.controller.abort();
  run.transferController?.abort();
  run.settleApproval(false);
  if (previousOwner !== 'stopped' && (!run.agentActive || reason === 'handoff_unavailable')) {
    run.status = reason;
    run.result = run.result === 'verified' ? 'verified' : 'unverified';
    run.elapsedMs = performance.now() - run.started;
  }
  if (previousOwner !== 'stopped') {
    run.addEvent('control', `Session ended: ${reason}`);
  }
  void finishClose(run);
}

function validateInput(body, page) {
  const { action } = body;
  const fields = {
    click: ['x', 'y'],
    type: ['text'],
    key: ['key'],
    scroll: ['direction', 'amount'],
  };
  if (
    !Object.hasOwn(fields, action) ||
    Object.keys(body).some(
      (key) => !['runId', 'ownerVersion', 'tabId', 'sequence', 'action', ...fields[action]].includes(key),
    )
  ) {
    return false;
  }
  if (action === 'click') {
    const size = page.viewportSize();
    return Boolean(
      size &&
      Number.isFinite(body.x) &&
      Number.isFinite(body.y) &&
      body.x >= 0 &&
      body.y >= 0 &&
      body.x < size.width &&
      body.y < size.height,
    );
  }
  if (action === 'type') {
    return typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 2000;
  }
  if (action === 'key') {
    return [
      'Enter',
      'Tab',
      'Backspace',
      'Delete',
      'Escape',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Space',
      'ControlOrMeta+A',
    ].includes(body.key);
  }
  return (
    ['up', 'down', 'left', 'right'].includes(body.direction) &&
    Number.isSafeInteger(body.amount) &&
    body.amount >= 1 &&
    body.amount <= 2048
  );
}

async function humanInput(run, body) {
  const { page } = run.session;
  try {
    switch (body.action) {
      case 'click': {
        await page.mouse.click(body.x, body.y);
        break;
      }
      case 'type': {
        await page.keyboard.insertText(body.text);
        break;
      }
      case 'key': {
        await page.keyboard.press(body.key);
        break;
      }
      case 'scroll': {
        const delta = {
          up: [0, -body.amount],
          down: [0, body.amount],
          left: [-body.amount, 0],
          right: [body.amount, 0],
        };
        await page.mouse.wheel(...delta[body.direction]);
        break;
      }
      default: {
        throw new Error('Unknown browser input.');
      }
    }
    run.session.invalidateReferences();
    await run.session.refreshView();
    await run.session.capture();
    run.addEvent('human', `Human ${body.action} completed; browser state captured.`);
  } catch {
    run.addEvent(
      'human',
      `Human ${body.action} has an uncertain outcome. Session closed; no automatic resume.`,
    );
    run.uncertainEffects = true;
    stopRun(run, 'uncertain');
    throw new Error('The input outcome could not be verified. Start a fresh session.');
  }
}

async function executeRun(options) {
  const { run } = options;
  run.agentActive = true;
  try {
    if (!run.session) {
      run.initialization = createDemoSession({ ...options, onClose: () => run.stop('browser_closed') });
      await run.initialization;
    }
    run.controller.signal.throwIfAborted();
    await executeDemo(options);
  } catch {
    run.status = 'failed';
    if (run.stopReason) {
      run.status = run.stopReason;
    } else if (run.refused) {
      run.status = 'refused';
    } else if (run.approvalExpired) {
      run.status = 'approval_expired';
    } else if (run.controller.signal.aborted) {
      run.status = 'stopped';
    }
    run.result = run.result === 'verified' ? 'verified' : 'unverified';
    run.addEvent('result', 'Workspace run ended with an error. Inspect the result and cleanup status.');
  } finally {
    run.elapsedMs = performance.now() - run.started;
    run.settleApproval(false);
    if (run.owner === 'agent') {
      run.setOwner('stopped');
    }
    if (run.owner === 'stopped' && !run.launchRetirement) {
      try {
        await run.close();
      } catch {
        run.status = 'cleanup_failed';
        run.addEvent('control', 'Workspace cleanup failed. Restart the local server.');
      }
    }
    run.agentActive = false;
    if (run.cleanup === 'failed') {
      run.status = 'cleanup_failed';
      if (run.owner !== 'stopped') {
        stopRun(run, 'cleanup_failed');
      }
    }
    finishCleanup(run);
  }
}

/** Local operator server. Neither the task browser nor another origin can control a run. */
export async function createDemoServer({ apiKey, models = {}, port = 0 } = {}) {
  let launch;
  let browserClosing;
  let current;
  const browser = {
    async newContext(options, run) {
      const { signal } = run.controller;
      signal.throwIfAborted();
      if (browserClosing) {
        throw new Error('The workspace browser is closing.');
      }
      if (!launch) {
        const channel = exampleBrowserChannel();
        const starting = (async () => {
          const opened = await chromium.launch({
            headless: true,
            channel,
            chromiumSandbox: true,
            handleSIGINT: false,
            handleSIGTERM: false,
            env: {
              PATH: process.env['PATH'] ?? '',
              HOME: process.env['HOME'] ?? '',
              TMPDIR: process.env['TMPDIR'] ?? '/tmp',
            },
          });
          opened.once('disconnected', () => {
            if (launch === starting) {
              launch = undefined;
            }
          });
          return opened;
        })();
        launch = starting;
      }
      const starting = launch;
      let opened;
      const launching = new AbortController();
      try {
        opened = await Promise.race([starting, once(signal, 'abort', { signal: launching.signal })]);
        if (signal.aborted) {
          // Keep one late launch on this run. Admission stays closed until it is reaped.
          if (launch === starting) {
            launch = undefined;
          }
          run.launchRetirement = (async () => {
            const late = await starting.catch(() => null);
            await late?.close();
          })();
          // oxlint-disable-next-line promise/prefer-await-to-then -- closeRun joins this retained owner after initialization settles.
          void run.launchRetirement.catch(() => null);
          signal.throwIfAborted();
        }
      } catch (error) {
        if (launch === starting) {
          launch = undefined;
        }
        throw error;
      } finally {
        launching.abort();
      }
      if (browserClosing) {
        throw new Error('The workspace browser is closing.');
      }
      let retiring;
      const retire = () => {
        retiring ??= (async () => {
          try {
            await opened.close();
          } catch (error) {
            run.cleanup = 'failed';
            run.status = 'cleanup_failed';
            throw error;
          }
        })();
        // oxlint-disable-next-line promise/prefer-await-to-then -- The abort listener starts cleanup immediately; the caller awaits and reports its result below.
        void retiring.catch(() => null);
        return retiring;
      };
      if (signal.aborted) {
        await retire();
        signal.throwIfAborted();
      }
      const finished = new AbortController();
      const interrupted = once(signal, 'abort', { signal: finished.signal });
      const onAbort = () => {
        void retire();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const context = await Promise.race([opened.newContext(options), interrupted]);
        signal.throwIfAborted();
        return context;
      } finally {
        signal.removeEventListener('abort', onAbort);
        finished.abort();
        await retiring;
      }
    },
    close() {
      browserClosing ??= (async () => {
        try {
          if (current) {
            await closeRun(current);
          }
        } finally {
          // A failed launch has no browser to reap. A failure to close one must propagate.
          const opened = await launch?.catch(() => null);
          await opened?.close();
        }
      })();
      return browserClosing;
    },
  };
  const token = randomBytes(24).toString('hex');
  let closing;

  function sameOwner(run, owner, version) {
    return current === run && run.owner === owner && run.ownerVersion === version;
  }

  function samePhase(run, owner, version) {
    return sameOwner(run, owner, version) && !run.session?.closed;
  }

  function expireHumanSession(run) {
    clearTimeout(run.expiryTimer);
    const deadline = Date.now() + 300_000;
    const expiryVersion = run.ownerVersion;
    run.expiryVersion = expiryVersion;
    run.sessionExpiresAt = deadline;
    run.expiryTimer = setTimeout(() => {
      if (
        current === run &&
        run.expiryVersion === expiryVersion &&
        run.sessionExpiresAt === deadline &&
        run.owner !== 'stopped'
      ) {
        stopRun(run, 'expired');
      }
    }, 300_000);
  }

  // oxlint-disable-next-line eslint/complexity -- Transfer must check both ownership and availability before and after invalidation.
  async function takeControl(run, version, signal) {
    try {
      await waitForDecision(() => run.promise, signal);
    } catch (error) {
      if (signal.aborted && sameOwner(run, 'draining-to-human', version)) {
        stopRun(run, 'handoff_unavailable');
        return;
      }
      throw error;
    }
    if (!sameOwner(run, 'draining-to-human', version)) {
      return;
    }
    if (!run.session?.browser()) {
      stopRun(run, 'handoff_unavailable');
      return;
    }
    await waitForDecision(() => run.session.invalidateReferences(), signal);
    if (!sameOwner(run, 'draining-to-human', version)) {
      return;
    }
    if (!run.session.browser()) {
      stopRun(run, 'handoff_unavailable');
      return;
    }
    run.status = 'paused';
    run.result = null;
    run.setOwner('human');
    expireHumanSession(run);
    run.addEvent('control', 'Agent work drained. You control the browser.');
  }

  async function returnControl(run, version, origin, signal) {
    await waitForDecision(() => run.humanPromise, signal);
    if (!samePhase(run, 'draining-to-agent', version)) {
      return;
    }
    await waitForDecision(() => run.session.invalidateReferences(), signal);
    await run.session.base.read_page({ tab_id: null, filter: 'all' }, { signal });
    await run.session.capture({ signal });
    signal.throwIfAborted();
    if (!samePhase(run, 'draining-to-agent', version)) {
      return;
    }
    run.controller = new AbortController();
    run.status = 'running';
    run.result = null;
    run.setOwner('agent');
    run.addEvent('control', 'Fresh workspace state observed. Agent control resumed.');
    run.promise = executeRun({ browser, origin, apiKey, models, run });
  }

  function transferFailed(run, owner, version) {
    if (!sameOwner(run, owner, version)) {
      return;
    }
    stopRun(run, 'handoff_failed');
    run.addEvent('control', 'Control transfer failed. No automatic resume.');
  }

  async function finishTransfer(run, owner, version, origin) {
    const controller = new AbortController();
    run.transferController = controller;
    const timeout = setTimeout(() => controller.abort(new Error('Control transfer expired.')), 5000);
    const { signal } = controller;
    try {
      await (owner === 'draining-to-human'
        ? takeControl(run, version, signal)
        : returnControl(run, version, origin, signal));
    } catch {
      transferFailed(run, owner, version);
    } finally {
      clearTimeout(timeout);
      if (run.transferController === controller) {
        run.transferController = null;
      }
      run.transferActive = false;
      finishCleanup(run);
    }
  }

  function serveLiveView(url, response) {
    if (!current || url.searchParams.get('run') !== current.id) {
      json(response, 404, { error: 'This browser view is no longer current.' });
      return;
    }
    const view = current.liveView;
    if (current.owner === 'stopped' || current.session?.closed) {
      json(response, 410, { error: 'The browser view has ended.' });
      return;
    }
    if (
      !current.session?.matches(current.session.viewBinding) ||
      !matchesImage(url, current.session.viewBinding)
    ) {
      json(response, 409, { error: 'This page view is no longer current.' });
      return;
    }
    if (!view?.frame) {
      const closed = view?.state.status === 'closed';
      json(response, closed ? 410 : 409, {
        error: closed ? 'The browser view has closed.' : 'The browser view is starting.',
      });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(view.frame);
  }

  function serveScreenshot(url, response) {
    if (!current?.screenshot || url.searchParams.get('run') !== current.id) {
      json(response, 404, { error: 'Screenshot unavailable.' });
      return;
    }
    if (
      !matchesImage(url, current.screenshotBinding) ||
      (current.owner !== 'stopped' && !current.session.matches(current.screenshotBinding))
    ) {
      json(response, 409, { error: 'This saved page is no longer current.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(current.screenshot);
  }

  function serveRead(url, response) {
    if (url.pathname === '/api/state') {
      void refreshPolledView(current);
      json(response, 200, {
        liveAvailable: {
          responses: Boolean(apiKey && models.responses),
          decisions: Boolean(apiKey && models.decisions),
        },
        run: snapshot(current),
      });
      return;
    }
    if (url.pathname === '/api/view') {
      serveLiveView(url, response);
      return;
    }
    if (url.pathname === '/api/screenshot') {
      serveScreenshot(url, response);
      return;
    }
    json(response, 404, { error: 'Unknown route.' });
  }

  function startError(body) {
    if (
      ![undefined, 'browser'].includes(body.environment) ||
      body.taskId !== 'reservation' ||
      !['decisions', 'responses'].includes(body.api) ||
      !['live', 'rehearsal'].includes(body.mode)
    ) {
      return 'Choose Book a table, an available API, and run mode.';
    }
    if (body.mode === 'rehearsal' && body.api !== 'decisions') {
      return 'Rehearsal uses Decisions. Choose Live API for Responses.';
    }
    if (body.mode === 'live' && (!apiKey || !models[body.api])) {
      return 'Configure a server API key and a model for the selected API.';
    }
    return null;
  }

  function start(body, response, origin) {
    if (runBusy(current)) {
      json(response, 409, { error: 'Stop the current run before starting another.' });
      return;
    }
    const error = startError(body);
    if (error) {
      json(response, 400, { error });
      return;
    }
    current = createRun(body);
    const currentRun = current;
    current.stop = (reason) => stopRun(currentRun, reason);
    current.close = () => closeRun(currentRun);
    current.addEvent(
      'start',
      `${current.mode === 'live' ? 'Live API' : 'Scripted rehearsal'} · ${tasks[current.taskId].title}`,
    );
    current.promise = executeRun({ browser, origin, apiKey, models, run: current });
    json(response, 200, snapshot(current));
  }

  async function serveInput(run, body, response) {
    if (run.owner === 'human' && !run.humanPromise && run.session?.page && !run.uncertainEffects) {
      if (!validateInput(body, run.session.page)) {
        json(response, 400, { error: 'Choose a valid bounded browser input.' });
        return;
      }
      run.humanPromise = humanInput(run, body);
      try {
        await run.humanPromise;
        json(response, 200, { accepted: true });
      } catch {
        json(response, 409, { error: 'The input outcome is uncertain. No automatic resume.' });
      } finally {
        run.humanPromise = null;
        finishCleanup(run);
      }
      return;
    }
    json(response, 409, { error: 'The browser is not accepting this control action.' });
  }

  // oxlint-disable-next-line eslint/complexity -- Bind all ownership and view transitions to the same run and control version before branching.
  async function serveOwnership(pathname, body, response, origin, run) {
    if (run.transferActive) {
      json(response, 409, { error: 'Wait for the current control transfer to finish.' });
      return;
    }
    if (body.ownerVersion !== run.ownerVersion || run.owner === 'stopped' || run.session?.closed) {
      json(response, 409, { error: 'This control phase is no longer current.' });
      return;
    }
    const initialTake =
      pathname === '/api/take-control' &&
      !run.session?.taskPage &&
      body.tabId === null &&
      body.sequence === null;
    if (!initialTake && !run.session?.matches(body)) {
      json(response, 409, { error: 'This browser page is no longer current.' });
      return;
    }
    if (pathname === '/api/take-control' && run.owner === 'agent') {
      run.setOwner('draining-to-human');
      run.controller.abort();
      run.settleApproval(false);
      const version = run.ownerVersion;
      run.transferActive = true;
      run.transferPromise = finishTransfer(run, 'draining-to-human', version, origin);
      json(response, 200, { accepted: true });
      return;
    }
    if (pathname === '/api/return-control' && run.owner === 'human') {
      if (run.humanPromise) {
        json(response, 409, { error: 'Finish or stop your current action before returning control.' });
        return;
      }
      run.setOwner('draining-to-agent');
      const version = run.ownerVersion;
      run.transferActive = true;
      run.transferPromise = finishTransfer(run, 'draining-to-agent', version, origin);
      json(response, 200, { accepted: true });
      return;
    }
    if (pathname === '/api/input') {
      await serveInput(run, body, response);
      return;
    }
    json(response, 409, { error: 'The browser is not accepting this control action.' });
  }

  async function serveControl(url, request, response, origin) {
    const body = await readBody(request);
    if (url.pathname === '/api/start') {
      start(body, response, origin);
      return;
    }
    if (!current || body.runId !== current.id) {
      json(response, 409, { error: 'This run is no longer current.' });
      return;
    }
    const run = current;
    if (url.pathname === '/api/stop') {
      stopRun(run);
      json(response, 200, { stopped: true });
      return;
    }
    if (['/api/take-control', '/api/return-control', '/api/input'].includes(url.pathname)) {
      await serveOwnership(url.pathname, body, response, origin, run);
      return;
    }
    if (url.pathname === '/api/approval') {
      if (
        (current.owner !== 'agent' && !(current.owner === 'human' && current.humanPromise)) ||
        body.ownerVersion !== current.ownerVersion ||
        !run.session?.matches(body) ||
        !current.approval ||
        (current.approval.expiresAt !== undefined && Date.now() >= current.approval.expiresAt) ||
        body.approvalId !== current.approval.id ||
        typeof body.approved !== 'boolean'
      ) {
        json(response, 409, { error: 'This approval is no longer pending.' });
        return;
      }
      if (!body.approved) {
        current.refused = true;
        stopRun(current, 'refused');
      }
      current.addEvent(
        'approval',
        body.approved ? 'Operator approved the action.' : 'Operator refused the action.',
      );
      current.settleApproval(body.approved);
      json(response, 200, { accepted: true });
      return;
    }
    json(response, 404, { error: 'Unknown route.' });
  }

  // oxlint-disable-next-line complexity -- Keep admission before the existing page and effect routes.
  const server = createServer(async (request, response) => {
    try {
      // Use the server's bound address, never an incoming Host to construct the origin.
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin)
      ) {
        json(response, 403, { error: 'This demo accepts only its bound loopback origin.' });
        return;
      }
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && servePage(url.pathname, response)) {
        return;
      }
      if (request.headers['x-demo-token'] !== token) {
        json(response, 403, { error: 'A dashboard token is required.' });
        return;
      }
      if (request.method === 'GET') {
        serveRead(url, response);
      } else if (request.method === 'POST') {
        await serveControl(url, request, response, origin);
      } else {
        json(response, 404, { error: 'Unknown route.' });
      }
    } catch {
      json(response, 400, { error: 'Invalid demo request.' });
    }
  });
  server.listen(port, '127.0.0.1');
  try {
    await once(server, 'listening');
  } catch (error) {
    await browser.close();
    throw error;
  }
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    launchUrl: `http://127.0.0.1:${server.address().port}/#token=${token}`,
    close() {
      closing ??= (async () => {
        const run = current;
        if (run) {
          stopRun(run);
        }
        const timer = new AbortController();
        const expired = Symbol('shutdown deadline');
        const pending = Promise.allSettled([
          run?.promise,
          run?.humanPromise,
          run?.transferPromise,
          run ? closeRun(run) : undefined,
          browser.close(),
          promisify(server.close.bind(server))(),
        ]);
        let results;
        try {
          results = await Promise.race([pending, delay(35_000, expired, { signal: timer.signal })]);
          if (results === expired) {
            if (run) {
              run.cleanup = 'failed';
            }
            throw new Error('Workspace cleanup did not finish.');
          }
        } finally {
          timer.abort();
        }
        const failed = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (run?.cleanup === 'failed') {
          failed.push(new Error('Workspace cleanup failed.'));
        }
        if (failed.length) {
          throw new AggregateError(failed, 'Workspace cleanup failed.');
        }
      })();
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keyFlag = process.argv.indexOf('--key-file');
  const apiKey = keyFlag === -1 ? process.env['OPENAI_API_KEY'] : await readKey(process.argv[keyFlag + 1]);
  const models = {
    decisions: process.env['OPENAI_DECISIONS_MODEL'] ?? process.env['OPENAI_MODEL'],
    responses: process.env['OPENAI_RESPONSES_MODEL'] ?? process.env['OPENAI_MODEL'],
  };
  const app = await createDemoServer({
    apiKey,
    models,
    port: Number(process.env['DEMO_PORT'] ?? 0),
  });
  console.log(
    process.stdout.isTTY
      ? `Browser-use example (private link): ${app.launchUrl}`
      : `Browser-use example: ${app.origin}
Private link unavailable in redirected output; relaunch in a terminal.`,
  );
  const close = async () => {
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      const failures = error instanceof AggregateError ? error.errors : [error];
      for (const failure of failures) {
        console.error(failure.message);
      }
      process.exit(1);
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
