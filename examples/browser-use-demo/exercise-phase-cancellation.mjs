import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { executeDemo } from './runner.mjs';

const mode = process.argv[2] ?? 'context';
assert.ok(
  [
    'context',
    'cookies',
    'cookies-take',
    'view-take',
    'inspect-actions',
    'cleanup-failure',
    'launch',
    'launch-close-failure',
    'verify-stop',
    'verify-loss',
    'verify-owner',
    'verify-version',
    'verify-normal',
    'verify-capture-stop',
  ].includes(mode),
);

if (mode === 'inspect-actions') {
  // Each finite gate belongs to this synthetic page. No browser or network request is needed.
  await Promise.all(
    [
      ['candidates', 3, 0],
      ['before action', 4, 0],
      ['after action', 5, 1],
      ['live view', 0, 1],
    ].map(async ([boundary, blockedAt, actionCount]) => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const effects = [];
      let inspections = 0;
      let captures = 0;
      let liveViews = 0;
      const point = { tabId: 'task', sequence: 1, tabs: [{ id: 'task', role: 'Task' }] };
      const run = {
        owner: 'agent',
        ownerVersion: 0,
        status: 'running',
        result: null,
        taskId: 'support',
        api: 'decisions',
        mode: 'rehearsal',
        controller: new AbortController(),
        stepLimit: 3,
        turns: 0,
        requests: 0,
        screenshot: Buffer.from('fixture'),
        screenshotBinding: point,
        diagnostics: {
          record() {
            /* Diagnostic export is outside this fixture. */
          },
          measure() {
            /* Timing export is outside this fixture. */
          },
          event() {
            /* Diagnostic export is outside this fixture. */
          },
        },
        addEvent() {
          /* The effect and proof below record the observed outcome. */
        },
        session: {
          taskTabId: 'task',
          base: {
            async read_page() {
              return {
                version: 1,
                text: 'Fixture',
                omitted: [],
                elements: [{ ref: 'billing', role: 'button', label: 'Billing' }],
              };
            },
            async click() {
              effects.push('click');
            },
          },
          async capture() {
            captures += 1;
            if (boundary === 'live view' && captures === 3) {
              run.owner = 'draining-to-human';
              run.ownerVersion += 1;
              run.controller.abort();
            }
          },
          async refreshView() {
            liveViews += 1;
            entered.resolve();
            await release.promise;
          },
          checkTarget() {
            /* The synthetic fixture has one current target. */
          },
          browser: () => point,
          matches: (view) => view === point,
          taskPage: {
            url: () => 'http://127.0.0.1/fixture/support',
            locator: () => ({
              async evaluate() {
                inspections += 1;
                if (inspections === blockedAt) {
                  entered.resolve();
                  await release.promise;
                }
                return { revision: 0, finished: false, fields: {}, results: [] };
              },
            }),
          },
        },
      };
      const phase = executeDemo({ origin: 'http://127.0.0.1', apiKey: 'synthetic', models: {}, run });
      try {
        assert.equal(
          await Promise.race([
            entered.promise.then(() => true),
            phase.then(() => boundary === 'live view'),
            delay(1200, false),
          ]),
          true,
          `Did not reach ${boundary}`,
        );
        run.owner = 'draining-to-human';
        run.ownerVersion += 1;
        run.controller.abort();
        assert.equal(
          await Promise.race([phase.then(() => true), delay(650, false)]),
          true,
          `Take retained ${boundary}`,
        );
        assert.equal(effects.length, actionCount);
        assert.equal(liveViews, 0, 'Action proof must not await live view startup');
        assert.equal(run.requests, 0);
        assert.equal(run.result, 'unverified');
        release.resolve();
        await delay(0);
        assert.equal(effects.length, actionCount, 'Late inspection cannot dispatch or add effects');
        assert.equal(run.result, 'unverified');
        console.log(`PASS ${boundary}: Take drains with ${actionCount} completed actions and no late proof`);
      } finally {
        release.resolve();
        await phase;
      }
    }),
  );
} else if (mode.startsWith('verify-')) {
  const lateInspection = ['verify-stop', 'verify-loss'].includes(mode);
  await Promise.all(
    (lateInspection ? [false, true] : [false]).map(async (completedBeforeStop) => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const events = [];
      let inspections = 0;
      const run = {
        owner: 'agent',
        ownerVersion: 0,
        status: 'running',
        result: null,
        taskId: 'support',
        api: 'decisions',
        mode: 'rehearsal',
        controller: new AbortController(),
        addEvent(...event) {
          events.push(event);
        },
        session: {
          base: {},
          async capture() {
            if (mode === 'verify-capture-stop') {
              entered.resolve();
              await release.promise;
            }
          },
          taskPage: {
            locator() {
              return {
                async evaluate() {
                  inspections += 1;
                  if (!completedBeforeStop || inspections > 1) {
                    entered.resolve();
                    await release.promise;
                  }
                  return {
                    revision: 3,
                    finished: true,
                    fields: {},
                    results: [
                      { id: 'T-1042', choice: 'Billing' },
                      { id: 'T-1043', choice: 'Technical' },
                      { id: 'T-1044', choice: 'Account' },
                    ],
                  };
                },
              };
            },
          },
        },
      };
      if (completedBeforeStop) {
        // Establish real verified evidence before the second inspection is interrupted.
        await executeDemo({ origin: 'http://127.0.0.1', apiKey: 'synthetic', models: {}, run });
        assert.equal(run.result, 'verified');
        assert.equal(run.status, 'complete');
        run.status = 'running';
      }
      const phase = executeDemo({ origin: 'http://127.0.0.1', apiKey: 'synthetic', models: {}, run });
      await entered.promise;
      if (['verify-stop', 'verify-loss', 'verify-capture-stop'].includes(mode)) {
        run.owner = 'stopped';
        run.ownerVersion += 1;
        run.stopReason = mode === 'verify-loss' ? 'browser_closed' : 'stopped';
        run.controller.abort();
      } else if (mode === 'verify-owner') {
        run.owner = 'human';
        run.status = 'human';
        run.ownerVersion += 1;
      } else if (mode === 'verify-version') {
        run.ownerVersion += 1;
      }
      try {
        if (lateInspection) {
          assert.equal(
            await Promise.race([phase.then(() => true), delay(650, false)]),
            true,
            'Stop or browser loss left verification waiting for the unfinished inspection',
          );
        }
      } finally {
        release.resolve();
      }
      await phase;
      // Let the released, effect-free evaluation settle before checking publication.
      await delay(0);
      const interruptedBeforeProof =
        (lateInspection && !completedBeforeStop) || mode === 'verify-capture-stop';
      assert.equal(run.result, interruptedBeforeProof ? 'unverified' : 'verified');
      const expectedInspections = (mode === 'verify-capture-stop' ? 0 : 1) + (completedBeforeStop ? 1 : 0);
      assert.equal(inspections, expectedInspections);
      const expected = {
        'verify-stop': 'stopped',
        'verify-loss': 'browser_closed',
        'verify-owner': 'human',
        'verify-version': 'running',
        'verify-normal': 'complete',
        'verify-capture-stop': 'stopped',
      };
      assert.equal(run.status, expected[mode]);
      console.log(
        `PASS ${mode}: ${completedBeforeStop ? 'completed' : 'initial'} proof has result=${run.result}, status=${run.status}`,
      );
    }),
  );
} else if (mode === 'view-take') {
  const originalLaunch = chromium.launch;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reaped = Promise.withResolvers();
  let app;
  let context;
  let page;
  let disposed = 0;
  let activeStart;
  chromium.launch = async (options) => {
    const browser = await originalLaunch.call(chromium, options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      context = await newContext(...args);
      const newPage = context.newPage.bind(context);
      context.newPage = async (...pageArgs) => {
        page = await newPage(...pageArgs);
        const start = page.screencast.start.bind(page.screencast);
        page.screencast.start = async (...castArgs) => {
          const capture = await start(...castArgs);
          const dispose = capture.dispose.bind(capture);
          capture.dispose = async () => {
            disposed += 1;
            await dispose();
            reaped.resolve();
          };
          if (!activeStart) {
            activeStart = capture;
            entered.resolve();
            await release.promise;
          }
          return capture;
        };
        return page;
      };
      return context;
    };
    return browser;
  };
  try {
    app = await createDemoServer({ port: 0 });
    const token = new URL(app.launchUrl).hash.slice('#token='.length);
    const call = async (route, body, expected = 200) => {
      const response = await fetch(app.origin + route, {
        method: body ? 'POST' : 'GET',
        headers: { Origin: app.origin, 'X-Demo-Token': token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, expected, route);
      return response.json();
    };
    const first = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
    assert.equal(await Promise.race([entered.promise.then(() => true), delay(2500, false)]), true);
    const { run: ready } = await call('/api/state');
    assert.equal(ready.id, first.id);
    await call('/api/take-control', {
      runId: ready.id,
      ownerVersion: ready.ownerVersion,
      tabId: ready.browser.tabId,
      sequence: ready.browser.sequence,
    });
    const deadline = performance.now() + 800;
    let handoff;
    while (performance.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- Observe one owned handoff while the finite capture gate stays held.
      ({ run: handoff } = await call('/api/state'));
      if (handoff.owner === 'human' || handoff.owner === 'stopped') {
        break;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(10);
    }
    assert.equal(handoff.owner, 'human', 'Take must drain final view setup before the held capture arrives');
    assert.equal(page.isClosed(), false);
    assert.equal(disposed, 0);
    assert.equal(handoff.closing, false);
    assert.notEqual(handoff.view.status, 'live');
    const binding = {
      runId: handoff.id,
      ownerVersion: handoff.ownerVersion,
      tabId: handoff.browser.tabId,
      sequence: handoff.browser.sequence,
    };
    const input = call('/api/input', { ...binding, action: 'scroll', direction: 'down', amount: 50 }, 409);
    const waiting = performance.now() + 800;
    let busy;
    while (performance.now() < waiting) {
      // oxlint-disable-next-line no-await-in-loop -- Await the admitted human input without releasing the producer.
      ({ run: busy } = await call('/api/state'));
      if (busy.humanInputBusy) {
        break;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(10);
    }
    assert.equal(busy.humanInputBusy, true);
    await call('/api/return-control', binding, 409);
    await call('/api/stop', { runId: first.id });
    assert.equal(
      await Promise.race([input.then(() => true), delay(800, false)]),
      true,
      'Stop must release human refresh waiting on the original producer',
    );
    const { run: stopping } = await call('/api/state');
    assert.equal(stopping.owner, 'stopped');
    assert.equal(stopping.closing, true, 'Workspace cleanup still owns the late capture');
    await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' }, 409);
    release.resolve();
    assert.equal(await Promise.race([reaped.promise.then(() => true), delay(1000, false)]), true);
    assert.equal(disposed, 1, 'The late capture belongs to the stale agent version and is closed once');
    const done = performance.now() + 1000;
    let finished;
    while (performance.now() < done) {
      // oxlint-disable-next-line no-await-in-loop -- Check the final cleanup of this run only.
      ({ run: finished } = await call('/api/state'));
      if (!finished.closing) {
        break;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(10);
    }
    assert.equal(finished.closing, false);
    assert.equal(page.isClosed(), true);
    console.log(
      'PASS Take preserves the page, human Return stays gated, Stop releases its waiter and joins one late capture',
    );
  } finally {
    release.resolve();
    await app?.close();
    chromium.launch = originalLaunch;
  }
} else {
  const originalLaunch = chromium.launch;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let holding = true;
  let launches = 0;
  const browsers = [];
  let firstBrowser;
  let firstClose;
  let app;
  chromium.launch = async function launch(options) {
    launches += 1;
    const browser = await originalLaunch.call(this, options);
    browsers.push(browser);
    if (!firstBrowser) {
      firstBrowser = browser;
      firstClose = browser.close.bind(browser);
    }
    if (mode === 'cleanup-failure' || mode === 'launch-close-failure') {
      const close = browser.close.bind(browser);
      browser.close = async () => {
        if (holding) {
          throw new Error('Controlled browser retirement failure');
        }
        return close();
      };
    }
    const create = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await create(contextOptions);
      if (holding && !mode.startsWith('cookies')) {
        entered.resolve();
        await release.promise;
      } else if (holding) {
        const install = context.addCookies.bind(context);
        context.addCookies = async (cookies) => {
          await install(cookies);
          entered.resolve();
          await release.promise;
        };
      }
      return context;
    };
    if (holding && mode.startsWith('launch')) {
      entered.resolve();
      await release.promise;
    }
    return browser;
  };
  try {
    app = await createDemoServer({ port: 0 });
    const token = new URL(app.launchUrl).hash.slice('#token='.length);
    const call = async (route, body, status = 200) => {
      const response = await fetch(app.origin + route, {
        method: body ? 'POST' : 'GET',
        headers: { Origin: app.origin, 'X-Demo-Token': token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, status, route);
      return response.json();
    };
    const until = async (predicate) => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Poll one owned transition with a finite deadline.
        const { run } = await call('/api/state');
        if (predicate(run)) {
          return run;
        }
        // oxlint-disable-next-line no-await-in-loop
        await delay(10);
      }
      throw new Error('The cancelled setup did not settle.');
    };
    const first = await call('/api/start', {
      taskId: mode.startsWith('cookies') ? 'stock' : 'support',
      api: 'decisions',
      mode: 'rehearsal',
    });
    await entered.promise;
    await (mode === 'cookies-take'
      ? call('/api/take-control', {
          runId: first.id,
          ownerVersion: first.ownerVersion,
          tabId: null,
          sequence: null,
        })
      : call('/api/stop', { runId: first.id }));
    if (mode === 'cookies-take') {
      const stopped = await until((run) => run.owner === 'stopped' && !run.closing);
      assert.equal(stopped.status, 'handoff_unavailable');
      assert.equal(stopped.result, 'unverified');
      const receipt = await call(`/api/export?run=${first.id}`);
      assert.equal(receipt.cleanup, 'completed');
      assert.equal(firstBrowser.isConnected(), true);
      assert.equal(firstBrowser.contexts().length, 0);
      holding = false;
      const next = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
      const completed = await until((run) => run.id === next.id && run.owner === 'stopped' && !run.closing);
      assert.equal(completed.status, 'complete');
      assert.equal(launches, 1);
      console.log(
        'PASS cookies Take: unavailable handoff closes the original context and permits safe reuse',
      );
    } else if (mode.startsWith('launch')) {
      const stopped = await until((run) => run.owner === 'stopped' && run.status === 'stopped');
      assert.equal(stopped.closing, true);
      const pending = await call(`/api/export?run=${first.id}`);
      assert.equal(pending.cleanup, 'pending');
      await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' }, 409);
      assert.equal(launches, 1);
      if (mode === 'launch') {
        holding = false;
      }
      release.resolve();
      if (mode === 'launch-close-failure') {
        await until((run) => run.status === 'cleanup_failed');
        const failed = await call(`/api/export?run=${first.id}`);
        assert.equal(failed.cleanup, 'failed');
        await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' }, 409);
      } else {
        await until((run) => !run.closing);
        const completedReceipt = await call(`/api/export?run=${first.id}`);
        assert.equal(completedReceipt.cleanup, 'completed');
        assert.equal(firstBrowser.isConnected(), false);
        const next = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
        const completed = await until((run) => run.id === next.id && !run.closing && run.owner === 'stopped');
        assert.equal(completed.status, 'complete');
        assert.equal(launches, 2);
      }
      console.log(`PASS ${mode}: active setup settles, admission waits for exactly one late launch owner`);
    } else if (mode === 'cleanup-failure') {
      await until((run) => run.status === 'cleanup_failed');
      const receipt = await call(`/api/export?run=${first.id}`);
      assert.equal(receipt.cleanup, 'failed');
      await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' }, 409);
      console.log('PASS failed browser retirement remains visible and prevents unsafe reuse');
    } else {
      const stopped = await until((run) => run.owner === 'stopped' && !run.closing);
      assert.equal(stopped.status, 'stopped');
      const receipt = await call(`/api/export?run=${first.id}`);
      assert.equal(receipt.cleanup, 'completed');
      assert.equal(firstBrowser.isConnected(), mode === 'cookies');
      assert.equal(firstBrowser.contexts().length, 0);
      holding = false;
      const next = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
      const completed = await until((run) => run.id === next.id && run.owner === 'stopped' && !run.closing);
      assert.equal(completed.status, 'complete');
      assert.equal(completed.result, 'verified');
      assert.equal(launches, mode === 'cookies' ? 1 : 2);
      console.log(
        `PASS ${mode}: Stop reaps resources and permits another run before the old protocol promise resolves`,
      );
    }
    holding = false;
    release.resolve();
    if (mode === 'cleanup-failure' || mode === 'launch-close-failure') {
      await firstClose();
      await assert.rejects(app.close(), /cleanup/iu);
    } else {
      await app.close();
    }
    assert.ok(browsers.every((browser) => !browser.isConnected()));
    app = null;
  } finally {
    holding = false;
    release.resolve();
    await firstClose?.().catch(() => null);
    await app?.close().catch(() => null);
    chromium.launch = originalLaunch;
  }
}
