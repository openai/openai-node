import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

// Real isolated Chromium captures; no API key, model request or external site.
const originalLaunch = chromium.launch.bind(chromium);
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const results = [];
const phase = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
const digest = async (reply) =>
  createHash('sha256')
    .update(Buffer.from(await reply.arrayBuffer()))
    .digest('hex');
const assertStatus = async (replyPromise, expected) => {
  const reply = await replyPromise;
  assert.equal(reply.status, expected);
};
let paddedSize = 0;
let failInspection = false;
let fixedNow;

Date.now = () => fixedNow ?? originalNow();
chromium.launch = async (options) => {
  const browser = await originalLaunch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (contextOptions) => {
    const context = await newContext(contextOptions);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await newPage();
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (captureOptions) => {
        const pixels = await screenshot(captureOptions);
        // A valid captured JPEG with trailing bytes exercises retained byte limits.
        return paddedSize > pixels.length
          ? Buffer.concat([pixels, Buffer.alloc(paddedSize - pixels.length)])
          : pixels;
      };
      const locator = page.locator.bind(page);
      page.locator = (selector, ...args) => {
        const target = locator(selector, ...args);
        if (selector === 'body') {
          const evaluate = target.evaluate.bind(target);
          target.evaluate = (...inputs) => {
            if (failInspection) {
              failInspection = false;
              throw new Error('Synthetic failed fixture inspection.');
            }
            return evaluate(...inputs);
          };
        }
        return target;
      };
      return page;
    };
    return context;
  };
  return browser;
};

const app = await createDemoServer({ port: 0 });
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).origin, app.origin, 'Only the local dashboard may be requested.');
  return originalFetch(request);
};

try {
  const pageReply = await fetch(app.origin);
  const html = await pageReply.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = (path, body, headers = {}) =>
    fetch(`${app.origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: app.origin,
        'X-Demo-Token': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const state = async () => {
    const reply = await call('/api/state');
    const body = await reply.json();
    return body.run;
  };
  const waitFor = async (test) => {
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      // Each owner/state read depends on the preceding operation.
      // oxlint-disable-next-line no-await-in-loop
      const run = await state();
      if (test(run)) {
        return run;
      }
      // Pace this bounded serial local read.
      // oxlint-disable-next-line no-await-in-loop
      await delay(20);
    }
    throw new Error('Checkpoint exercise did not reach its expected state.');
  };
  const checkpoint = (run, sequence) => call(`/api/checkpoint?run=${run.id}&checkpoint=${sequence}`);
  const start = async () => {
    await waitFor((run) => !run || (run.owner === 'stopped' && !run.closing));
    const reply = await call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' });
    assert.equal(reply.status, 200);
    return waitFor((run) => run.approval);
  };
  const take = async (run) => {
    await assertStatus(call('/api/take-control', phase(run)), 200);
    return waitFor((value) => value.owner === 'human');
  };
  const input = async (run) => {
    const reply = await call('/api/input', { ...phase(run), action: 'key', key: 'ArrowLeft' });
    assert.equal(reply.status, 200);
    return state();
  };

  let run = await start();
  assert.ok(run.history.checkpoints.length > 1);
  const [first] = run.history.checkpoints;
  const latest = run.history.checkpoints.at(-1);
  const firstHash = await digest(await checkpoint(run, first.sequence));
  assert.notEqual(firstHash, await digest(await checkpoint(run, latest.sequence)));
  assert.equal(firstHash, await digest(await checkpoint(run, first.sequence)));
  assert.ok(
    run.history.checkpoints.every(
      (entry) => Object.keys(entry).toSorted().join(',') === 'at,atMs,owner,role,sequence',
    ),
  );
  assert.equal(run.requests, 0);
  results.push({ control: 'different actual checkpoints are immutable metadata-only state', success: true });

  const path = `/api/checkpoint?run=${run.id}&checkpoint=${first.sequence}`;
  for (const headers of [{ 'X-Demo-Token': 'wrong' }, { Origin: 'https://untrusted.example' }]) {
    // Independent denials are intentionally checked serially against the same retained image.
    // oxlint-disable-next-line no-await-in-loop
    await assertStatus(call(path, undefined, headers), 403);
  }
  // Fetch may replace Host; send the forged header at the actual HTTP boundary.
  const forgedHost = httpRequest(`${app.origin}${path}`, {
    headers: { Host: 'untrusted.example', Origin: app.origin, 'X-Demo-Token': token },
  });
  const forgedResponse = once(forgedHost, 'response');
  forgedHost.end();
  const [forgedReply] = await forgedResponse;
  assert.equal(forgedReply.statusCode, 403);
  forgedReply.resume();
  for (const sequence of ['', '0', '-1', '01', '1.0', '1e0', '9007199254740992', 'missing']) {
    // No malformed ID may fall back to a valid latest screenshot.
    // oxlint-disable-next-line no-await-in-loop
    await assertStatus(checkpoint(run, sequence), 404);
  }
  const image = await checkpoint(run, first.sequence);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  results.push({ control: 'authenticated strict checkpoint retrieval, no fallback', success: true });

  run = await take(run);
  fixedNow = originalNow();
  for (let i = 0; i < 14; i += 1) {
    // One admitted human input must finish before the next begins.
    // oxlint-disable-next-line no-await-in-loop
    run = await input(run);
  }
  assert.equal(run.history.checkpoints.length, 12);
  assert.ok(run.history.dropped > 0);
  await assertStatus(checkpoint(run, first.sequence), 404);
  assert.equal(new Set(run.history.checkpoints.map((entry) => entry.sequence)).size, 12);
  assert.equal(new Set(run.history.checkpoints.map((entry) => entry.at)).size, 1);
  results.push({ control: '12-entry eviction and distinct IDs at identical capture times', success: true });

  paddedSize = 900 * 1024;
  for (let i = 0; i < 12; i += 1) {
    // Retain large real captures until the separate history byte limit is reached.
    // oxlint-disable-next-line no-await-in-loop
    run = await input(run);
  }
  assert.equal(run.history.checkpoints.length, 9);
  // Fetch each retained image to check observable byte retention rather than internals.
  const retainedSizes = await Promise.all(
    run.history.checkpoints.map(async (entry) => {
      const retainedReply = await checkpoint(run, entry.sequence);
      const retainedPixels = await retainedReply.arrayBuffer();
      return retainedPixels.byteLength;
    }),
  );
  const bytes = retainedSizes.reduce((total, size) => total + size, 0);
  assert.ok(bytes <= 8 * 1024 * 1024);
  const beforeOversize = structuredClone(run.history);
  paddedSize = 2 * 1024 * 1024;
  run = await input(run);
  assert.deepEqual(run.history.checkpoints, beforeOversize.checkpoints);
  assert.equal(run.history.dropped, beforeOversize.dropped + 1);
  const saved = await call(
    `/api/screenshot?run=${run.id}&tabId=${run.screenshotBinding.tabId}&sequence=${run.screenshotBinding.sequence}`,
  );
  const savedPixels = await saved.arrayBuffer();
  assert.equal(savedPixels.byteLength, paddedSize);
  await assertStatus(checkpoint(run, beforeOversize.checkpoints.at(-1).sequence + 1), 404);
  results.push({
    control: '8 MiB history cap and oversize omission without replacing retained IDs',
    success: true,
  });

  paddedSize = 0;
  const beforeFailure = structuredClone(run.history);
  failInspection = true;
  await assertStatus(call('/api/input', { ...phase(run), action: 'key', key: 'ArrowLeft' }), 409);
  run = await waitFor((value) => value.owner === 'stopped' && !value.closing);
  assert.deepEqual(run.history, beforeFailure);
  assert.equal(run.uncertainEffects, true);
  await assertStatus(checkpoint(run, run.history.checkpoints.at(-1).sequence), 200);
  results.push({
    control: 'failed fixture inspection publishes no partial checkpoint; stopped history remains view-only',
    success: true,
  });

  const oldRun = run;
  fixedNow = undefined;
  run = await start();
  assert.notEqual(run.id, oldRun.id);
  await assertStatus(checkpoint(oldRun, oldRun.history.checkpoints.at(-1).sequence), 404);
  assert.equal(run.history.dropped, 0);
  await assertStatus(call('/api/stop', { runId: run.id }), 200);
  await waitFor((value) => value.owner === 'stopped' && !value.closing);
  results.push({ control: 'replaced runs cannot serve retained images', success: true });
  console.log(
    JSON.stringify({ success: true, kind: 'real Chromium checkpoints, zero API requests', results }, null, 2),
  );
} finally {
  paddedSize = 0;
  failInspection = false;
  fixedNow = undefined;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  chromium.launch = originalLaunch;
  await app.close();
}
