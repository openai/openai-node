// Real Chromium/dashboard and a caller-selected disposable guest. API replies are synthetic.
import assert from 'node:assert/strict';
import { readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { 'runtime-dir': { type: 'string' } } });
assert.ok(values['runtime-dir'], 'Pass --runtime-dir /absolute/private/runtime');
const runtime = values['runtime-dir'];
const originalFetch = globalThis.fetch;
const initialEntries = await readdir(tmpdir());
const originalLedgers = new Set(initialEntries.filter((name) => name.startsWith('desktop-evidence-')));
const replies = [];
let scenario = 'handoff';
let release;
let app;
let browser;

function response(request, actions) {
  const id = `local_${replies.length}`;
  return Response.json({
    id: `resp_${id}`,
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: '',
    output: actions
      ? [{ type: 'computer_call', id: `cu_${id}`, call_id: `call_${id}`, status: 'completed', actions }]
      : [
          {
            type: 'message',
            id: `msg_${id}`,
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: 'Synthetic final; check the real guest.', annotations: [] },
            ],
          },
        ],
    tools: request.tools,
  });
}

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
    replies.push(body);
    if (scenario === 'noncooperative') {
      const pending = Promise.withResolvers();
      release = () => pending.resolve(response(body, [{ type: 'click', button: 'left', x: 200, y: 215 }]));
      return pending.promise;
    }
    if (replies.length === 1) {
      return response(body, [{ type: 'click', button: 'left', x: 200, y: 215 }]);
    }
    if (replies.length === 2) {
      return response(body, [{ type: 'keypress', keys: ['CTRL', 'S'] }]);
    }
    return response(body);
  };
  app = await createDemoServer({
    port: 0,
    apiKey: 'synthetic-desktop-key',
    models: { responses: 'synthetic-desktop-check' },
    desktopRuntime: runtime,
  });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(app.launchUrl);
  const pageResponse = await originalFetch(app.origin);
  const html = await pageResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  const call = async (route, body, expected = 200) => {
    const result = await originalFetch(`${app.origin}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(result.status, expected, route);
    return result.json();
  };
  const until = async (check, timeout = 30_000) => {
    const end = performance.now() + timeout;
    let observed;
    while (performance.now() < end) {
      // Each read waits for this same run's state transition.
      // oxlint-disable-next-line no-await-in-loop
      const { run } = await call('/api/state');
      observed = run && {
        owner: run.owner,
        status: run.status,
        requests: run.requests,
        view: run.view,
        events: run.events,
        closing: run.closing,
        humanInputBusy: run.humanInputBusy,
      };
      if (check(run)) {
        return run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(50);
    }
    const message = await page.locator('#message').textContent();
    throw new Error(
      `Desktop demo did not reach the expected state: ${JSON.stringify({ observed, message })}`,
    );
  };
  const clickDesktop = async (x, y) => {
    const { run: before } = await call('/api/state');
    const count = before.events.filter((event) => event.kind === 'human').length;
    await page.locator('#screen[aria-disabled="false"]').waitFor();
    const rect = await page.locator('#screen').boundingBox();
    await page.mouse.click(
      rect.x + (rect.width * (x + 0.5)) / 1024,
      rect.y + (rect.height * (y + 0.5)) / 768,
    );
    await until(
      (run) =>
        run.owner === 'human' &&
        !run.humanInputBusy &&
        run.events.filter((event) => event.kind === 'human').length > count,
    );
    await page.locator('#screen[aria-disabled="false"]').waitFor();
  };
  await page.locator('#environment option[value="desktop"]:not([disabled])').waitFor({ state: 'attached' });
  await page.selectOption('#environment', 'desktop');
  assert.equal(await page.locator('#api').inputValue(), 'responses');
  assert.equal(await page.locator('#api').isDisabled(), true);
  await page.click('#start');
  const pending = await until((run) => Boolean(run?.approval), 120_000);
  const firstId = pending.desktop.desktopId;
  await page.locator('#take-control:not([disabled])').waitFor();
  await page.click('#take-control');
  await until((run) => run.owner === 'human' && !run.humanInputBusy);
  await page.locator('#screen[aria-disabled="false"]').waitFor();
  assert.equal(
    await page.locator('#send-scroll').isDisabled(),
    true,
    'Select a desktop point before scrolling.',
  );
  assert.deepEqual(
    await page.locator('#screen').evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    [1024, 768],
  );
  await call(
    '/api/approval',
    {
      runId: pending.id,
      ownerVersion: pending.ownerVersion,
      desktopId: firstId,
      approvalId: pending.approval.id,
      approved: true,
    },
    409,
  );
  await call(
    '/api/input',
    {
      runId: pending.id,
      ownerVersion: pending.ownerVersion,
      desktopId: firstId,
      action: 'click',
      x: 200,
      y: 215,
    },
    409,
  );
  assert.equal(replies.length, 1, 'Taking control must not send another request.');

  const selected = await until((run) => run.history.checkpoints.length > 0);
  await page.selectOption('#checkpoint', String(selected.history.checkpoints[0].sequence));
  await page.locator('#screen[aria-disabled="true"]').waitFor();
  assert.equal(await page.locator('#send-text').isDisabled(), true);
  assert.equal(await page.locator('#return-control').isDisabled(), true);
  await page.click('#return-current');
  await page.locator('#screen[aria-disabled="false"]').waitFor();
  await clickDesktop(200, 215);
  const firstPoint = await call('/api/state');
  assert.ok(
    Math.abs(firstPoint.run.scrollTarget.x - 200) <= 1 && Math.abs(firstPoint.run.scrollTarget.y - 215) <= 1,
  );
  await clickDesktop(700, 180);
  const editorPoint = await call('/api/state');
  assert.ok(
    Math.abs(editorPoint.run.scrollTarget.x - 700) <= 1 &&
      Math.abs(editorPoint.run.scrollTarget.y - 180) <= 1,
  );
  const sendInput = async (button) => {
    const [acknowledgment] = await Promise.all([
      page.waitForResponse((value) => value.url() === `${app.origin}/api/input`),
      page.click(button),
    ]);
    assert.equal(acknowledgment.status(), 200, 'The native desktop must accept this human input.');
    await until((run) => !run.humanInputBusy);
    await page.locator('#screen[aria-disabled="false"]').waitFor();
  };
  await page.fill('#human-text', 'Desktop receipt\nD-2201X');
  await sendInput('#send-text');
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'Backspace']) {
    // Exercise every advertised arrow and join the two native lines before the exact-file check.
    // oxlint-disable-next-line no-await-in-loop
    await page.selectOption('#human-key', key);
    // oxlint-disable-next-line no-await-in-loop
    await sendInput('#send-key');
  }
  await page.fill('#human-text', ' ');
  await sendInput('#send-text');
  for (const key of ['End', 'ArrowLeft', 'Delete']) {
    // Remove the final sentinel through native cursor movement, then let the agent save the receipt.
    // oxlint-disable-next-line no-await-in-loop
    await page.selectOption('#human-key', key);
    // oxlint-disable-next-line no-await-in-loop
    await sendInput('#send-key');
  }
  await page.locator('#return-control:not([disabled])').waitFor();
  await page.click('#return-control');
  await until((run) => Boolean(run.approval));
  const returned = await call('/api/state');
  assert.equal(returned.run.scrollTarget, null, 'A new owner must choose its own scroll point.');
  assert.equal(replies.length, 2);
  assert.equal(
    replies[1].input.length,
    1,
    'A returned phase has one fresh observation, no pending old tool calls.',
  );
  assert.notEqual(replies[1].input[0].content[1].image_url, replies[0].input[0].content[1].image_url);
  await page.locator('#approval:not([hidden])').waitFor();
  await page.click('#approve');
  const complete = await until((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(complete.result, 'verified');
  assert.equal(complete.requests, 3);
  await assert.rejects(lstat(path.join(runtime, 'runs', firstId)), { code: 'ENOENT' });
  const receipt = await call(`/api/export?run=${complete.id}`);
  assert.equal(receipt.environment, 'desktop');
  assert.equal(receipt.cleanup, 'completed');
  assert.deepEqual(
    [...new Set(receipt.events.filter((event) => event.kind === 'tools').map((event) => event.phaseIndex))],
    [1, 2],
  );
  assert.equal(JSON.stringify(receipt).includes('image_url'), false);
  console.log(
    'PASS real desktop: decoded live view, stale controls refused, saved images view-only, human input, fresh phase, exact guest outcome and cleanup',
  );

  scenario = 'noncooperative';
  await call('/api/start', { environment: 'desktop', taskId: 'desktop', api: 'responses', mode: 'live' });
  const held = await until((run) => run.requests === 1 && run.desktop, 120_000);
  const heldId = held.desktop.desktopId;
  await call('/api/take-control', { runId: held.id, ...held.desktop });
  const retired = await until((run) => run.owner === 'stopped', 15_000);
  assert.equal(retired.uncertainEffects, false, 'A held API request sent no desktop input.');
  const removalDeadline = performance.now() + 15_000;
  while (performance.now() < removalDeadline) {
    // The bounded Stop may still be reaping the exact guest after owner revocation.
    // oxlint-disable-next-line no-await-in-loop
    const runs = await readdir(path.join(runtime, 'runs'));
    if (!runs.includes(heldId)) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(50);
  }
  await assert.rejects(lstat(path.join(runtime, 'runs', heldId)), { code: 'ENOENT' });
  const heldEntries = await readdir(tmpdir());
  assert.ok(
    heldEntries.some((name) => name.startsWith('desktop-evidence-') && !originalLedgers.has(name)),
    'The unfinished runner keeps its ledger while Stop reaps the guest.',
  );
  const unfinished = await call(`/api/export?run=${held.id}`);
  assert.equal(unfinished.cleanup, 'pending');
  const closing = app.close();
  assert.equal(app.close(), closing, 'Shutdown retains one owner promise.');
  const stillWaiting = Symbol('unfinished runner');
  assert.equal(await Promise.race([closing, delay(100, stillWaiting)]), stillWaiting);
  release();
  release = undefined;
  await closing;
  app = undefined;
  const finalEntries = await readdir(tmpdir());
  assert.deepEqual(
    finalEntries.filter((name) => name.startsWith('desktop-evidence-') && !originalLedgers.has(name)),
    [],
  );
  console.log(
    'PASS noncooperative request: takeover expires, no human admission, guest reaped before late response, ledger removed only after runner settles',
  );
} finally {
  release?.();
  try {
    const cleanup = await Promise.allSettled([app?.close(), browser?.close()]);
    const failed = cleanup.filter((result) => result.status === 'rejected');
    assert.deepEqual(failed, [], 'Desktop exercise cleanup failed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
