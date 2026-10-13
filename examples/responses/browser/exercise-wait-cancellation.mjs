import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const mode = process.argv[2] ?? 'stop';
assert.ok(['stop', 'timeout', 'close-failure'].includes(mode));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><h1>Ready</h1>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
const nativeClose = context.close.bind(context);
const entered = Promise.withResolvers();
const releaseRead = Promise.withResolvers();
const releaseClose = Promise.withResolvers();
let result;
let closes = 0;
try {
  const driver = createBrowserDriver(context, { ownedFixture: { urls: [url] } });
  const tab = await driver.new_tab({ url });
  const frame = context.pages()[0].mainFrame();
  const locate = frame.locator.bind(frame);
  frame.locator = (...args) => {
    const locator = locate(...args);
    if (args[0] === 'html') {
      const evaluate = locator.evaluateHandle.bind(locator);
      locator.evaluateHandle = async (...values) => {
        const report = await evaluate(...values);
        entered.resolve();
        await releaseRead.promise;
        return report;
      };
    }
    return locator;
  };
  context.close = async () => {
    closes += 1;
    if (mode === 'close-failure') {
      throw new Error('Controlled close failure');
    }
    await releaseClose.promise;
    await nativeClose();
  };
  const stopped = new AbortController();
  const waiting = driver.wait_for(
    { tab_id: tab, text: 'Ready', timeout_ms: mode === 'timeout' ? 250 : 5000 },
    { signal: stopped.signal },
  );
  result = Promise.allSettled([waiting]);
  await entered.promise;
  if (mode !== 'timeout') {
    stopped.abort(new Error('Operator Stop'));
  }
  const deadline = new AbortController();
  let observed;
  try {
    observed = await Promise.race([result, delay(1500, null, { signal: deadline.signal })]);
  } finally {
    deadline.abort();
  }
  assert.notEqual(observed, null, 'Cancellation must return before the held read and close.');
  assert.equal(observed[0].status, 'rejected');
  assert.match(observed[0].reason.message, mode === 'timeout' ? /timed out/iu : /abort|stop/iu);
  assert.equal(closes, 1);
  assert.equal(driver.hasUncertainEffects(), false);
  await assert.rejects(driver.get_page_text({ tab_id: tab }), /retired/iu);
  console.log(`PASS ${mode}: wait returns promptly with admission retired and no uncertain input`);
} finally {
  releaseRead.resolve();
  releaseClose.resolve();
  await result;
  await nativeClose();
  await browser.close();
  await promisify(server.close.bind(server))();
}
