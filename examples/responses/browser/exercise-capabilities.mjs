// Ordered real-browser actions against one fixed local canvas. No API key is needed.
// oxlint-disable no-await-in-loop
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { BrowserToolset } from 'openai/helpers/browser';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const fixture = await readFile(new URL('capabilities-fixture.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url !== '/canvas') {
    return response.writeHead(404).end();
  }
  response.writeHead(200, { 'content-type': 'text/html' }).end(fixture);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/canvas`;
let browser;
let sequence = 0;
async function session() {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const base = createBrowserDriver(context, { ownedFixture: { urls: [url], publicViewports: [url] } });
  await base.new_tab({ url });
  const [page] = context.pages();
  const record = await page.locator('#workspace').elementHandle();
  const canvas = await page.locator('#board').elementHandle();
  const lifetime = new AbortController();
  const canvases = [canvas];
  const pointer = await base.createOwnedBrowser({ signal: lifetime.signal, record, canvases });
  canvases.length = 0;
  const tools = new BrowserToolset(
    { ...base, ...pointer },
    {
      members: ['screenshot', 'click_at', 'drag_path', 'hold_keys'],
      confirm: () => true,
    },
  );
  async function execute(name, args, signal) {
    sequence += 1;
    const result = await tools.execute(
      {
        type: 'function_call',
        id: `item-${sequence}`,
        call_id: `call-${sequence}`,
        status: 'completed',
        name: `browser_${name}`,
        arguments: JSON.stringify(args),
      },
      { signal },
    );
    return JSON.parse(result.output[0].text);
  }
  const screenshot = () => execute('screenshot', { tab_id: null });
  return { context, base, page, execute, screenshot };
}

function succeeded(result) {
  assert.equal(result.ok, true);
}

try {
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  const captureSession = await session();
  try {
    const original = captureSession.page.screenshot.bind(captureSession.page);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const controller = new AbortController();
    captureSession.page.screenshot = async (...args) => {
      const image = await original(...args);
      entered.resolve();
      await release.promise;
      return image;
    };
    const pending = captureSession.execute('screenshot', { tab_id: null }, controller.signal);
    const rejected = assert.rejects(pending, /cancel|abort/iu);
    await entered.promise;
    controller.abort();
    release.resolve();
    await rejected;
    captureSession.page.screenshot = original;
    const action = { tab_id: null, x: 20, y: 20, button: 'left', click_count: 1, keys: [] };
    const refused = await captureSession.execute('click_at', action);
    assert.equal(refused.ok, false);
    succeeded(await captureSession.screenshot());
    succeeded(await captureSession.execute('click_at', action));
    console.log(
      'PASS per-call cancelled capture publishes no pointer permit; fresh screenshot permits reuse',
    );
  } finally {
    await captureSession.context.close();
  }
  const current = await session();
  try {
    for (const [button, click_count] of [
      ['right', 1],
      ['left', 2],
      ['middle', 1],
      ['left', 3],
    ]) {
      succeeded(await current.screenshot());
      succeeded(
        await current.execute('click_at', { tab_id: null, x: 20, y: 20, button, click_count, keys: [] }),
      );
    }
    succeeded(await current.screenshot());
    succeeded(
      await current.execute('drag_path', {
        tab_id: null,
        path: [
          { x: 20, y: 20 },
          { x: 100, y: 40 },
          { x: 150, y: 80 },
        ],
        keys: ['Shift', 'Alt'],
      }),
    );
    await current.page.locator('#board').focus();
    succeeded(await current.screenshot());
    succeeded(
      await current.execute('hold_keys', { tab_id: null, keys: ['Shift', 'ArrowRight'], duration_ms: 120 }),
    );
    const result = await current.page.evaluate(() => window.readCanvasResult());
    assert.deepEqual(result.buttons, [2, 0, 0, 1, 0, 0, 0, 0]);
    assert.deepEqual(result.clickDetails, [1, 1, 2, 1, 1, 2, 3, 1]);
    assert.equal(result.doubleClicks, 2);
    assert.deepEqual(result.dragPoints, [
      [100, 40],
      [150, 80],
    ]);
    assert.equal(result.modifierDrag, true);
    assert.deepEqual(result.pressed, []);
    assert.equal(result.trusted, true);
    assert.ok(result.held >= 100);
    await current.screenshot();
    await current.page.locator('#board').evaluate((node) => node.replaceWith(node.cloneNode(true)));
    const replaced = await current.execute('click_at', {
      tab_id: null,
      x: 20,
      y: 20,
      button: 'left',
      click_count: 1,
      keys: [],
    });
    assert.equal(replaced.ok, false);
    const afterReplacement = await current.page.evaluate(() => window.readCanvasResult());
    assert.deepEqual(afterReplacement.buttons, result.buttons);
    console.log(
      'PASS trusted right/middle/double/triple clicks, modifier drag, timed hold, released keys and replaced-canvas refusal',
    );
  } finally {
    await current.context.close();
  }

  const changed = await session();
  const delivered = [];
  try {
    await changed.page.exposeFunction('recordGesture', (event) => {
      delivered.push(event);
    });
    await changed.page.evaluate(() => {
      document.addEventListener('mousedown', (event) => {
        void window.recordGesture({
          type: 'down',
          detail: event.detail,
          target: event.target.id,
          trusted: event.isTrusted,
        });
      });
      document.addEventListener('keyup', (event) => {
        void window.recordGesture({ type: 'up', key: event.key });
      });
      document.querySelector('#board').addEventListener('mouseup', (event) => {
        if (event.detail === 2) {
          const replacement = event.target.cloneNode(true);
          replacement.id = 'replacement';
          event.target.replaceWith(replacement);
        }
      });
    });
    succeeded(await changed.screenshot());
    await assert.rejects(
      changed.execute('click_at', {
        tab_id: null,
        x: 20,
        y: 20,
        button: 'left',
        click_count: 3,
        keys: ['Shift'],
      }),
    );
    assert.deepEqual(
      delivered.filter((event) => event.type === 'down'),
      [
        { type: 'down', detail: 1, target: 'board', trusted: true },
        { type: 'down', detail: 2, target: 'board', trusted: true },
      ],
    );
    assert.ok(delivered.some((event) => event.type === 'up' && event.key === 'Shift'));
    assert.equal(changed.context.pages().length, 0);
    console.log('PASS replaced target receives no third click; held modifier released and context retired');
  } finally {
    await changed.context.close();
  }

  const cancelled = await session();
  const independent = await session();
  try {
    await cancelled.page.locator('#board').focus();
    await cancelled.screenshot();
    const controller = new AbortController();
    const work = cancelled.execute(
      'hold_keys',
      { tab_id: null, keys: ['Shift', 'ArrowRight'], duration_ms: 3000 },
      controller.signal,
    );
    const rejected = assert.rejects(work);
    await cancelled.page.waitForFunction(() => window.readCanvasResult().pressed.includes('ArrowRight'));
    controller.abort();
    await rejected;
    assert.equal(cancelled.context.pages().length, 0);
    assert.equal(cancelled.base.hasUncertainEffects(), true);
    succeeded(await independent.screenshot());
    const untouched = await independent.page.evaluate(() => window.readCanvasResult());
    assert.deepEqual(untouched.pressed, []);
    console.log('PASS cancelled hold retires only its own context; second owner remains usable');
  } finally {
    await cancelled.context.close();
    await independent.context.close();
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await promisify(server.close.bind(server))();
  }
}
