// Actual Fieldwork, host Chromium and one caller-selected guest; every API reply is synthetic.
import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createMixedFixture, receiptText } from '../responses/browser/mixed-session.mjs';
import { createDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { 'runtime-dir': { type: 'string' } } });
assert.ok(values['runtime-dir'], 'Pass --runtime-dir /absolute/private/runtime');
const runtime = values['runtime-dir'];
const originalFetch = globalThis.fetch;
const initialEntries = await readdir(tmpdir());
const originalLedgers = new Set(initialEntries.filter((name) => name.startsWith('desktop-evidence-')));
let app;
let browser;
const requests = [];
try {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === '127.0.0.1') {
      return originalFetch(request);
    }
    assert.equal(url.origin, 'https://api.openai.com');
    assert.equal(url.pathname, '/v1/responses');
    const body = await request.json();
    requests.push(body);
    const [{ text }] = body.input[0].content;
    const facts = JSON.parse(text.slice(text.indexOf('\n') + 1));
    const outputs = body.input.filter((item) => item.type === 'function_call_output');
    const id = `local_${requests.length}`;
    const fn = (name, args) => ({
      type: 'function_call',
      status: 'completed',
      id,
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    });
    let output;
    if (!facts.checked.host.browserRouted && !outputs.length) {
      output = fn('browser_read_page', { tab_id: null, filter: 'all' });
    } else if (!facts.checked.host.browserRouted && outputs.length === 1) {
      const observed = JSON.parse(outputs[0].output[0].text);
      const { ref } = observed.result.elements.find((item) => item.label === 'Route D-2201');
      output = fn('browser_click', { tab_id: null, target: ref });
    } else if (!facts.approvedReceipt && !outputs.some((item) => item.output === receiptText)) {
      output = fn('approved_receipt', { case_id: 'D-2201' });
    } else {
      output = {
        type: 'computer_call',
        status: 'completed',
        id,
        call_id: id,
        pending_safety_checks: [],
        actions: [
          { type: 'click', button: 'left', x: 700, y: 180 },
          { type: 'keypress', keys: ['CTRL', 'A'] },
          { type: 'type', text: receiptText },
          { type: 'keypress', keys: ['CTRL', 'S'] },
        ],
      };
    }
    return Response.json({ id: `resp_${id}`, object: 'response', status: 'completed', output: [output] });
  };
  app = await createDemoServer({
    port: 0,
    apiKey: 'local-synthetic-key',
    models: { responses: 'local-synthetic-replies' },
    desktopRuntime: runtime,
  });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  // Measure the original fixed HTML at its declared viewport, without acting on either task.
  const measurement = await createMixedFixture();
  let target;
  try {
    const fixturePage = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await measurement.authorize(fixturePage.context());
    await fixturePage.goto(`${measurement.origin}/dispatch`);
    const box = await fixturePage.locator('#route').boundingBox();
    target = { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2) };
    await fixturePage.close();
  } finally {
    await measurement.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(app.launchUrl);
  const htmlResponse = await originalFetch(app.origin);
  const html = await htmlResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  const call = async (route, body, expected = 200) => {
    const response = await originalFetch(`${app.origin}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expected, `${route} ${await response.clone().text()}`);
    return response.json();
  };
  const until = async (check, timeout = 30_000) => {
    const end = performance.now() + timeout;
    let last;
    while (performance.now() < end) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Observe each state after the previous poll settled.
      const { run } = await call('/api/state');
      if (check(run)) {
        return run;
      }
      last = run && {
        owner: run.owner,
        status: run.status,
        requests: run.requests,
        selected: run.desktop?.view,
        view: run.view,
        closing: run.closing,
        busy: run.humanInputBusy,
        events: run.events,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- Wait only between observations of this one run.
      await delay(75);
    }
    throw new Error(
      `Mixed state unavailable: ${JSON.stringify(last)}; ${await page.locator('#message').textContent()}`,
    );
  };
  const input = async (gesture) => {
    const { run } = await call('/api/state');
    await call('/api/input', { runId: run.id, ...run.desktop, ...gesture });
    await until((current) => !current.humanInputBusy);
  };
  const select = async (value) => {
    await page.locator('#mixed-view:not([disabled])').waitFor();
    await page.selectOption('#mixed-view', value);
    await until((run) => run?.desktop?.view === value && run.view.status === 'live' && !run.humanInputBusy);
  };
  await page.locator('#environment option[value="mixed"]:not([disabled])').waitFor({ state: 'attached' });
  await page.selectOption('#environment', 'mixed');
  assert.equal(await page.locator('#api').inputValue(), 'responses');
  assert.equal(await page.locator('#api').isDisabled(), true);
  await page.click('#start');
  const pending = await until((run) => Boolean(run?.approval), 120_000);
  const id = pending.desktop.desktopId;
  await page.locator('#take-control:not([disabled])').waitFor();
  await page.click('#take-control');
  await until((run) => run.owner === 'human' && !run.humanInputBusy);
  await page.locator('#screen[aria-disabled="false"]').waitFor();
  assert.deepEqual(
    await page.locator('#screen').evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    [1024, 768],
  );
  await call(
    '/api/approval',
    { runId: pending.id, ...pending.desktop, approvalId: pending.approval.id, approved: true },
    409,
  );
  assert.equal(requests.length, 2, 'Take does not spend another request.');
  const { run: firstHost } = await call('/api/state');
  await select('guest');
  await call('/api/input', { runId: firstHost.id, ...firstHost.desktop, action: 'click', ...target }, 409);
  const { run: firstGuest } = await call('/api/state');
  await call(
    '/api/input',
    { runId: firstHost.id, ...firstGuest.desktop, action: 'click', x: 110, y: 215 },
    400,
  );
  await select('host');
  await call('/api/input', { runId: firstHost.id, ...firstHost.desktop, action: 'click', ...target }, 409);
  const { run: liveHost } = await call('/api/state');
  await call('/api/input', { runId: liveHost.id, ...liveHost.desktop, action: 'click', x: 1, y: 1 }, 400);
  const afterMiss = await until((run) => !run.humanInputBusy);
  assert.equal(afterMiss.owner, 'human');
  assert.equal(afterMiss.uncertainEffects, false);
  await input({ action: 'click', ...target });
  await page.locator('#return-control:not([disabled])').waitFor();
  await page.click('#return-control');
  const grant = await until(
    (run) => run.owner === 'agent' && run.approval?.label.startsWith('Local function'),
  );
  const fresh = requests.at(-1);
  assert.equal(fresh.input.length, 1);
  const freshText = fresh.input[0].content[0].text;
  const facts = JSON.parse(freshText.slice(freshText.indexOf('\n') + 1));
  assert.deepEqual(facts.checked.host, { routes: 1, resultRequests: 0, browserRouted: true });
  assert.equal(facts.checked.transfer.disclosed, false);
  await page.locator('#approval:not([hidden])').waitFor();
  await page.click('#approve');
  await until((run) => run.approval?.label.startsWith('Isolated desktop'));
  await page.locator('#take-control:not([disabled])').waitFor();
  await page.click('#take-control');
  const human = await until((run) => run.owner === 'human' && !run.humanInputBusy);
  await call(
    '/api/approval',
    { runId: grant.id, ...grant.desktop, approvalId: grant.approval.id, approved: true },
    409,
  );
  // A narrow phone still supports the same two views; no hidden browser-tab authority is substituted.
  await page.setViewportSize({ width: 390, height: 844 });
  await select('guest');
  await page.locator('#screen[aria-disabled="false"]').waitFor();
  assert.equal(await page.locator('#send-scroll').isDisabled(), true);
  assert.equal(await page.locator('#send-text').isDisabled(), false);
  await input({ action: 'click', x: 700, y: 180 });
  await input({ action: 'key', key: 'ControlOrMeta+A' });
  await input({ action: 'type', text: receiptText });
  await input({ action: 'key', key: 'ControlOrMeta+S' });
  const total = requests.length;
  await page.locator('#return-control:not([disabled])').waitFor();
  await page.click('#return-control');
  const complete = await until((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(complete.id, human.id);
  assert.equal(complete.result, 'verified');
  assert.equal(requests.length, total, 'Already saved: verify without another model call.');
  assert.equal(complete.turns, total, 'Durable consumed_requests and HTTP attempts each count once.');
  await assert.rejects(lstat(path.join(runtime, 'runs', id)), { code: 'ENOENT' });
  const receipt = await call(`/api/export?run=${complete.id}`);
  assert.equal(receipt.environment, 'mixed');
  assert.equal(receipt.taskId, 'mixed');
  assert.equal(receipt.cleanup, 'completed');
  assert.equal(receipt.file.direction, 'download');
  assert.deepEqual(receipt.file.current, { status: 'completed', effect: 'completed' });
  assert.equal(receipt.file.cleanup, 'completed');
  assert.ok(receipt.file.recent.length > 0 && receipt.file.recent.length <= 32);
  const serialized = JSON.stringify(receipt);
  for (const excluded of ['image_url', 'approvedReceipt', receiptText, 'grant_id', '/dispatch', 'call_id']) {
    assert.equal(serialized.includes(excluded), false, `private field: ${excluded}`);
  }
  const entries = await readdir(tmpdir());
  assert.deepEqual(
    entries.filter((name) => name.startsWith('desktop-evidence-') && !originalLedgers.has(name)),
    [],
  );
  console.log(
    JSON.stringify({
      passed: true,
      native: true,
      api: 'synthetic',
      viewports: [
        [1440, 1000],
        [390, 844],
      ],
      run: complete.id,
      child: id,
      requests: total,
      turns: complete.turns,
      guestAbsent: true,
      ledgersAbsent: true,
      result: complete.result,
    }),
  );
} finally {
  try {
    assert.deepEqual(await Promise.allSettled([app?.close(), browser?.close()]), [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
