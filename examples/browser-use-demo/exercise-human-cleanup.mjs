import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { createFieldworkMixed } from './mixed-session.mjs';
import { Desktop } from '../computer-desktop/desktop.mjs';

const originalLaunch = chromium.launch;
const originalFetch = globalThis.fetch;
const entered = Promise.withResolvers();
const release = Promise.withResolvers();
let browser;
let app;
chromium.launch = async function launch(options) {
  browser = await originalLaunch.call(this, options);
  return browser;
};
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).origin, 'https://api.openai.com');
  entered.resolve();
  await release.promise;
  return Response.json({
    model: 'synthetic',
    answers: [{ type: 'refusal', name: 'next_action' }],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
};
try {
  app = await createDemoServer({ port: 0, apiKey: 'synthetic', models: { decisions: 'synthetic' } });
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  const call = async (route, body) => {
    const response = await originalFetch(app.origin + route, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: app.origin, 'X-Demo-Token': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const waitFor = async (predicate, route = '/api/state') => {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      // This bounded observation follows one owned control transition.
      // oxlint-disable-next-line no-await-in-loop
      const value = await call(route);
      const run = value.run ?? value;
      if (predicate(run)) {
        return run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(10);
    }
    throw new Error('The expected control transition did not finish.');
  };
  await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'live' });
  await entered.promise;
  const { run } = await call('/api/state');
  await call('/api/take-control', {
    runId: run.id,
    ownerVersion: run.ownerVersion,
    tabId: run.browser.tabId,
    sequence: run.browser.sequence,
  });
  release.resolve();
  const human = await waitFor((value) => value.owner === 'human');
  const [context] = browser.contexts();
  const close = context.close.bind(context);
  context.close = async () => {
    throw new Error('Controlled context cleanup failure');
  };
  await call('/api/stop', { runId: human.id });
  const receipt = await waitFor((value) => value.cleanup === 'failed', `/api/export?run=${human.id}`);
  assert.equal(receipt.status, 'cleanup_failed');
  assert.equal(receipt.cleanup, 'failed');
  assert.equal(receipt.result, human.result);
  await close();
  assert.equal(browser.contexts().length, 0);
  console.log('PASS human-held Stop reports cleanup failure and preserves its verified result state');
} finally {
  release.resolve();
  await app?.close().catch(() => null);
  await browser?.close();
  chromium.launch = originalLaunch;
  globalThis.fetch = originalFetch;
}

const originalDesktop = Desktop.create;
try {
  chromium.launch = async () => {
    throw new Error('Controlled initialization refusal');
  };
  let stops = 0;
  Desktop.create = async () => ({
    uncertainEffects: false,
    async stop() {
      stops += 1;
      if (stops === 1) {
        throw new Error('Controlled initial cleanup failure');
      }
    },
  });
  const run = { owner: 'agent', started: performance.now(), cleanup: 'pending', result: 'unverified' };
  await assert.rejects(createFieldworkMixed({ runtimeDir: 'controlled-no-guest', run }));
  assert.equal(run.cleanup, 'failed');
  assert.equal(run.result, 'unverified');
  assert.ok(stops >= 2, 'The wrapper retries its owned desktop cleanup.');
  assert.ok(run.receipts.some((entry) => entry.kind === 'cleanup' && entry.outcome === 'failed'));
  console.log('PASS dashboard retains failed mixed setup cleanup after successful retries');
} finally {
  chromium.launch = originalLaunch;
  Desktop.create = originalDesktop;
}
