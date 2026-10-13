import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createLiveView } from './live-view.mjs';

const browser = await chromium.launch({
  headless: true,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp' },
});
const context = await browser.newContext({
  viewport: { width: 1024, height: 720 },
  serviceWorkers: 'block',
  acceptDownloads: false,
});
try {
  const page = await context.newPage();
  await context.route('**/*', (route) => route.abort());
  await page.setContent(
    `<style>body{margin:0;background:#eff5eb;font:32px system-ui;color:#254b32}main{padding:80px}#pixel{width:320px;height:180px;background:#92bc77;animation:change 1s steps(1) infinite}@keyframes change{50%{background:#edbf68}}</style><main><h1>Live browser view test</h1><p>This page changes without an SDK action or screenshot.</p><div id="pixel"></div></main>`,
  );
  const view = await createLiveView(page);
  const deadline = Date.now() + 10_000;
  while (!view.frame && Date.now() < deadline) {
    // Each poll waits for the preceding frame; parallel waits cannot observe progress.
    // oxlint-disable-next-line no-await-in-loop
    await delay(25);
  }
  assert.ok(view.frame, 'The actual page must produce an initial frame.');
  const first = view.frame;
  assert.equal(first[0], 0xff);
  assert.equal(first[1], 0xd8);
  assert.equal(view.state.width, 1024);
  assert.equal(view.state.height, 720);
  while (view.frame.equals(first) && Date.now() < deadline) {
    // A changed frame depends on the current capture, so check it in sequence.
    // oxlint-disable-next-line no-await-in-loop
    await delay(25);
  }
  assert.notDeepEqual(view.frame, first, 'Live frames must change without SDK capture.');
  const observed = view.state;
  await view.close();
  assert.equal(view.state.status, 'closed');
  assert.equal(view.frame, null);
  await delay(150);
  assert.equal(view.state.sequence, observed.sequence, 'Closing capture stops callbacks.');
  const closingView = await createLiveView(page);
  await page.close();
  assert.equal(closingView.state.status, 'closed');
  assert.equal(closingView.frame, null);
  await closingView.close();
  console.log(
    JSON.stringify({
      pageCloseClearsFrame: true,
      success: true,
      kind: 'public Playwright screencast; no API requests',
      viewport: [observed.width, observed.height],
      observedFrames: observed.sequence,
      changingPixels: true,
      frameClearedOnClose: true,
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
