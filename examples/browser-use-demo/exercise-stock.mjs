import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

// Observe the test's real browser without adding a public fixture/debug route.
const { launch: savedLaunch } = chromium;
let browser;
chromium.launch = async function launch(...args) {
  browser = await savedLaunch.apply(this, args);
  return browser;
};
const app = await createDemoServer({ port: 0 });
const checks = [];
try {
  const dashboardResponse = await fetch(app.origin);
  const dashboard = await dashboardResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!dashboard.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (route, body) => {
    const response = await fetch(app.origin + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  const state = async () => {
    const response = await call('/api/state');
    return response.value.run;
  };
  const until = async (condition) => {
    let current;
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      // Each check depends on the preceding run state; do not parallelize polling.
      // oxlint-disable-next-line no-await-in-loop
      current = await state();
      if (condition(current)) {
        return current;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(30);
    }
    throw new Error(`Stock workspace did not reach the expected state: ${JSON.stringify(current)}`);
  };
  const start = async () => {
    await until((run) => !run || (run.owner === 'stopped' && !run.closing));
    const result = await call('/api/start', { taskId: 'stock', api: 'decisions', mode: 'rehearsal' });
    assert.equal(result.status, 200);
    return until((run) => run.approval || run.owner === 'stopped');
  };
  const approve = async (run, approved) => {
    assert.ok(run.approval, JSON.stringify(run));
    const response = await call('/api/approval', {
      runId: run.id,
      ownerVersion: run.ownerVersion,
      tabId: run.browser.tabId,
      sequence: run.browser.sequence,
      approvalId: run.approval.id,
      approved,
    });
    assert.equal(response.status, 200);
  };
  const page = () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((value) => value.url() === `${app.origin}/fixture/stock`);
  const inject = async (run, order, sku) =>
    page().evaluate(
      async ({ id, record, value }) => {
        const response = await fetch(`/fixture/stock/effect?run=${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'ship', order: record, sku: value }),
        });
        return response.status;
      },
      { id: run.id, record: order, value: sku },
    );
  const clean = {
    results: [],
    stock: [
      { sku: 'ALT-B', quantity: 2 },
      { sku: 'ALT-R', quantity: 2 },
    ],
  };
  const unchanged = (run) => {
    assert.deepEqual(run.fixture.results, clean.results);
    assert.deepEqual(run.fixture.stock, clean.stock);
    assert.equal(run.fixture.verified, false);
  };

  const first = await start();
  assert.match(first.approval.label, /ORDER-301/u);
  unchanged(first);
  // The page-controlled fields previously checked for the three original tasks
  // can never prove a stock shipment.
  await page().evaluate(() => {
    document.body.dataset.finished = 'true';
    document.body.dataset.revision = '99';
    document.body.dataset.results = JSON.stringify([
      { operation: 'ship', order: 'ORDER-301', sku: 'ALT-B' },
      { operation: 'ship', order: 'ORDER-302', sku: 'ALT-R' },
    ]);
    const fake = document.createElement('p');
    fake.textContent = 'All orders shipped';
    document.body.append(fake);
  });
  unchanged(await state());
  assert.equal(await inject(first, 'ORDER-302', 'ALT-R'), 403);
  const held = await state();
  unchanged(held);
  assert.equal(held.fixture.denied, 1);
  checks.push({ check: 'forged DOM and held wrong-record request cannot claim or apply a shipment' });

  // Send wrong/extra writes while releasing the actual first approval.
  const outcomes = await Promise.all([
    approve(first, true),
    inject(first, 'ORDER-302', 'ALT-R'),
    inject(first, 'ORDER-301', 'ALT-R'),
  ]);
  assert.deepEqual(outcomes.slice(1), [403, 403]);
  const second = await until(
    (run) => run.approval?.id !== first.approval.id && (run.approval || run.owner === 'stopped'),
  );
  assert.ok(second.approval, JSON.stringify(second));
  assert.match(second.approval.label, /ORDER-302/u);
  assert.deepEqual(second.fixture.results, [{ operation: 'ship', order: 'ORDER-301', sku: 'ALT-B' }]);
  assert.deepEqual(second.fixture.stock, [
    { sku: 'ALT-B', quantity: 1 },
    { sku: 'ALT-R', quantity: 2 },
  ]);
  assert.equal(second.fixture.denied, 3);
  assert.equal(await inject(second, 'ORDER-301', 'ALT-B'), 403);
  await approve(second, true);
  const finished = await until((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(finished.requests, 0);
  assert.equal(finished.status, 'complete');
  assert.equal(finished.result, 'verified');
  assert.deepEqual(finished.fixture.results, [
    { operation: 'ship', order: 'ORDER-301', sku: 'ALT-B' },
    { operation: 'ship', order: 'ORDER-302', sku: 'ALT-R' },
  ]);
  assert.deepEqual(finished.fixture.stock, [
    { sku: 'ALT-B', quantity: 1 },
    { sku: 'ALT-R', quantity: 1 },
  ]);
  assert.equal(finished.fixture.denied, 4);
  checks.push({
    check: 'two approved writes and precise deltas; simultaneous and late wrong/extra writes denied',
  });

  const refusal = await start();
  unchanged(refusal);
  // A request from the previous run cannot consume a new run's approval.
  const expired = await fetch(`${app.origin}/fixture/stock/effect?run=${first.id}`, {
    method: 'POST',
    headers: { Origin: app.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'ship', order: 'ORDER-301', sku: 'ALT-B' }),
  });
  assert.equal(expired.status, 403);
  await approve(refusal, false);
  const denied = await until((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(denied.status, 'refused');
  assert.equal(denied.result, 'unverified');
  assert.equal(denied.requests, 0);
  unchanged(denied);
  checks.push({ check: 'operator refusal and stale run leave a fresh stock workspace unchanged' });

  const changed = await start();
  await page().evaluate(() => {
    document.querySelector('[data-record-id]').dataset.recordId = 'ORDER-302';
  });
  await approve(changed, true);
  const recycled = await until((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(recycled.result, 'unverified');
  unchanged(recycled);
  checks.push({ check: 'record recycled during approval cannot use an original ref or permission' });

  // Pause the real driver's last ElementHandle evaluation, after the operator
  // grants approval but before Chromium checks or dispatches the native click.
  const heldNative = async (stop) => {
    const run = await start();
    const stockPage = page();
    const sample = await stockPage.locator('body').elementHandle();
    const prototype = Object.getPrototypeOf(sample);
    const savedEvaluate = prototype.evaluate;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let heldClick = false;
    prototype.evaluate = async function evaluate(fn, args) {
      if (!heldClick && typeof fn === 'function' && fn.name === 'ownedElement' && args?.action === 'click') {
        heldClick = true;
        entered.resolve();
        await release.promise;
      }
      return savedEvaluate.call(this, fn, args);
    };
    try {
      await approve(run, true);
      assert.equal(await Promise.race([entered.promise.then(() => true), delay(5000, false)]), true);
      const request = call(`/fixture/stock/effect?run=${run.id}`, {
        operation: 'ship',
        order: 'ORDER-301',
        sku: 'ALT-B',
      });
      // A second matching request is denied while the first owns the slot.
      // This proves request admission before we invalidate the original ref.
      assert.equal(await inject(run, 'ORDER-301', 'ALT-B'), 403);
      unchanged(await state());
      if (stop) {
        const stopped = await call('/api/stop', { runId: run.id });
        assert.equal(stopped.status, 200);
      } else {
        await stockPage.evaluate(() => {
          const card = document.querySelector('[data-record-id]');
          card.replaceWith(card.cloneNode(true));
        });
      }
      release.resolve();
      const reply = await request;
      assert.equal(reply.status, 403);
      const ended = await until((value) => value.owner === 'stopped' && !value.closing);
      unchanged(ended);
      assert.equal(ended.requests, 0);
      checks.push({
        check: stop
          ? 'Stop revokes a matching staged request before the final native click check'
          : 'replacing a card during the final native check revokes a matching staged request',
      });
    } finally {
      release.resolve();
      prototype.evaluate = savedEvaluate;
      await sample.dispose().catch(() => {
        // Stop may already have closed the page and all its element handles.
      });
    }
  };
  await heldNative(false);
  await heldNative(true);

  console.log(JSON.stringify({ scope: 'local Chromium and scripted SDK only', checks, apiRequests: 0 }));
} finally {
  try {
    await app.close();
  } finally {
    chromium.launch = savedLaunch;
  }
}
