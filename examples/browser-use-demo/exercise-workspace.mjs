// Real loopback and Chromium; the rehearsal path never calls an API.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { createDemoSession } from './runner.mjs';

const binding = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
const app = await createDemoServer({ port: 0 });
const token = new URL(app.launchUrl).hash.slice('#token='.length);
const { launch: originalLaunch } = chromium;
let browser;
chromium.launch = async function launch(...args) {
  browser = await originalLaunch.apply(this, args);
  return browser;
};
const headers = { 'X-Demo-Token': token, Origin: app.origin, 'Content-Type': 'application/json' };
const call = async (path, body) => {
  const response = await fetch(app.origin + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return response.json();
};
const waitFor = async (predicate) => {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- observe each new state before deciding.
    const { run } = await call('/api/state');
    if (predicate(run)) {
      return run;
    }
    // oxlint-disable-next-line no-await-in-loop -- bounded local polling.
    await delay(30);
  }
  throw new Error('The local workspace did not reach the expected state.');
};
let previousCookie = 'fieldwork_workspace=previous-unadmitted-run';
try {
  for (const taskId of ['stock', 'service']) {
    // oxlint-disable-next-line no-await-in-loop -- Each isolated task owns its approval and fixture effect.
    await call('/api/start', { taskId, api: 'decisions', mode: 'rehearsal' });
    // oxlint-disable-next-line no-await-in-loop
    const approved = await waitFor((run) => run.approval || run.owner === 'stopped');
    assert.ok(approved.approval);
    const taskPage = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url() === `${app.origin}/fixture/${taskId}`);
    assert.ok(taskPage);
    const waitForFunction = taskPage.waitForFunction.bind(taskPage);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let acknowledgement;
    taskPage.waitForFunction = async (...args) => {
      if (String(args[0]).includes('document.body.dataset.revision')) {
        entered.resolve();
        await release.promise;
        [, acknowledgement] = args;
      }
      return waitForFunction(...args);
    };
    try {
      // oxlint-disable-next-line no-await-in-loop
      await call('/api/approval', { ...binding(approved), approvalId: approved.approval.id, approved: true });
      assert.equal(
        // oxlint-disable-next-line no-await-in-loop -- Commit must precede the held DOM acknowledgement.
        await Promise.race([entered.promise, delay(2000, 'missing commit')]),
        undefined,
      );
      // oxlint-disable-next-line no-await-in-loop
      const { run: committed } = await call('/api/state');
      assert.equal(committed.fixture.revision, 1);
      assert.equal(committed.fixture.results.length, 1);
      const expectedVerified = taskId === 'service';
      assert.equal(committed.fixture.verified, expectedVerified);
      // oxlint-disable-next-line no-await-in-loop
      await call('/api/take-control', binding(committed));
      // oxlint-disable-next-line no-await-in-loop
      await delay(300);
      // oxlint-disable-next-line no-await-in-loop
      const { run: handoff } = await call('/api/state');
      assert.equal(handoff.owner, 'human', 'Committed action drain waited for the old DOM acknowledgement');
      assert.deepEqual(handoff.fixture, committed.fixture);
      assert.equal(handoff.result, expectedVerified ? 'verified' : 'unverified');
      assert.equal(handoff.status, 'paused');
      assert.equal(acknowledgement, undefined);
      // oxlint-disable-next-line no-await-in-loop
      await call('/api/stop', binding(handoff));
      release.resolve();
      // oxlint-disable-next-line no-await-in-loop
      const stopped = await waitFor((run) => !run.closing);
      assert.deepEqual(stopped.fixture, committed.fixture);
      assert.equal(stopped.result, expectedVerified ? 'verified' : 'unverified');
      console.log(`PASS ${taskId}: committed evidence survives Take before the stale DOM acknowledgement`);
    } finally {
      release.resolve();
      taskPage.waitForFunction = waitForFunction;
    }
  }
  for (const taskId of ['stock', 'service', 'files', 'stock']) {
    const staleCookie = previousCookie;
    // oxlint-disable-next-line no-await-in-loop -- each run invalidates the previous capability.
    await call('/api/start', {
      taskId,
      api: 'decisions',
      mode: 'rehearsal',
      allowFileUpload: taskId === 'files',
    });
    // oxlint-disable-next-line no-await-in-loop
    let run = await waitFor((state) => state.approval || state.owner === 'stopped');
    assert.ok(run.approval);
    const fixtureURL = `${app.origin}/fixture/${taskId}`;
    for (const suffix of ['', '/notes/brief', '/notes/rules']) {
      for (const cookie of ['', staleCookie]) {
        // oxlint-disable-next-line no-await-in-loop -- test both authorities before allowing the effect.
        const denied = await fetch(fixtureURL + suffix, { headers: { ...headers, Cookie: cookie } });
        assert.equal(denied.status, 403, 'Dashboard access and prior workspaces cannot read this fixture.');
      }
    }
    const context = browser.contexts().find((item) => item.pages().some((page) => page.url() === fixtureURL));
    assert.ok(context);
    const page = context.pages().find((item) => item.url() === fixtureURL);
    assert.ok(page);
    // oxlint-disable-next-line no-await-in-loop
    const cookies = await context.cookies(fixtureURL);
    const own = cookies.find((cookie) => cookie.name === 'fieldwork_workspace');
    assert.ok(own);
    assert.equal(own.httpOnly, true);
    assert.equal(own.sameSite, 'Strict');
    // oxlint-disable-next-line no-await-in-loop
    const visibleCookie = await page.evaluate(() => document.cookie);
    // oxlint-disable-next-line no-await-in-loop
    const content = await page.content();
    assert.ok(!visibleCookie.includes(own.value));
    assert.ok(!content.includes(own.value));
    assert.ok(!JSON.stringify(run).includes(own.value));
    const denials = [];
    // oxlint-disable-next-line no-await-in-loop
    await page.route(`${fixtureURL}/effect*`, async (route) => {
      // Dispatch reached the real fixture only after the SDK issued a permit.
      // Denied replays cannot consume it; fallback retains the existing context guard.
      try {
        const effect = route.request();
        for (const cookie of ['', staleCookie]) {
          // oxlint-disable-next-line no-await-in-loop
          const denied = await fetch(effect.url(), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': effect.headers()['content-type'], Cookie: cookie },
            body: effect.postDataBuffer(),
          });
          denials.push(denied.status);
        }
      } finally {
        await route.fallback();
      }
    });
    while (run.owner !== 'stopped') {
      assert.ok(run.approval);
      // oxlint-disable-next-line no-await-in-loop
      await call('/api/approval', { ...binding(run), approvalId: run.approval.id, approved: true });
      // oxlint-disable-next-line no-await-in-loop
      run = await waitFor((state) => state.approval || state.owner === 'stopped');
    }
    // oxlint-disable-next-line no-await-in-loop
    run = await waitFor((state) => !state.closing);
    assert.equal(run.result, 'verified', JSON.stringify(run));
    assert.ok(denials.length > 0 && denials.every((status) => status === 403), JSON.stringify(denials));
    // oxlint-disable-next-line no-await-in-loop
    const receipt = await call(`/api/export?run=${run.id}`);
    assert.ok(!JSON.stringify(receipt).includes(own.value));
    previousCookie = `fieldwork_workspace=${own.value}`;
    console.log(
      `PASS ${taskId}: protected reads, active-permit replays denied, owned effect verified, receipt private`,
    );
  }

  await call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' });
  const held = await waitFor((state) => state.approval && state.view?.status === 'live');
  await call('/api/take-control', binding(held));
  let human = await waitFor((state) => state.owner === 'human' && state.view?.status === 'live');
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((item) => item.url() === `${app.origin}/fixture/reservation`);
  assert.ok(page);
  const guest = page.getByLabel('Guest name');
  const box = await guest.boundingBox();
  assert.ok(box);
  await call('/api/input', {
    ...binding(human),
    action: 'click',
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  human = await waitFor((state) => !state.humanInputBusy && state.view?.status === 'live');
  await call('/api/input', { ...binding(human), action: 'key', key: 'ControlOrMeta+A' });
  human = await waitFor((state) => !state.humanInputBusy && state.view?.status === 'live');
  const text = 'Zoë 東京 €🧭';
  const bytes = Buffer.from(JSON.stringify({ ...binding(human), action: 'type', text }));
  const split = bytes.indexOf(Buffer.from('€')) + 1;
  // oxlint-disable-next-line promise/avoid-new -- HTTP callbacks allow splitting raw bytes on the wire.
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${app.origin}/api/input`,
      { method: 'POST', headers: { ...headers, 'Content-Length': bytes.length } },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
        response.once('error', reject);
      },
    );
    req.once('error', reject);
    req.write(bytes.subarray(0, split));
    delay(30)
      .then(() => req.end(bytes.subarray(split)))
      .catch(reject);
  });
  assert.equal(status, 200);
  await waitFor((state) => !state.humanInputBusy);
  assert.equal(await guest.inputValue(), text, 'The actual human input must survive split UTF-8 bytes.');
  await call('/api/stop', binding(await waitFor((state) => !state.humanInputBusy)));
  await waitFor((state) => state.owner === 'stopped' && !state.closing);
  console.log('PASS split UTF-8 through authenticated human control reaches the real input unchanged');

  for (const stop of [false, true]) {
    const run = {
      taskId: 'stock',
      business: {},
      workspaceToken: 'synthetic-test-capability',
      owner: 'agent',
      controller: new AbortController(),
    };
    let closeCount = 0;
    const context = {
      on() {
        return this;
      },
      once() {
        return this;
      },
      routeWebSocket: async () => null,
      route: async () => null,
      async addCookies() {
        if (stop) {
          run.owner = 'stopped';
          run.controller.abort();
          return;
        }
        throw new Error('Synthetic cookie installation failure');
      },
      async close() {
        closeCount += 1;
      },
      newPage() {
        assert.fail('Cookie installation failed or was stopped before navigation');
      },
    };
    const started = createDemoSession({
      browser: { newContext: async () => context },
      origin: app.origin,
      run,
      onClose: () => run.controller.abort(),
    });
    if (stop) {
      // oxlint-disable-next-line no-await-in-loop -- failure and Stop run on separate owned contexts.
      assert.equal(await started, null);
    } else {
      // oxlint-disable-next-line no-await-in-loop -- verify failure cleanup before the Stop case.
      await assert.rejects(started, /Synthetic cookie installation failure/u);
    }
    assert.equal(closeCount, 1);
  }
  console.log('PASS failed/stopped cookie installation closes the owned context before navigation');
} finally {
  await app.close();
  chromium.launch = originalLaunch;
}
