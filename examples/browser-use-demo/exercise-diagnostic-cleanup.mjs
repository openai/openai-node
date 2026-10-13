/* oxlint-disable no-await-in-loop -- Each poll and each case waits for the preceding local owner. */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDiagnosticCapture, readDiagnosticTrace } from './diagnostics.mjs';
import { createDemoServer } from './server.mjs';

for (const failClose of [false, true]) {
  const capture = createDiagnosticCapture();
  const originalLaunch = chromium.launch;
  const entered = Promise.withResolvers();
  const closeEntered = Promise.withResolvers();
  const gate = Promise.withResolvers();
  let browser;
  let context;
  let realClose;
  let closeCalls = 0;
  let app;
  chromium.launch = async function launch(options) {
    browser = await originalLaunch.call(this, options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      context = await newContext(...args);
      const newPage = context.newPage.bind(context);
      realClose = context.close.bind(context);
      context.newPage = async (...pageArgs) => {
        const page = await newPage(...pageArgs);
        entered.resolve();
        await gate.promise;
        return page;
      };
      context.close = async (...closeArgs) => {
        closeCalls += 1;
        closeEntered.resolve();
        if (failClose) {
          throw new Error('finite owned close failure');
        }
        await realClose(...closeArgs);
      };
      return context;
    };
    return browser;
  };
  try {
    app = await createDemoServer({ port: 0, diagnosticCapture: capture });
    const headers = {
      origin: app.origin,
      'x-demo-token': new URL(app.launchUrl).hash.slice('#token='.length),
      'content-type': 'application/json',
    };
    const post = (route, body) =>
      fetch(`${app.origin}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const config = { taskId: 'support', api: 'decisions', mode: 'rehearsal' };
    const start = await post('/api/start', config);
    assert.equal(start.status, 200);
    const started = await start.json();
    await Promise.race([
      entered.promise,
      delay(5000).then(() => {
        throw new Error('setup not entered');
      }),
    ]);
    const stopped = await post('/api/stop', { runId: started.id });
    assert.equal(stopped.status, 200);
    const filename = path.join(capture.directory, 'run-1.jsonl');
    await Promise.race([
      closeEntered.promise,
      delay(5000).then(() => {
        throw new Error('close not entered');
      }),
    ]);
    assert.equal(closeCalls, 1);
    assert.equal(readDiagnosticTrace(filename).incomplete, true, 'setup still owns the held page');
    const premature = await post('/api/start', config);
    assert.equal(premature.status, 409, 'setup cannot be replaced while it is held');
    gate.resolve();
    let trace;
    const completed = Date.now() + 5000;
    do {
      trace = readDiagnosticTrace(filename);
      if (!trace.incomplete) {
        break;
      }
      await delay(5);
    } while (Date.now() < completed);
    assert.equal(trace.incomplete, false, 'all settled cleanup outcomes must finalize the private trace');
    const final = trace.records.filter(({ kind, data }) => kind === 'run' && data.cleanup);
    assert.equal(final.length, 1);
    assert.equal(final[0].data.cleanup, failClose ? 'failed' : 'completed');
    if (failClose) {
      assert.equal(final[0].data.status, 'cleanup_failed');
      const blocked = await post('/api/start', config);
      assert.equal(blocked.status, 409, 'failed cleanup must remain busy');
      await assert.rejects(app.close(), AggregateError);
    } else {
      await app.close();
    }
    console.log(
      `PASS ${failClose ? 'failed' : 'completed'} cleanup closes diagnostics only after held initialization settles`,
    );
  } finally {
    gate.resolve();
    chromium.launch = originalLaunch;
    await realClose?.();
    await browser?.close();
    await app?.close().catch(() => {
      // The expected failed-close case is asserted above. The real owned browser is already reaped.
    });
    await rm(capture.directory, { recursive: true, force: true });
  }
}
