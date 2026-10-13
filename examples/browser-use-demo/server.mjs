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
import { MixedHostInputRefusedError } from '../responses/browser/mixed-session.mjs';
import { createDemoSession, executeDemo } from './runner.mjs';
import { createBusinessState } from './business-state.mjs';
import { exportRun, recordReceipt } from './run-receipt.mjs';
import { createDesktopSession, desktopInput, executeDesktop } from './desktop-session.mjs';
import { createFieldworkMixed, executeFieldworkMixed } from './mixed-session.mjs';
import { createDiagnosticCapture, RunDiagnostics } from './diagnostics.mjs';
import { waitForDecision } from '../responses/browser/file-state.mjs';
import { exampleBrowserChannel } from '../responses/browser/driver.mjs';

const templates = await Promise.all(
  ['index.html', 'fixture.html', 'notes.html', 'traces.html'].map((name) =>
    readFile(new URL(name, import.meta.url), 'utf-8'),
  ),
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
    const value = await handle.readFile('utf-8');
    return value.trim();
  } finally {
    await handle.close();
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function matchesImage(url, binding) {
  if (binding?.desktopId) {
    return (
      url.searchParams.get('desktopId') === binding.desktopId &&
      url.searchParams.get('ownerVersion') === String(binding.ownerVersion) &&
      (!binding.view ||
        (url.searchParams.get('view') === binding.view &&
          url.searchParams.get('tabId') === binding.tabId &&
          url.searchParams.get('sequence') === String(binding.sequence)))
    );
  }
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
  try {
    await run?.session?.refreshView(
      run.environment === 'browser' ? undefined : { signal: run.pollController.signal, poll: true },
    );
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
    desktop: run.environment === 'browser' ? null : (run.session?.binding() ?? null),
    mixedDisclosed:
      run.environment === 'mixed' &&
      run.session?.permits({ type: 'type', text: 'Desktop receipt D-2201' }) === true,
    screenshotBinding: run.screenshotBinding ?? null,
    humanInputBusy: Boolean(run.humanPromise || run.transferActive),
    scrollTarget: run.scrollTarget ? { x: run.scrollTarget.x, y: run.scrollTarget.y } : null,
    uncertainEffects: Boolean(run.uncertainEffects),
    closing: run.owner === 'stopped' && runBusy(run),
    sessionExpiresAt: run.sessionExpiresAt ?? null,
    turns: run.turns,
    stepLimit: run.stepLimit,
    result: run.result,
    requests: run.requests,
    requestHeadersMs: Math.round(run.requestHeadersMs),
    diagnostics: run.diagnostics.summary(run.requests),
    elapsedMs: Math.round(
      run.owner === 'stopped' && !run.agentActive ? run.elapsedMs : performance.now() - run.started,
    ),
    screenshotAt: run.screenshotAt,
    history: {
      dropped: run.checkpointDropped,
      checkpoints: run.checkpoints.map(({ sequence, at, atMs, owner, role }) => ({
        sequence,
        at,
        atMs,
        owner,
        role,
      })),
    },
    view: currentView(run),
    events: run.events,
    eventsDropped: run.eventsDropped,
    approval: run.approval,
    fixture: run.business ? run.business.snapshot() : run.fixture,
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

const dashboardPages = new Map([
  ['/', templates[0]],
  ['/traces', templates[3]],
]);

function servePage(pathname, response, current) {
  if (pathname.startsWith('/fixture/')) {
    const [taskId, notes, section, ...rest] = pathname.slice('/fixture/'.length).split('/');
    if (
      !Object.hasOwn(tasks, taskId) ||
      (['stock', 'service', 'files'].includes(taskId) &&
        (current?.taskId !== taskId || current.owner === 'stopped')) ||
      rest.length ||
      (notes && (notes !== 'notes' || !['brief', 'rules'].includes(section)))
    ) {
      json(response, 404, { error: 'Unknown task.' });
      return true;
    }
    const { items, ...task } = tasks[taskId];
    const visibleTask = {
      ...task,
      kind: taskId,
      ...(['stock', 'service', 'files'].includes(taskId)
        ? {
            effectURL: `/fixture/${taskId}/effect?run=${current.id}${taskId === 'files' ? '&case=INTAKE-501' : ''}`,
          }
        : {}),
      ...(items ? { items: items.map(({ expected: _expected, ...item }) => item) } : {}),
    };
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; ${['stock', 'service', 'files'].includes(taskId) ? "connect-src 'self'; " : ''}form-action 'none'; frame-ancestors 'none'`,
    });
    response.end(
      notes
        ? templates[2].replace(
            '__NOTES__',
            JSON.stringify({
              title: task.title,
              section: section === 'brief' ? 'Brief' : 'Rules',
              text: section === 'brief' ? task.summary : task.instruction,
            }),
          )
        : templates[1].replace('__TASK__', JSON.stringify(visibleTask)),
    );
    return true;
  }
  if (dashboardPages.has(pathname)) {
    const nonce = randomBytes(18).toString('hex');
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    });
    response.end(dashboardPages.get(pathname).replace('__NONCE__', nonce));
    return true;
  }
  return false;
}

function createRun(body, diagnosticCapture) {
  let settle;
  return {
    id: randomUUID(),
    workspaceToken: randomBytes(24).toString('hex'),
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
    stepLimit: ['desktop', 'mixed'].includes(body.environment) || body.api === 'decisions' ? 20 : 24,
    requestHeadersMs: 0,
    diagnostics: new RunDiagnostics(diagnosticCapture, body.mode),
    checkpoints: [],
    checkpointSequence: 0,
    checkpointDropped: 0,
    checkpointBytes: 0,
    events: [],
    eventsDropped: 0,
    controller: new AbortController(),
    pollController: new AbortController(),
    started: performance.now(),
    elapsedMs: 0,
    setOwner(owner) {
      if (this.owner !== owner) {
        this.pollController.abort();
        this.pollController = new AbortController();
        this.owner = owner;
        this.ownerVersion += 1;
        this.scrollTarget = null;
        recordReceipt(this, { kind: 'control', owner });
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
    settleApproval(value, outcome = value ? 'approved' : 'cancelled') {
      if (settle) {
        const resolve = settle;
        settle = undefined;
        this.approval = null;
        recordReceipt(this, { kind: 'approval', outcome });
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
      recordReceipt(this, { kind: 'approval', outcome: 'offered' });
      this.addEvent('approval', `Waiting for approval: ${label}`);
      const timeout = setTimeout(
        () => {
          this.approvalExpired = true;
          this.stop('approval_expired');
        },
        expiresAt === undefined ? 120_000 : Math.max(0, expiresAt - Date.now()),
      );
      const started = performance.now();
      try {
        return await pending.promise;
      } finally {
        this.diagnostics.measure('approvalMs', performance.now() - started);
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
    if (run.cleanup === 'pending') {
      run.cleanup = 'completed';
      recordReceipt(run, { kind: 'cleanup', outcome: 'completed' });
    }
    run.diagnostics.record('run', { status: run.status, result: run.result, cleanup: run.cleanup });
    run.diagnostics.close();
  }
}

function closeRun(run) {
  clearTimeout(run.expiryTimer);
  run.sessionExpiresAt = null;
  run.closePromise ??= (async () => {
    if (run.cleanup !== 'failed') {
      run.cleanup = 'pending';
      recordReceipt(run, { kind: 'cleanup', outcome: 'pending' });
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
      recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
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
  let approvalOutcome = 'cancelled';
  if (reason === 'approval_expired') {
    approvalOutcome = 'expired';
  } else if (reason === 'refused') {
    approvalOutcome = 'refused';
  }
  run.settleApproval(false, approvalOutcome);
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
    open_notes: [],
    switch_tab: ['tab_id'],
    close_notes: [],
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
  if (action === 'open_notes' || action === 'close_notes') {
    return true;
  }
  if (action === 'switch_tab') {
    return typeof body.tab_id === 'string';
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
      case 'open_notes': {
        const { session } = run;
        session.notesTabId = await session.base.new_tab({ url: `${session.notesURL}brief` });
        session.page.once('close', () => {
          session.notesTabId = null;
        });
        break;
      }
      case 'switch_tab': {
        await run.session.base.switch_tab({ tab_id: body.tab_id });
        break;
      }
      case 'close_notes': {
        await run.session.base.close_tab({ tab_id: run.session.notesTabId });
        run.session.notesTabId = null;
        break;
      }
      default: {
        throw new Error('Unknown browser input.');
      }
    }
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
      if (run.environment === 'mixed') {
        run.initialization = createFieldworkMixed({ runtimeDir: options.desktopRuntime, run });
      } else if (run.environment === 'desktop') {
        run.initialization = createDesktopSession({ runtimeDir: options.desktopRuntime, run });
      } else {
        run.initialization = createDemoSession({ ...options, onClose: () => run.stop('browser_closed') });
      }
      await run.initialization;
    }
    run.controller.signal.throwIfAborted();
    if (run.environment === 'mixed') {
      await executeFieldworkMixed(options);
    } else if (run.environment === 'desktop') {
      await executeDesktop(options);
    } else {
      await executeDemo(options);
    }
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
export async function createDemoServer({
  apiKey,
  models = {},
  port = 0,
  desktopRuntime,
  diagnosticCapture,
} = {}) {
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
            recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
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
    if (run.environment !== 'browser') {
      if (!samePhase(run, 'draining-to-human', version) || !run.session?.binding()) {
        return;
      }
      await run.session.invalidateReferences({ signal });
      if (!samePhase(run, 'draining-to-human', version)) {
        return;
      }
      run.status = 'paused';
      run.setOwner('human');
      const humanVersion = run.ownerVersion;
      await run.session.capture({ signal });
      signal.throwIfAborted();
      if (!samePhase(run, 'human', humanVersion)) {
        return;
      }
      expireHumanSession(run);
      run.addEvent(
        'control',
        run.environment === 'mixed'
          ? 'Agent work drained. You control this mixed task. Select Host browser or Guest editor.'
          : 'Agent work drained. You control the isolated desktop.',
      );
      return;
    }
    if (!sameOwner(run, 'draining-to-human', version)) {
      return;
    }
    if (run.session?.closed || !run.session?.page || run.session.page.isClosed()) {
      stopRun(run, 'handoff_unavailable');
      return;
    }
    await waitForDecision(() => run.session.invalidateReferences(), signal);
    if (!sameOwner(run, 'draining-to-human', version)) {
      return;
    }
    if (run.session.closed || !run.session.page || run.session.page.isClosed()) {
      stopRun(run, 'handoff_unavailable');
      return;
    }
    run.status = 'paused';
    run.setOwner('human');
    expireHumanSession(run);
    run.addEvent('control', 'Agent work drained. You control the browser.');
  }

  async function returnControl(run, version, origin, signal) {
    await waitForDecision(() => run.humanPromise, signal);
    if (!samePhase(run, 'draining-to-agent', version)) {
      return;
    }
    if (run.environment === 'browser') {
      await waitForDecision(() => run.session.invalidateReferences(), signal);
      await run.session.base.read_page({ tab_id: null, filter: 'all' }, { signal });
    } else {
      await run.session.invalidateReferences({ signal });
    }
    await run.session.capture({ signal });
    signal.throwIfAborted();
    if (!samePhase(run, 'draining-to-agent', version)) {
      return;
    }
    clearTimeout(run.expiryTimer);
    run.sessionExpiresAt = null;
    run.controller = new AbortController();
    run.status = 'running';
    run.result = null;
    run.setOwner('agent');
    run.addEvent('control', 'Fresh workspace state observed. Agent control resumed.');
    run.promise = executeRun({ browser, origin, apiKey, models, desktopRuntime, run });
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
      if (run.environment !== 'browser' && current === run && run.transferActive && run.owner !== 'stopped') {
        stopRun(run, 'handoff_failed');
        run.addEvent(
          'control',
          run.environment === 'mixed'
            ? 'Mixed control transfer failed. Both workspaces will close; no automatic resume.'
            : 'Desktop control transfer failed. No automatic resume.',
        );
      } else {
        transferFailed(run, owner, version);
      }
    } finally {
      clearTimeout(timeout);
      if (run.transferController === controller) {
        run.transferController = null;
      }
      run.transferActive = false;
      finishCleanup(run);
    }
  }

  function serveCheckpoint(url, response) {
    const value = url.searchParams.get('checkpoint');
    const sequence = Number(value);
    const checkpoint =
      current &&
      url.searchParams.get('run') === current.id &&
      Number.isSafeInteger(sequence) &&
      sequence > 0 &&
      String(sequence) === value &&
      current.checkpoints.find((entry) => entry.sequence === sequence);
    if (!checkpoint) {
      json(response, 404, { error: 'Saved checkpoint unavailable.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': current.environment === 'browser' ? 'image/jpeg' : 'image/png',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(checkpoint.pixels);
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
      'Content-Type': current.environment === 'browser' ? 'image/jpeg' : 'image/png',
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
      'Content-Type': current.environment === 'browser' ? 'image/jpeg' : 'image/png',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(current.screenshot);
  }

  function serveTrace(url, response) {
    if (!diagnosticCapture) {
      json(response, 404, {
        error: 'No capture selected. Start with --diagnostics or --diagnostics-reopen ID.',
      });
      return;
    }
    try {
      if (url.pathname === '/api/traces') {
        json(response, 200, { capture: diagnosticCapture.id, traces: diagnosticCapture.traces() });
      } else if (url.pathname === '/api/trace') {
        json(response, 200, diagnosticCapture.trace(url.searchParams.get('trace')));
      } else {
        const { pixels, mime } = diagnosticCapture.frame(
          url.searchParams.get('trace'),
          url.searchParams.get('frame'),
        );
        response.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        response.end(pixels);
      }
    } catch {
      json(response, 404, { error: 'Saved trace or frame unavailable.' });
    }
  }

  function serveInspector(url, response) {
    if (
      !current ||
      url.searchParams.get('run') !== current.id ||
      current.environment !== 'browser' ||
      current.taskId === 'files' ||
      !current.session?.toolset ||
      current.owner !== 'human'
    ) {
      json(response, 409, { error: 'Take control of a browser task to inspect its tools.' });
      return;
    }
    const helper = current.session.toolset('human');
    json(response, 200, { tools: helper.tools() });
    helper.close();
  }

  function serveRead(url, response) {
    if (['/api/traces', '/api/trace', '/api/trace-frame'].includes(url.pathname)) {
      serveTrace(url, response);
      return;
    }
    if (url.pathname === '/api/state') {
      void refreshPolledView(current);
      json(response, 200, {
        liveAvailable: Boolean(apiKey && (models.decisions || models.responses)),
        desktopAvailable: Boolean(desktopRuntime && apiKey && models.responses),
        run: snapshot(current),
      });
      return;
    }
    if (url.pathname === '/api/inspector') {
      serveInspector(url, response);
      return;
    }
    if (url.pathname === '/api/export') {
      if (!current || url.searchParams.get('run') !== current.id) {
        json(response, 404, { error: 'No matching run receipt.' });
        return;
      }
      json(response, 200, exportRun(current));
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
    if (url.pathname === '/api/checkpoint') {
      serveCheckpoint(url, response);
      return;
    }
    json(response, 404, { error: 'Unknown route.' });
  }

  function startError(body) {
    const desktop = ['desktop', 'mixed'].includes(body.environment);
    if (
      ![undefined, 'browser', 'desktop', 'mixed'].includes(body.environment) ||
      (desktop ? body.taskId !== body.environment : !Object.hasOwn(tasks, body.taskId)) ||
      !['decisions', 'responses'].includes(body.api) ||
      !['live', 'rehearsal'].includes(body.mode)
    ) {
      return 'Choose an available task, API, and run mode.';
    }
    if (desktop && (!desktopRuntime || body.api !== 'responses' || body.mode !== 'live')) {
      return 'The isolated desktop needs a configured runtime and live Responses.';
    }
    if (body.taskId === 'files' && body.allowFileUpload !== true) {
      return 'Opt in to the synthetic file upload before starting file intake.';
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
    const desktop = ['desktop', 'mixed'].includes(body.environment);
    current = createRun(body, diagnosticCapture);
    current.diagnostics.record('run', { api: body.api, mode: body.mode, taskId: body.taskId });
    if (['stock', 'service', 'files'].includes(body.taskId)) {
      current.business = createBusinessState(tasks[body.taskId], current);
    }
    const currentRun = current;
    current.stop = (reason) => stopRun(currentRun, reason);
    current.close = () => closeRun(currentRun);
    current.addEvent(
      'start',
      `${current.mode === 'live' ? 'Live API' : 'Scripted rehearsal'} · ${desktop ? 'Route and save a desktop receipt' : tasks[current.taskId].title}`,
    );
    current.promise = executeRun({ browser, origin, apiKey, models, desktopRuntime, run: current });
    json(response, 200, snapshot(current));
  }

  async function serveDesktopInput(run, body, response) {
    if (run.owner !== 'human' || run.humanPromise || run.uncertainEffects) {
      json(response, 409, { error: 'The desktop is not accepting input.' });
      return;
    }
    const point = run.scrollTarget?.ownerVersion === run.ownerVersion ? run.scrollTarget : null;
    let input = body;
    if (run.environment === 'mixed') {
      const { view: _view, tabId: _tabId, sequence: _sequence, ...rest } = body;
      input = rest;
    }
    const action = desktopInput(input, point);
    if (!action || (run.environment === 'mixed' && !run.session.permits(action))) {
      json(response, 400, { error: 'Choose a valid bounded desktop input.' });
      return;
    }
    const version = run.ownerVersion;
    run.humanPromise = run.session.humanInput(action);
    try {
      await run.humanPromise;
      if (action.type === 'click' && run.owner === 'human' && run.ownerVersion === version) {
        run.scrollTarget = { x: action.x, y: action.y, ownerVersion: version };
      }
      run.addEvent('human', `Human ${body.action} completed; desktop state captured.`);
      json(response, 200, { accepted: true });
    } catch (error) {
      if (error instanceof MixedHostInputRefusedError) {
        json(response, 400, { error: error.message });
        return;
      }
      run.uncertainEffects ||= run.session.hasUncertainEffects();
      stopRun(run, run.uncertainEffects ? 'uncertain' : 'input_failed');
      json(response, 409, {
        error: 'The desktop input did not finish. Session closed; no automatic resume.',
      });
    } finally {
      run.humanPromise = null;
      finishCleanup(run);
    }
  }

  async function serveInput(run, body, response) {
    if (run.environment !== 'browser') {
      await serveDesktopInput(run, body, response);
      return;
    }
    if (run.owner === 'human' && !run.humanPromise && run.session?.page && !run.uncertainEffects) {
      if (!validateInput(body, run.session.page)) {
        json(response, 400, { error: 'Choose a valid bounded browser input.' });
        return;
      }
      const selected = run.session.browser();
      if (
        (body.action === 'open_notes' && run.session.notesTabId) ||
        (body.action === 'close_notes' && !run.session.notesTabId) ||
        (body.action === 'switch_tab' && !selected.tabs.some((tab) => tab.id === body.tab_id))
      ) {
        json(response, 409, { error: 'Choose an available Task or Notes tab.' });
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
    if (run.taskId === 'files') {
      json(response, 403, {
        error: 'View and Stop are available. File selection is controlled by the approved fixture task.',
      });
      return;
    }
    if (run.transferActive) {
      json(response, 409, { error: 'Wait for the current control transfer to finish.' });
      return;
    }
    if (body.ownerVersion !== run.ownerVersion || run.owner === 'stopped' || run.session?.closed) {
      json(response, 409, { error: 'This control phase is no longer current.' });
      return;
    }
    const initialTake =
      run.environment === 'browser' &&
      pathname === '/api/take-control' &&
      !run.session?.taskPage &&
      body.tabId === null &&
      body.sequence === null;
    if (!initialTake && !run.session?.matches(body)) {
      json(response, 409, { error: 'This browser page is no longer current.' });
      return;
    }
    if (pathname === '/api/mixed-view' && run.environment === 'mixed') {
      if (
        run.humanPromise ||
        !['agent', 'human'].includes(run.owner) ||
        !['host', 'guest'].includes(body.selected)
      ) {
        json(response, 409, { error: 'Wait until this mixed workspace can change views.' });
        return;
      }
      await run.session.selectView(body.selected);
      json(response, 200, { accepted: true });
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
    if (pathname === '/api/inspect') {
      if (
        run.environment !== 'browser' ||
        run.owner !== 'human' ||
        run.humanPromise ||
        run.uncertainEffects ||
        !run.session?.toolset ||
        body.consent !== true ||
        typeof body.name !== 'string' ||
        !body.args ||
        typeof body.args !== 'object' ||
        Array.isArray(body.args)
      ) {
        json(response, 409, { error: 'Take control and consent to one manual browser call.' });
        return;
      }
      const helper = run.session.toolset('human');
      const id = randomUUID();
      run.humanPromise = helper.execute({
        type: 'function_call',
        status: 'completed',
        id,
        call_id: id,
        name: body.name,
        arguments: JSON.stringify(body.args),
      });
      try {
        const output = await run.humanPromise;
        json(response, 200, { output });
      } catch {
        json(response, 409, {
          error: 'The tool did not finish. Read the current page and check its outcome.',
        });
      } finally {
        helper.close();
        run.humanPromise = null;
        finishCleanup(run);
      }
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
    if (
      ['/api/take-control', '/api/return-control', '/api/input', '/api/mixed-view', '/api/inspect'].includes(
        url.pathname,
      )
    ) {
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

  function workspaceAllowed(pathname, cookieHeader) {
    const task = pathname.startsWith('/fixture/') ? pathname.split('/')[2] : undefined;
    if (!['stock', 'service', 'files'].includes(task)) {
      return true;
    }
    return Boolean(
      current?.business &&
      current.taskId === task &&
      (cookieHeader ?? '')
        .split(';')
        .some((cookie) => cookie.trim() === `fieldwork_workspace=${current.workspaceToken}`),
    );
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
      if (!workspaceAllowed(url.pathname, request.headers.cookie)) {
        json(response, 403, { error: 'An active workspace capability is required.' });
        return;
      }
      if (request.method === 'GET' && servePage(url.pathname, response, current)) {
        return;
      }
      if (
        request.method === 'POST' &&
        ['/fixture/stock/effect', '/fixture/service/effect', '/fixture/files/effect'].includes(url.pathname)
      ) {
        if (
          request.headers.origin !== origin ||
          !current?.business ||
          url.pathname !== `/fixture/${current.taskId}/effect` ||
          url.searchParams.get('run') !== current.id ||
          (current.taskId === 'files' && url.search !== `?run=${current.id}&case=${tasks.files.job}`)
        ) {
          json(response, 403, { error: 'No active business workspace.' });
          return;
        }
        const receipt =
          current.taskId === 'files'
            ? await current.business.receiveFile(request)
            : await current.business.receive(await readBody(request));
        json(response, receipt.status, receipt.result);
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
              recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
            }
            throw new Error(
              `Workspace cleanup did not finish. Private evidence retained: ${run?.session?.ledgerDirectory ?? run?.ledgerDirectory ?? 'no active checkpoint'}`,
            );
          }
        } finally {
          timer.abort();
        }
        const failed = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (run?.cleanup === 'failed') {
          failed.push(
            new Error(
              `Workspace cleanup failed. Private evidence retained: ${run.session?.ledgerDirectory ?? run.ledgerDirectory ?? 'no active checkpoint'}`,
            ),
          );
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
  const runtimeFlag = process.argv.indexOf('--desktop-runtime');
  const desktopRuntime = runtimeFlag === -1 ? undefined : process.argv[runtimeFlag + 1];
  const reopen = process.argv.indexOf('--diagnostics-reopen');
  if (reopen !== -1 && (!process.argv[reopen + 1] || process.argv.includes('--diagnostics'))) {
    throw new Error('Choose --diagnostics or --diagnostics-reopen ID.');
  }
  const diagnosticCapture =
    process.argv.includes('--diagnostics') || reopen !== -1
      ? createDiagnosticCapture({
          secrets: [apiKey, ...Object.values(models)],
          captureId: reopen === -1 ? undefined : process.argv[reopen + 1],
        })
      : undefined;
  const app = await createDemoServer({
    apiKey,
    models,
    desktopRuntime,
    diagnosticCapture,
    port: Number(process.env['DEMO_PORT'] ?? 0),
  });
  console.log(
    process.stdout.isTTY
      ? `Browser-use example (private link): ${app.launchUrl}`
      : `Browser-use example: ${app.origin}
Private link unavailable in redirected output; relaunch in a terminal.`,
  );
  if (diagnosticCapture) {
    console.log(
      `Private diagnostic files: ${diagnosticCapture.directory}. Reopen ID: ${diagnosticCapture.id}. Inspect them before sharing.`,
    );
  }
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
