// Actual server requests with a controlled startup outcome; no guest or model API is started.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { DesktopStartupError } from '../computer-desktop/startup-error.mjs';
import { createDemoServer } from './server.mjs';

async function check(failedCleanup) {
  const original = Desktop.create;
  let app;
  Desktop.create = async ({ signal }) => {
    const pending = Promise.withResolvers();
    const stopped = () =>
      pending.reject(failedCleanup ? new Error('Controlled reap failure') : new DesktopStartupError());
    signal.addEventListener('abort', stopped, { once: true });
    if (signal.aborted) {
      stopped();
    }
    return pending.promise;
  };
  try {
    app = await createDemoServer({
      port: 0,
      apiKey: 'synthetic',
      models: { responses: 'synthetic' },
      desktopRuntime: 'controlled-factory-only',
    });
    const page = await fetch(app.origin);
    const html = await page.text();
    const token = new URL(app.launchUrl).hash.slice('#token='.length);
    assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
    const call = async (route, body, expected = 200) => {
      const reply = await fetch(`${app.origin}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Demo-Token': token,
          Origin: app.origin,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(reply.status, expected);
      return reply.json();
    };
    const start = { environment: 'desktop', taskId: 'desktop', api: 'responses', mode: 'live' };
    const first = await call('/api/start', start);
    await call('/api/stop', { runId: first.id });
    let final;
    for (let count = 0; count < 50; count += 1) {
      // Each request waits for the current startup cancellation to finish.
      // oxlint-disable-next-line no-await-in-loop
      final = await call(`/api/export?run=${first.id}`);
      if (['completed', 'failed'].includes(final.cleanup)) {
        break;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(10);
    }
    assert.equal(final.cleanup, failedCleanup ? 'failed' : 'completed');
    assert.equal(final.requests, 0);
    if (failedCleanup) {
      await call('/api/start', start, 409);
      await assert.rejects(app.close(), AggregateError);
      app = undefined;
    } else {
      const next = await call('/api/start', start);
      assert.notEqual(next.id, first.id);
      await call('/api/stop', { runId: next.id });
    }
    console.log(
      `PASS startup Stop ${failedCleanup ? 'preserves cleanup failure and blocks another run' : 'reports completed cleanup and accepts a fresh run'}`,
    );
  } finally {
    try {
      await app?.close();
    } finally {
      Desktop.create = original;
    }
  }
}

await check(false);
await check(true);
