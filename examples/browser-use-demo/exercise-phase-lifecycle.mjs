// Fixed local owners only: no model request, native input or external service.
// oxlint-disable eslint/no-await-in-loop -- Each case restores its owned launcher or guest factory before the next case.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createDesktopSession, executeDesktop } from './desktop-session.mjs';
import { createFieldworkMixed } from './mixed-session.mjs';
import { createDemoServer } from './server.mjs';

const { create } = Desktop;
const { launch } = chromium;
const results = [];
const control = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser.tabId,
  sequence: run.browser.sequence,
});
const desktopControl = (run) => ({ runId: run.id, ...run.desktop });
const trial = () => ({
  id: crypto.randomUUID(),
  owner: 'agent',
  ownerVersion: 0,
  controller: new AbortController(),
  started: performance.now(),
  checkpoints: [],
  checkpointSequence: 0,
  checkpointBytes: 0,
  checkpointDropped: 0,
  receipts: [],
  events: [],
  turns: 0,
  stepLimit: 3,
  requests: 0,
  addEvent(kind, text) {
    this.events.push({ kind, text });
  },
  stop(reason) {
    if (this.owner !== 'stopped') {
      this.owner = 'stopped';
      this.stopReason = reason;
      this.controller.abort();
    }
  },
});
const native = () => ({
  id: 'controlled-owner',
  captureFrame: async () => ({ frame: Buffer.from('frame'), width: 1024, height: 768 }),
  stop: async () => true,
  verify: async () => ({ file_matches: false, file_empty: true, browser_matches: false, browser_effects: 0 }),
  async seal(options) {
    return this.verify(options);
  },
  withComputer: async () => true,
});
async function check(name, body) {
  try {
    await body();
    results.push({ name, pass: true });
  } catch (error) {
    results.push({ name, pass: false, error: String(error) });
  } finally {
    Desktop.create = create;
    chromium.launch = launch;
  }
}
await check('desktop Return cancels the human poll without stopping the guest', async () => {
  const guest = native();
  const verifying = Promise.withResolvers();
  const polling = Promise.withResolvers();
  const allowPoll = Promise.withResolvers();
  let held = false;
  let heldSignal;
  let stops = 0;
  let captures = 0;
  guest.verify = async ({ signal } = {}) => {
    verifying.resolve();
    assert.ok(signal);
    const interrupted = Promise.withResolvers();
    signal.addEventListener('abort', interrupted.resolve, { once: true });
    if (signal.aborted) {
      interrupted.resolve();
    }
    await interrupted.promise;
    signal.throwIfAborted();
  };
  guest.captureFrame = async ({ signal } = {}) => {
    captures += 1;
    if (held) {
      held = false;
      heldSignal = signal;
      polling.resolve();
      if (signal) {
        const interrupted = Promise.withResolvers();
        signal.addEventListener('abort', interrupted.resolve, { once: true });
        await Promise.race([allowPoll.promise, interrupted.promise]);
        signal.throwIfAborted();
      } else {
        await allowPoll.promise;
      }
    }
    return { frame: Buffer.from(`frame-${captures}`), width: 1024, height: 768 };
  };
  guest.stop = async () => {
    stops += 1;
  };
  Desktop.create = async () => guest;
  const app = await createDemoServer({
    port: 0,
    apiKey: 'synthetic-no-request',
    models: { responses: 'synthetic' },
    desktopRuntime: 'controlled-factory-only',
  });
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  const call = async (path, body) => {
    const reply = await fetch(app.origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Demo-Token': token, Origin: app.origin, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(reply.status, 200, `${path}: ${reply.status}`);
    return reply.json();
  };
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const { run } = await call('/api/state');
      if (predicate(run)) {
        return run;
      }
      await delay(15);
    }
    assert.fail('Expected control phase did not settle');
  };
  try {
    await call('/api/start', { environment: 'desktop', taskId: 'desktop', api: 'responses', mode: 'live' });
    assert.equal(await Promise.race([verifying.promise, delay(2000, 'blocked')]), undefined);
    const agent = await waitFor((run) => run.owner === 'agent' && run.desktop);
    await call('/api/take-control', desktopControl(agent));
    const human = await waitFor((run) => run.owner === 'human' && !run.humanInputBusy);
    assert.equal(stops, 0);
    held = true;
    await call('/api/state');
    assert.equal(await Promise.race([polling.promise, delay(1500, 'blocked')]), undefined);
    await call('/api/return-control', desktopControl(human));
    const resumed = await waitFor((run) => run.owner === 'agent' || run.owner === 'stopped');
    assert.equal(resumed.owner, 'agent');
    assert.equal(heldSignal?.aborted, true);
    assert.equal(stops, 0);
    assert.equal(resumed.requests, 0);
    assert.equal(resumed.uncertainEffects, false);
    assert.equal(resumed.screenshotBinding.ownerVersion, human.ownerVersion + 1);
    await call('/api/stop', { runId: resumed.id });
    allowPoll.resolve();
    const stopped = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(stopped.requests, 0);
    assert.equal(stops, 1);
  } finally {
    allowPoll.resolve();
    await app.close();
  }
});
for (const boundary of ['initial', 'final']) {
  await check(`desktop Take ${boundary}`, async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const run = trial();
    const guest = native();
    let calls = 0;
    let phase;
    let stops = 0;
    guest.stop = async () => {
      stops += 1;
    };
    guest.verify = async ({ signal } = {}) => {
      calls += 1;
      if (calls === (boundary === 'initial' ? 1 : 2)) {
        entered.resolve();
        if (signal) {
          const interrupted = Promise.withResolvers();
          signal.addEventListener('abort', interrupted.resolve, { once: true });
          await Promise.race([release.promise, interrupted.promise]);
          signal.throwIfAborted();
        } else {
          await release.promise;
        }
      }
      return { file_matches: false, browser_matches: false };
    };
    Desktop.create = async () => guest;
    const session = await createDesktopSession({ runtimeDir: 'unused', run });
    try {
      phase = executeDesktop({ apiKey: 'synthetic', models: { responses: 'synthetic' }, run });
      await entered.promise;
      run.owner = 'draining-to-human';
      run.controller.abort();
      const done = await Promise.race([phase.then(() => true), delay(650, false)]);
      assert.equal(done, true, 'Agent verification retained Take until its guest reply');
      assert.equal(stops, 0, 'Take must retain the owned desktop');
      assert.equal(run.requests, 0);
    } finally {
      release.resolve();
      await phase;
      await session.close();
    }
  });
}
for (const boundary of ['initial capture', 'final capture', 'poll capture']) {
  await check(`desktop Take ${boundary}`, async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const run = trial();
    const guest = native();
    let captures = 0;
    let stops = 0;
    let phase;
    let poll;
    guest.stop = async () => {
      stops += 1;
    };
    guest.verify = async () => ({ file_matches: true, browser_matches: true });
    guest.captureFrame = async ({ signal } = {}) => {
      captures += 1;
      if (captures === (boundary === 'final capture' ? 3 : 2)) {
        entered.resolve();
        if (signal) {
          const interrupted = Promise.withResolvers();
          signal.addEventListener('abort', interrupted.resolve, { once: true });
          await Promise.race([release.promise, interrupted.promise]);
          signal.throwIfAborted();
        } else {
          await release.promise;
        }
      }
      return { frame: Buffer.from(`capture-${captures}`), width: 1024, height: 768 };
    };
    Desktop.create = async () => guest;
    const session = await createDesktopSession({ runtimeDir: 'unused', run });
    try {
      if (boundary === 'poll capture') {
        poll = session.refreshView();
        // oxlint-disable-next-line promise/prefer-await-to-then -- Observe the shared poll immediately while the phase can also join it.
        void poll.catch(() => null);
      }
      phase = executeDesktop({ apiKey: 'synthetic', models: { responses: 'synthetic' }, run });
      await entered.promise;
      run.owner = 'draining-to-human';
      run.ownerVersion += 1;
      run.controller.abort();
      assert.equal(await Promise.race([phase.then(() => true), delay(650, false)]), true);
      if (poll) {
        assert.notEqual(await Promise.race([Promise.allSettled([poll]), delay(650, 'pending')]), 'pending');
      }
      assert.equal(stops, 0);
      assert.equal(run.requests, 0);
      assert.notEqual(run.stopReason, 'view_failed');
      run.owner = 'human';
      run.ownerVersion += 1;
      release.resolve();
      await session.capture();
      assert.equal(run.screenshot.toString(), `capture-${captures}`);
      assert.equal(session.viewBinding.ownerVersion, run.ownerVersion);
    } finally {
      release.resolve();
      await Promise.allSettled([phase, poll]);
      await session.close();
    }
  });
}
for (const fails of [false, true]) {
  await check(`mixed launch Stop cleanup failure=${fails}`, async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const run = trial();
    const guest = native();
    let closes = 0;
    let contexts = 0;
    Desktop.create = async () => guest;
    chromium.launch = async () => {
      entered.resolve();
      await release.promise;
      return {
        async close() {
          closes += 1;
          if (fails) {
            throw new Error('Controlled close failure');
          }
        },
        async newContext() {
          contexts += 1;
          throw new Error('No context after Stop');
        },
      };
    };
    const setup = createFieldworkMixed({ runtimeDir: 'unused', run });
    const outcome = setup.then(
      () => 'opened',
      () => 'stopped',
    );
    try {
      await entered.promise;
      run.stop('stopped');
      const closing = run.session.close();
      const settled = await Promise.race([outcome, delay(650, 'pending')]);
      assert.equal(settled, 'stopped', 'Launch retained the active setup after Stop');
      assert.equal(closes, 0);
      assert.ok(run.launchRetirement, 'Late launch must have a retained cleanup owner');
      release.resolve();
      const finished = await Promise.allSettled([closing, run.launchRetirement]);
      assert.equal(finished[1].status, fails ? 'rejected' : 'fulfilled');
      assert.equal(closes, 1);
      assert.equal(contexts, 0);
      assert.equal(run.stopReason, 'stopped');
    } finally {
      release.resolve();
      await Promise.allSettled([setup, run.session.close(), run.launchRetirement]);
    }
  });
}
if (process.argv.includes('--browser')) {
  await check('mixed observation uses fresh bounded transfer signal after old agent drains', async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const run = trial();
    const guest = native();
    let held = false;
    const { verify } = guest;
    guest.verify = async ({ signal } = {}) => {
      if (held) {
        entered.resolve();
        if (signal) {
          const interrupted = Promise.withResolvers();
          signal.addEventListener('abort', interrupted.resolve, { once: true });
          await Promise.race([release.promise, interrupted.promise]);
          signal.throwIfAborted();
        } else {
          await release.promise;
        }
      }
      return verify();
    };
    Desktop.create = async () => guest;
    const session = await createFieldworkMixed({ runtimeDir: 'unused', run });
    const transfer = new AbortController();
    let work;
    try {
      run.owner = 'draining-to-human';
      run.ownerVersion += 1;
      run.controller.abort();
      held = true;
      work = session.invalidateReferences({ signal: transfer.signal });
      // oxlint-disable-next-line promise/prefer-await-to-then -- Observe the owned handoff before its finite cancellation.
      const result = work.then(
        () => 'accepted',
        () => 'cancelled',
      );
      assert.equal(await Promise.race([entered.promise.then(() => true), delay(1800, false)]), true);
      transfer.abort(new Error('Bounded transfer expired'));
      assert.equal(await Promise.race([result, delay(650, 'pending')]), 'cancelled');
      held = false;
      release.resolve();
      await session.invalidateReferences({ signal: new AbortController().signal });
      run.owner = 'human';
      run.ownerVersion += 1;
      await session.capture({ signal: new AbortController().signal });
      assert.equal(session.matches(run.screenshotBinding), true, 'Take must publish a current-owner frame');
      assert.notEqual(run.stopReason, 'view_failed');
      assert.equal(run.requests, 0);
    } finally {
      release.resolve();
      await Promise.allSettled([work]);
      await session.close();
    }
  });
  for (const owner of ['human', 'draining-to-human', 'draining-to-agent', 'stopped', 'refused']) {
    await check(`mixed disconnect ${owner}`, async () => {
      const run = trial();
      Desktop.create = async () => native();
      let browser;
      chromium.launch = async (...options) => {
        browser = await launch.call(chromium, ...options);
        return browser;
      };
      const session = await createFieldworkMixed({ runtimeDir: 'unused', run });
      try {
        run.owner = owner === 'refused' ? 'agent' : owner;
        if (owner === 'refused') {
          run.refused = true;
        }
        if (owner === 'stopped') {
          run.stopReason = 'view_failed';
        }
        run.controller.abort();
        await browser.close();
        assert.equal(
          run.stopReason,
          {
            stopped: 'view_failed',
            refused: undefined,
            human: 'browser_closed',
            'draining-to-human': 'browser_closed',
            'draining-to-agent': 'browser_closed',
          }[owner],
        );
      } finally {
        await session.close();
        assert.equal(browser.isConnected(), false);
      }
    });
  }
  for (const boundary of ['read', 'capture']) {
    await check(`browser Return Stop at ${boundary}`, async () => {
      let stage = 'initial';
      const initial = Promise.withResolvers();
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      let app;
      chromium.launch = async (...options) => {
        const browser = await launch.call(chromium, ...options);
        const originalContext = browser.newContext.bind(browser);
        browser.newContext = async (...contextOptions) => {
          const context = await originalContext(...contextOptions);
          const newPage = context.newPage.bind(context);
          context.newPage = async (...pageOptions) => {
            const page = await newPage(...pageOptions);
            const screenshot = page.screenshot.bind(page);
            const frame = page.mainFrame();
            const locate = frame.locator.bind(frame);
            frame.locator = (...args) => {
              const locator = locate(...args);
              const evaluateHandle = locator.evaluateHandle.bind(locator);
              locator.evaluateHandle = async (...handleOptions) => {
                if (stage === 'return' && boundary === 'read' && args[0] === 'html') {
                  stage = 'waiting';
                  entered.resolve();
                  await release.promise;
                }
                return evaluateHandle(...handleOptions);
              };
              return locator;
            };
            page.screenshot = async (...args) => {
              if (stage === 'initial') {
                stage = 'taking';
                initial.resolve();
                await release.promise;
              } else if (stage === 'return' && boundary === 'capture') {
                stage = 'waiting';
                entered.resolve();
                await release.promise;
              }
              return screenshot(...args);
            };
            return page;
          };
          return context;
        };
        return browser;
      };
      try {
        app = await createDemoServer({ port: 0, models: { decisions: 'fixture' } });
        const token = new URL(app.launchUrl).hash.slice('#token='.length);
        const request = async (route, body) => {
          const response = await fetch(app.origin + route, {
            method: body ? 'POST' : 'GET',
            headers: { Origin: app.origin, 'X-Demo-Token': token, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          assert.equal(response.status, 200, route);
          return response.json();
        };
        const stateUntil = async (accept) => {
          const limit = performance.now() + 2200;
          while (performance.now() < limit) {
            const { run } = await request('/api/state');
            if (accept(run)) {
              return run;
            }
            await delay(15);
          }
          throw new Error('Bounded transfer did not settle.');
        };
        await request('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' });
        assert.equal(
          await Promise.race([initial.promise.then(() => true), delay(2000, false)]),
          true,
          'initial capture',
        );
        const ready = await stateUntil((run) => run.browser?.tabId);
        await request('/api/take-control', control(ready));
        const human = await stateUntil((run) => run.owner === 'human' && !run.humanInputBusy);
        assert.equal(human.status, 'paused');
        stage = 'return';
        await request('/api/return-control', control(human));
        assert.equal(
          await Promise.race([entered.promise.then(() => true), delay(2000, false)]),
          true,
          'return boundary',
        );
        await request('/api/stop', { runId: human.id });
        const stopped = await stateUntil((run) => run.owner === 'stopped' && !run.humanInputBusy);
        assert.equal(stopped.status, 'stopped');
        release.resolve();
        const settled = await stateUntil((run) => !run.closing);
        assert.equal(settled.owner, 'stopped');
        assert.equal(settled.status, 'stopped');
      } finally {
        release.resolve();
        await app?.close();
      }
    });
  }
}
console.log(JSON.stringify({ results, api_calls: 0, vm_calls: 0 }));
assert.ok(
  results.every(({ pass }) => pass),
  JSON.stringify(results.filter(({ pass }) => !pass)),
);
