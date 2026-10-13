// Controlled launch/frame failures around the real local dashboard. No API or guest starts.
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import timers, { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createDemoServer } from './server.mjs';
import { executeFieldworkMixed } from './mixed-session.mjs';
import { RunDiagnostics } from './diagnostics.mjs';

const originalLaunch = chromium.launch;
const originalDesktop = Desktop.create;
let launchCount = 0;
let currentBrowser;
let reaped = false;
let failSetup = false;
let failCleanup = false;
let afterVerification = false;
let rejectFrame = false;
const originalRecord = RunDiagnostics.prototype.record;
RunDiagnostics.prototype.record = function record(kind, data) {
  originalRecord.call(this, kind, data);
  if (afterVerification && kind === 'verification' && data.verified === true) {
    rejectFrame = true;
  }
};
chromium.launch = async function launch(options) {
  launchCount += 1;
  if (launchCount === 1) {
    throw new Error('Controlled first launch failure');
  }
  currentBrowser = await originalLaunch.call(this, options);
  const newContext = currentBrowser.newContext.bind(currentBrowser);
  currentBrowser.newContext = async (contextOptions) => {
    const context = await newContext(contextOptions);
    if (failSetup) {
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        page.goto = async () => {
          throw new Error('Controlled browser setup failure');
        };
        return page;
      };
    }
    if (afterVerification) {
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const screenshot = page.screenshot.bind(page);
        page.screenshot = (...args) => {
          if (rejectFrame) {
            throw new Error('Controlled frame failure after independent verification');
          }
          return screenshot(...args);
        };
        return page;
      };
    }
    if (failCleanup) {
      context.close = async () => {
        throw new Error('Controlled workspace cleanup failure');
      };
    }
    return context;
  };
  return currentBrowser;
};
Desktop.create = async () => ({
  id: 'controlled-frame-owner',
  async captureFrame() {
    throw new Error('Controlled first-frame failure');
  },
  async stop() {
    reaped = true;
  },
});
let app;
try {
  app = await createDemoServer({
    port: 0,
    apiKey: 'synthetic',
    models: { responses: 'synthetic' },
    desktopRuntime: 'controlled-factory-only',
  });
  let token = new URL(app.launchUrl).hash.slice('#token='.length);
  const call = async (path, body) => {
    const response = await fetch(app.origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const until = async (condition) => {
    const deadline = performance.now() + 15_000;
    while (performance.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      const state = await call('/api/state');
      if (condition(state.run)) {
        return state.run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(25);
    }
    throw new Error('Dashboard recovery exceeded the local test deadline.');
  };
  const browserTask = { taskId: 'invoices', api: 'decisions', mode: 'rehearsal' };
  const first = await call('/api/start', browserTask);
  await until((run) => run.id === first.id && run.owner === 'stopped' && !run.closing);
  assert.equal(launchCount, 1);
  const second = await call('/api/start', browserTask);
  await until((run) => run.id === second.id && Boolean(run.approval));
  assert.equal(launchCount, 2);
  await currentBrowser.close();
  await until((run) => run.id === second.id && run.owner === 'stopped' && !run.closing);
  const third = await call('/api/start', browserTask);
  await until((run) => run.id === third.id && Boolean(run.approval));
  assert.equal(launchCount, 3);
  await call('/api/stop', { runId: third.id });
  await until((run) => run.owner === 'stopped' && !run.closing);
  failSetup = true;
  const setup = await call('/api/start', browserTask);
  await until((run) => run.id === setup.id && run.owner === 'stopped' && !run.closing);
  failSetup = false;
  const setupReceipt = await call(`/api/export?run=${setup.id}`);
  assert.equal(setupReceipt.status, 'failed');
  assert.equal(setupReceipt.requests, 0);
  assert.equal(setupReceipt.cleanup, 'completed');
  console.log('PASS owned browser setup cleanup preserves the original failure reason');
  console.log('PASS launch failure and disconnect each allow a fresh Browser run on the same server');

  const desktop = await call('/api/start', {
    environment: 'desktop',
    taskId: 'desktop',
    api: 'responses',
    mode: 'live',
  });
  await until((run) => run.id === desktop.id && run.owner === 'stopped' && !run.closing);
  const exported = await call(`/api/export?run=${desktop.id}`);
  assert.equal(exported.status, 'view_failed');
  assert.equal(exported.result, 'unverified');
  assert.equal(exported.requests, 0);
  assert.equal(exported.cleanup, 'completed');
  assert.equal(reaped, true);
  console.log('PASS failed initial desktop frame retains view_failed through dashboard export and cleanup');

  const mixed = {
    controller: new AbortController(),
    owner: 'agent',
    status: 'running',
    stopReason: null,
    events: [],
    addEvent(kind, text) {
      this.events.push({ kind, text });
    },
    session: {
      async runPhase() {
        mixed.stopReason = 'view_failed';
        mixed.controller.abort();
        return { status: 'stopped', verified: false, uncertainEffects: { file: false, desktop: false } };
      },
      hasUncertainEffects() {
        return false;
      },
    },
  };
  await executeFieldworkMixed({ apiKey: 'synthetic', models: { responses: 'synthetic' }, run: mixed });
  assert.equal(mixed.status, 'view_failed');
  assert.equal(mixed.result, 'unverified');
  assert.equal(mixed.events.at(-1).kind, 'result');
  console.log('PASS mixed view_failed survives a stopped phase proof; no API requests');

  afterVerification = true;
  const captured = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
  await until((run) => run.id === captured.id && run.owner === 'stopped' && !run.closing);
  const captureReceipt = await call(`/api/export?run=${captured.id}`);
  assert.equal(rejectFrame, true, 'The injected failure must occur after verification.');
  assert.equal(captureReceipt.result, 'verified');
  assert.equal(captureReceipt.status, 'failed');
  assert.equal(captureReceipt.cleanup, 'completed');
  afterVerification = false;
  rejectFrame = false;
  console.log('PASS final browser capture failure preserves verified outcome through dashboard cleanup');

  failCleanup = true;
  const checked = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
  const checkedState = await until((run) => run.id === checked.id && run.owner === 'stopped');
  const checkedReceipt = await call(`/api/export?run=${checked.id}`);
  assert.equal(checkedReceipt.result, 'verified', JSON.stringify(checkedReceipt));
  assert.equal(checkedReceipt.status, 'cleanup_failed');
  assert.equal(checkedReceipt.cleanup, 'failed');
  assert.deepEqual(checkedState.fixture.results, [
    { id: 'T-1042', choice: 'Billing' },
    { id: 'T-1043', choice: 'Technical' },
    { id: 'T-1044', choice: 'Account' },
  ]);
  const replacement = await fetch(`${app.origin}/api/start`, {
    method: 'POST',
    headers: { 'X-Demo-Token': token, Origin: app.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(browserTask),
  });
  assert.equal(replacement.status, 409);
  console.log('PASS verified business result survives failed cleanup; replacement remains unavailable');
  const closingBrowser = currentBrowser.close.bind(currentBrowser);
  const release = Promise.withResolvers();
  const reapedBrowser = Promise.withResolvers();
  let browserCloseCalls = 0;
  const realDelay = timers.setTimeout;
  currentBrowser.close = async () => {
    browserCloseCalls += 1;
    await release.promise;
    try {
      await closingBrowser();
    } finally {
      reapedBrowser.resolve(true);
    }
  };
  // Advance only the documented 35s application shutdown timer; browser and request timers stay real.
  timers.setTimeout = (ms, value, options) => realDelay(ms === 35_000 ? 20 : ms, value, options);
  syncBuiltinESMExports();
  try {
    const closing = app.close();
    assert.equal(app.close(), closing, 'Shutdown callers share one owned cleanup');
    await assert.rejects(closing, /Workspace cleanup did not finish.*Private evidence retained/u);
    assert.equal(currentBrowser.isConnected(), true, 'The held cleanup did not finish before the deadline');
  } finally {
    timers.setTimeout = realDelay;
    syncBuiltinESMExports();
    release.resolve();
    const browserReaped = await Promise.race([reapedBrowser.promise, delay(2000, false)]);
    if (!browserReaped) {
      await closingBrowser();
    }
    assert.equal(browserReaped, true, 'Server shutdown must reap its browser even if context cleanup failed');
  }
  assert.equal(currentBrowser.isConnected(), false);
  assert.equal(browserCloseCalls, 1, 'Concurrent callers cannot start another browser close');
  console.log('PASS the shutdown deadline covers cached browser.close and observes eventual cleanup');

  app = await createDemoServer({ port: 0, apiKey: 'synthetic', models: { responses: 'synthetic' } });
  token = new URL(app.launchUrl).hash.slice('#token='.length);
  const failing = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
  await until((run) => run.id === failing.id && run.owner === 'stopped');
  const failedReceipt = await call(`/api/export?run=${failing.id}`);
  assert.equal(failedReceipt.cleanup, 'failed');
  const originalClose = currentBrowser.close.bind(currentBrowser);
  const browserError = new Error('Controlled browser shutdown failure');
  browserCloseCalls = 0;
  currentBrowser.close = async () => {
    browserCloseCalls += 1;
    throw browserError;
  };
  try {
    const closing = app.close();
    assert.equal(app.close(), closing);
    await assert.rejects(closing, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors.some((entry) => entry.message === 'Controlled workspace cleanup failure'));
      assert.ok(error.errors.includes(browserError));
      return true;
    });
    assert.equal(browserCloseCalls, 1);
    assert.equal(app.close(), closing, 'A failed shutdown stays owned without retrying it');
    assert.equal(browserCloseCalls, 1);
    console.log('PASS context and browser cleanup failures both survive, with one browser close attempt');
  } finally {
    await originalClose();
  }
} finally {
  try {
    await (failCleanup ? assert.rejects(app.close(), /cleanup (?:failed|did not finish)/u) : app?.close());
  } finally {
    chromium.launch = originalLaunch;
    Desktop.create = originalDesktop;
    RunDiagnostics.prototype.record = originalRecord;
  }
}
