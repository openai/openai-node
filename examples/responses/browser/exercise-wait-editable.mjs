// oxlint-disable eslint/no-await-in-loop -- Cases share Chromium and each held read must finish before its context closes.
// Finite local Chromium observations for explicit waits and borrowed editing hosts.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const [mode] = process.argv.slice(2);
assert.ok(['wait', 'editable'].includes(mode));
const server = createServer((_request, response) => {
  response
    .writeHead(200, { 'content-type': 'text/html' })
    .end('<!doctype html><title>Fixture</title><h1>Ready marker</h1>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const urls = [`${origin}/a`, `${origin}/b`, `${origin}/c`];
const browser = await chromium.launch({ headless: true });
const checked = [];
try {
  if (mode === 'editable') {
    const context = await browser.newContext();
    try {
      const driver = createBrowserDriver(context);
      const tab = await driver.new_tab({ url: urls[0] });
      const [page] = context.pages();
      await page.setContent(`<!doctype html>
        <div contenteditable aria-label="Bare">before</div>
        <div contenteditable="true" aria-label="True">before</div>
        <div contenteditable="plaintext-only" aria-label="Plain">before</div>
        <div contenteditable="true" aria-label="Root"><span aria-label="Inherited">text</span>
          <div contenteditable="false" aria-label="Excluded"><span aria-label="False child">fixed</span></div>
        </div>
        <div contenteditable="false" aria-label="False">fixed
          <div contenteditable="true" aria-label="Island">before</div>
        </div>`);
      const report = await driver.read_page({ tab_id: tab, filter: 'interactive' });
      const names = report.elements.map((entry) => entry.label);
      assert.deepEqual(names, ['Bare', 'True', 'Plain', 'Root', 'Island']);
      assert.ok(report.elements.every((entry) => entry.role === 'textbox'));
      for (const name of ['Bare', 'True', 'Plain', 'Island']) {
        const entry = report.elements.find((item) => item.label === name);
        await driver.type({ tab_id: tab, target: entry.ref, text: `edited ${name}` });
        assert.equal(await page.getByLabel(name).textContent(), `edited ${name}`);
      }
      const root = report.elements.find((item) => item.label === 'Root');
      await page.getByLabel('Root').evaluate((element) => element.setAttribute('contenteditable', 'false'));
      await assert.rejects(driver.type({ tab_id: tab, target: root.ref, text: 'must not apply' }));
      assert.doesNotMatch(await page.getByLabel('Root').textContent(), /must not apply/u);
      checked.push(
        'bare, true, plaintext-only; no inherited or false refs; later editability change stops fill',
      );
    } finally {
      await context.close();
    }
  } else {
    for (const change of [
      'background',
      'other_focus',
      'implicit_focus',
      'selected_navigation',
      'selected_close',
    ]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const driver = createBrowserDriver(context, { ownedFixture: { urls } });
        const a = await driver.new_tab({ url: urls[0] });
        const [page] = context.pages();
        const b = await driver.new_tab({ url: urls[1] });
        await driver.new_tab({ url: urls[2] });
        if (change === 'implicit_focus') {
          await driver.switch_tab({ tab_id: a });
        }
        const target = change === 'implicit_focus' ? null : a;
        if (change === 'background') {
          assert.equal(
            await driver.wait_for({ tab_id: target, text: 'Ready marker', timeout_ms: 4000 }),
            'Visible condition met.',
          );
        } else {
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const frame = page.mainFrame();
          const native = frame.locator.bind(frame);
          let held = false;
          frame.locator = (...args) => {
            const locator = native(...args);
            if (args[0] === 'html' && !held) {
              const evaluate = locator.evaluateHandle.bind(locator);
              locator.evaluateHandle = async (...values) => {
                const result = await evaluate(...values);
                held = true;
                entered.resolve();
                await release.promise;
                return result;
              };
            }
            return locator;
          };
          const pending = driver.wait_for({ tab_id: target, text: 'Ready marker', timeout_ms: 4000 });
          const outcome = Promise.allSettled([pending]);
          await entered.promise;
          try {
            if (change.endsWith('focus')) {
              await driver.switch_tab({ tab_id: b });
            }
            if (change === 'selected_navigation') {
              await page.reload();
            }
            if (change === 'selected_close') {
              await page.close();
            }
          } finally {
            release.resolve();
          }
          const [result] = await outcome;
          if (change === 'other_focus') {
            assert.deepEqual(result, { status: 'fulfilled', value: 'Visible condition met.' });
          } else {
            assert.equal(result.status, 'rejected', `wait must stop after ${change}`);
          }
        }
        checked.push(change);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
console.log(JSON.stringify({ mode, checked }));
