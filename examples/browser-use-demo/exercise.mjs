import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import filePaths from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { inspectTask } from './tasks.mjs';
import { exampleBrowserChannel } from './booking.mjs';

const privateFiles = await mkdtemp(filePaths.join(tmpdir(), 'browser-demo-key-'));
try {
  const key = filePaths.join(privateFiles, 'key');
  await writeFile(key, 'x'.repeat(16 * 1024 + 1), { mode: 0o600 });
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('server.mjs', import.meta.url)), '--key-file', key],
      { timeout: 5000 },
    ),
    (error) => error.code === 1 && error.stderr.includes('at most 16 KiB'),
  );
} finally {
  await rm(privateFiles, { recursive: true });
}

const models = {};
const app = await createDemoServer({ apiKey: 'test-only', models });
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
async function checkLive() {
  const realFetch = globalThis.fetch;
  try {
    for (const api of ['responses', 'decisions']) {
      models[api] = `local-${api}`;
      for (const outcome of ['denied', 'cancelled']) {
        const entered = Promise.withResolvers();
        const cancelled = Promise.withResolvers();
        const requests = [];
        globalThis.fetch = (url, options) => {
          if (new URL(url).origin === app.origin) {
            return realFetch(url, options);
          }
          requests.push({ url: new URL(url), options });
          if (outcome === 'cancelled') {
            const body = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    api === 'responses' ? 'event: response.created\ndata: ' : '{"id":',
                  ),
                );
                options.signal.addEventListener(
                  'abort',
                  () => {
                    cancelled.resolve();
                    controller.error(options.signal.reason);
                  },
                  { once: true },
                );
              },
              pull() {
                entered.resolve();
              },
              cancel() {
                cancelled.resolve();
              },
            });
            return Promise.resolve(
              new Response(body, {
                headers: { 'content-type': api === 'responses' ? 'text/event-stream' : 'application/json' },
              }),
            );
          }
          entered.resolve();
          return Promise.resolve(
            Response.json(
              { error: { message: 'sk-local-marker test-only', type: 'authentication_error' } },
              { status: 401, headers: { 'x-request-id': 'sk-local-marker' } },
            ),
          );
        };
        // oxlint-disable-next-line no-await-in-loop -- One owned demo session per transport outcome.
        const started = await call('/api/start', { taskId: 'reservation', api, mode: 'live' });
        assert.equal(started.status, 200);
        // oxlint-disable-next-line no-await-in-loop -- Bound the actual first forwarded request.
        await Promise.race([entered.promise, delay(10_000).then(() => assert.fail('No live API request'))]);
        assert.equal(requests.length, 1);
        const [{ url, options }] = requests;
        const body = JSON.parse(options.body);
        assert.equal(url.pathname, `/v1/${api}`);
        assert.equal(options.method, 'POST');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-only');
        assert.equal(body.model, `local-${api}`);
        assert.ok(body.input);
        if (api === 'responses') {
          assert.equal(body.stream, true);
          assert.ok(body.tools.length);
        } else {
          assert.ok(body.questions.length);
        }
        if (outcome === 'cancelled') {
          // oxlint-disable-next-line no-await-in-loop -- Stop the same admitted request.
          assert.equal(await responseStatus(call('/api/stop', { runId: started.body.id })), 200);
          // oxlint-disable-next-line no-await-in-loop -- Stop must settle the already-open response body.
          await Promise.race([
            cancelled.promise,
            delay(5000).then(() => assert.fail('Body was not cancelled')),
          ]);
        }
        // oxlint-disable-next-line no-await-in-loop -- Finish cleanup before starting the next session.
        const stopped = await until((run) => run?.owner === 'stopped' && !run.closing);
        assert.equal(stopped.requests, 1);
        assert.equal(requests.length, 1);
        assert.equal(stopped.result, 'unverified');
        assert.deepEqual(stopped.fixture.results, {});
        assert.equal(stopped.uncertainEffects, false);
        assert.ok(!JSON.stringify(stopped).includes('sk-local-marker'));
        if (outcome === 'denied') {
          assert.equal(stopped.status, 'failed');
          assert.equal(stopped.apiFailure.status, 401);
          assert.ok(!JSON.stringify(stopped.apiFailure).includes('test-only'));
        } else {
          assert.equal(stopped.status, 'stopped');
          assert.equal(stopped.apiFailure, null);
        }
      }
    }
    console.log('PASS live Responses/Decisions: dispatch forwarding, safe denial and cancelled open body.');
  } finally {
    globalThis.fetch = realFetch;
  }
}
async function checkAvailability(page, api, other) {
  models[api] = 'test-only';
  models[other] = undefined;
  const state = await call('/api/state');
  assert.deepEqual(state.body.liveAvailable, { [api]: true, [other]: false });
  await page.selectOption('#api', api);
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
  await page.selectOption('#api', other);
  await page.waitForFunction(() => document.querySelector('#start').disabled);
}
const bind = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
const originalLaunch = chromium.launch;
const held = Promise.withResolvers();
const release = Promise.withResolvers();
const viewEntered = Promise.withResolvers();
const viewRelease = Promise.withResolvers();
const inputEntered = Promise.withResolvers();
const inputRelease = Promise.withResolvers();
let holdInput = false;
let holdView = false;
let holdFinal = false;
let observing = false;
let fixturePage;
chromium.launch = async function launch(options) {
  const opened = await originalLaunch.call(this, options);
  const newContext = opened.newContext.bind(opened);
  opened.newContext = async (contextOptions) => {
    const context = await newContext(contextOptions);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const current = await newPage();
      const start = current.screencast.start.bind(current.screencast);
      current.screencast.start = async (settings) => {
        if (holdView) {
          holdView = false;
          viewEntered.resolve();
          await viewRelease.promise;
        }
        return start(settings);
      };
      const getByLabel = current.getByLabel.bind(current);
      current.getByLabel = (...args) => {
        const locator = getByLabel(...args);
        const fill = locator.fill.bind(locator);
        locator.fill = async (...settings) => {
          await fill(...settings);
          if (holdInput && args[0] === 'Guest name') {
            holdInput = false;
            inputEntered.resolve();
            await inputRelease.promise;
          }
        };
        return locator;
      };
      const screenshot = current.screenshot.bind(current);
      current.screenshot = async (screenshotOptions) => {
        if (holdFinal && !observing) {
          observing = true;
          try {
            const { body } = await call('/api/state');
            if (body.run?.owner === 'agent' && body.run.result === 'verified') {
              holdFinal = false;
              fixturePage = current;
              held.resolve(body.run);
              await release.promise;
            }
          } finally {
            observing = false;
          }
        }
        return screenshot(screenshotOptions);
      };
      return current;
    };
    return context;
  };
  return opened;
};
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

  await checkLive();
  holdView = true;
  const starting = await call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' });
  await Promise.race([viewEntered.promise, delay(5000).then(() => assert.fail('Capture did not start'))]);
  const originalAny = AbortSignal.any;
  let waiters = 0;
  AbortSignal.any = function any(signals) {
    waiters += 1;
    return originalAny.call(this, signals);
  };
  try {
    await Promise.all(Array.from({ length: 25 }, () => call('/api/state')));
    assert.equal(waiters, 0, 'Polling must not add waiters to a pending frame capture');
  } finally {
    AbortSignal.any = originalAny;
    await call('/api/stop', { runId: starting.body.id });
    viewRelease.resolve();
  }
  await until((value) => value?.owner === 'stopped' && !value.closing);

  const receiptPage = await browser.newPage();
  try {
    await receiptPage.goto(`${app.origin}/fixture/reservation`);
    await receiptPage.getByLabel('Guest name').fill('Grace');
    await receiptPage.getByLabel('Party size').selectOption('2');
    await receiptPage.getByLabel('Time').selectOption('18:00');
    await receiptPage.getByLabel('Seating').selectOption('Indoor');
    await receiptPage.getByRole('button', { name: 'Reserve table' }).click();
    await receiptPage.getByLabel('Guest name').fill('Ada');
    const receipt = await inspectTask(receiptPage);
    assert.equal(receipt.verified, false, 'Editing a confirmed form cannot change the submitted booking');
    assert.equal(receipt.results.fields['Guest name'], 'Grace');
  } finally {
    await receiptPage.close();
  }

  const page = await browser.newPage({ viewport: { width: 1340, height: 980 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.launchUrl);
  assert.equal(await page.locator('#api').inputValue(), 'responses');
  await checkAvailability(page, 'responses', 'decisions');
  await checkAvailability(page, 'decisions', 'responses');
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
  assert.deepEqual(run.fixture.results, {
    confirmation: 'TABLE-204',
    fields: { 'Guest name': 'Ada', 'Party size': '2', Time: '18:00', Seating: 'Indoor' },
  });
  await page.getByRole('status').getByText('Verified', { exact: true }).waitFor({ timeout: 3000 });
  let reported = { ...run, status: 'starting', owner: 'agent', browser: null };
  await page.route('**/api/state', (route) =>
    route.fulfill({
      json: { liveAvailable: {}, run: reported },
    }),
  );
  await page.getByRole('status').getByText('starting', { exact: true }).waitFor({ timeout: 3000 });
  assert.equal(await page.locator('#take-control').isDisabled(), true);
  reported = { ...run, status: 'failed' };
  await page.getByRole('status').getByText('failed', { exact: true }).waitFor({ timeout: 3000 });
  reported = { ...run, status: 'cleanup_failed' };
  await page.getByRole('status').getByText('cleanup_failed', { exact: true }).waitFor({ timeout: 3000 });
  await page.unroute('**/api/state');
  await page.getByRole('status').getByText('Verified', { exact: true }).waitFor({ timeout: 3000 });
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
  holdFinal = true;
  assert.equal(
    await responseStatus(call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' })),
    200,
  );
  run = await until((value) => Boolean(value?.approval));
  assert.equal(
    await responseStatus(
      call('/api/approval', { ...bind(run), approvalId: run.approval.id, approved: true }),
    ),
    200,
  );
  run = await Promise.race([
    held.promise,
    delay(8000).then(() => {
      throw new Error('Final verified capture was never reached');
    }),
  ]);
  assert.equal(run.result, 'verified');
  assert.equal(await responseStatus(call('/api/take-control', bind(run))), 200);
  release.resolve();
  run = await until((value) => value?.owner === 'human' && !value.humanInputBusy);
  const bounds = await fixturePage.getByLabel('Guest name').boundingBox();
  assert.ok(bounds);
  assert.equal(
    await responseStatus(
      call('/api/input', {
        ...bind(run),
        action: 'click',
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }),
    ),
    200,
  );
  run = await until((value) => value?.owner === 'human' && !value.humanInputBusy);
  const beforeHumanType = bind(run);
  assert.equal(
    await responseStatus(call('/api/input', { ...bind(run), action: 'type', text: ' changed' })),
    200,
  );
  run = await until((value) => value?.owner === 'human' && !value.humanInputBusy);
  assert.equal(
    await responseStatus(call('/api/input', { ...beforeHumanType, action: 'type', text: ' stale' })),
    409,
    'An older displayed frame must not admit a second input after editing',
  );
  assert.ok(run.browser.sequence > beforeHumanType.sequence);
  assert.equal(run.fixture.verified, false, JSON.stringify(run.fixture));
  assert.equal(await responseStatus(call('/api/stop', { runId: run.id })), 200);
  run = await until((value) => value?.owner === 'stopped' && !value.closing);
  assert.equal(
    run.result,
    'unverified',
    'A verified agent result cannot survive later human editing and Stop',
  );
  holdInput = true;
  assert.equal(
    await responseStatus(call('/api/start', { taskId: 'reservation', api: 'decisions', mode: 'rehearsal' })),
    200,
  );
  await Promise.race([
    inputEntered.promise,
    delay(6000).then(() => assert.fail('Booking input did not start')),
  ]);
  const pendingInput = await call('/api/state');
  ({ run } = pendingInput.body);
  assert.equal(run.owner, 'agent');
  assert.equal(await responseStatus(call('/api/take-control', bind(run))), 200);
  inputRelease.resolve();
  run = await until((value) => value?.owner === 'human' || (value?.owner === 'stopped' && !value.closing));
  assert.equal(run.owner, 'stopped', 'An uncertain booking action must not be handed to the human');
  assert.equal(run.status, 'handoff_unavailable');
  assert.equal(run.uncertainEffects, true);
  console.log(
    'PASS Fieldwork auth, single task, default API/rehearsal, live frames, approval, stale control, Take/Return, checked result, Stop and cleanup.',
  );
} finally {
  holdFinal = false;
  release.resolve();
  viewRelease.resolve();
  inputRelease.resolve();
  chromium.launch = originalLaunch;
  await Promise.all([app.close(), browser.close()]);
}
