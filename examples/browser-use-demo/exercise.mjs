import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { exampleBrowserChannel } from './booking.mjs';

const app = await createDemoServer();
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  channel: exampleBrowserChannel(),
});
const token = new URL(app.launchUrl).hash.slice('#token='.length);
async function call(path, body) {
  const response = await fetch(`${app.origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Demo-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function responseStatus(pending) {
  const response = await pending;
  return response.status;
}
async function until(predicate) {
  for (let count = 0; count < 200; count += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Poll until a real bounded state transition.
    const state = await call('/api/state');
    const { run } = state.body;
    if (predicate(run)) {
      return run;
    }
    // oxlint-disable-next-line no-await-in-loop -- Give the owned browser time to finish its operation.
    await delay(50);
  }
  const latest = await call('/api/state');
  assert.fail(`Fieldwork did not reach expected state: ${JSON.stringify(latest.body)}`);
}
const bind = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
try {
  assert.equal(await responseStatus(fetch(`${app.origin}/api/state`)), 403);
  assert.equal(
    await responseStatus(
      fetch(`${app.origin}/api/state`, {
        headers: { 'X-Demo-Token': token, Origin: 'https://other.invalid' },
      }),
    ),
    403,
  );
  assert.equal(
    await responseStatus(call('/api/start', { taskId: 'support', api: 'decisions', mode: 'rehearsal' })),
    400,
  );
  const removed = await Promise.all(
    ['/api/trace', '/api/export', '/api/checkpoint', '/api/inspector'].map((path) => call(path)),
  );
  assert.ok(removed.every((result) => result.status === 404));

  const page = await browser.newPage({ viewport: { width: 1340, height: 980 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.launchUrl);
  assert.equal(await page.locator('#api').inputValue(), 'responses');
  await page.selectOption('#mode', 'rehearsal');
  assert.equal(await page.locator('#api').inputValue(), 'decisions');
  await page.locator('#start').click();
  let run = await until((value) => value?.approval || (value && value.owner === 'stopped'));
  assert.ok(run.approval, JSON.stringify(run));
  assert.equal(run.requests, 0);
  assert.equal(run.fixture.verified, false);
  assert.equal(run.approval.label, 'Reserve table');
  assert.equal(
    await responseStatus(call('/api/approval', { ...bind(run), approvalId: 'stale', approved: true })),
    409,
  );
  await page.locator('#screen').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#screen').getAttribute('aria-disabled'), 'true');
  await page.locator('#approval').waitFor({ state: 'visible' });
  await page.locator('#take-control').click();
  run = await until((value) => value?.owner === 'human' || value?.owner === 'stopped');
  assert.equal(run.owner, 'human', JSON.stringify(run));
  assert.equal(run.fixture.verified, false);
  assert.equal(
    await responseStatus(call('/api/input', { ...bind(run), sequence: -1, action: 'type', text: 'wrong' })),
    409,
  );
  await page.locator('#return-control').click();
  run = await until((value) => Boolean(value?.approval) || value?.owner === 'stopped');
  assert.ok(run.approval, JSON.stringify(run));
  await page.locator('#approve').click();
  run = await until((value) => value?.owner === 'stopped' && !value.closing);
  assert.equal(run.status, 'complete', JSON.stringify(run));
  assert.equal(run.result, 'verified');
  assert.equal(run.requests, 0);
  assert.deepEqual(run.fixture.results, { confirmation: 'TABLE-204' });
  const end = run.screenshotBinding;
  assert.equal(
    await responseStatus(
      fetch(`${app.origin}/api/screenshot?run=${run.id}&tabId=${end.tabId}&sequence=${end.sequence}`, {
        headers: { 'X-Demo-Token': token },
      }),
    ),
    200,
  );
  assert.deepEqual(errors, []);
  const restarted = await call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' });
  assert.equal(restarted.status, 200);
  assert.equal(await responseStatus(call('/api/stop', { runId: restarted.body.id })), 200);
  run = await until((value) => value?.owner === 'stopped' && !value.closing);
  assert.equal(run.result, 'unverified');
  assert.deepEqual(errors, []);
  console.log(
    'PASS Fieldwork auth, single task, default API/rehearsal, live frames, approval, stale control, Take/Return, checked result, Stop and cleanup.',
  );
} finally {
  await Promise.all([app.close(), browser.close()]);
}
