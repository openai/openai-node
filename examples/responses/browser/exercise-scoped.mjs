import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createBrowserDriver } from './driver.mjs';

const html = await readFile(new URL('scoped-fixture.html', import.meta.url));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/scoped`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 960, height: 800 } });
try {
  const driver = createBrowserDriver(context, { ownedFixture: { urls: [url] } });
  await driver.new_tab({ url });
  const [page] = context.pages();
  const tools = new BrowserToolset(driver, {
    members: ['read_page', 'read_page_scoped', 'click'],
    confirm: () => true,
  });
  let sequence = 0;
  const execute = async (member, args) => {
    sequence += 1;
    const result = await tools.execute({
      type: 'function_call',
      status: 'completed',
      id: `i${sequence}`,
      call_id: `c${sequence}`,
      name: `browser_${member}`,
      arguments: JSON.stringify(args),
    });
    return JSON.parse(result.output[0].text);
  };
  const discover = async () => {
    const result = await execute('read_page_scoped', { tab_id: null, root: null, depth: 32, filter: 'all' });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.result.scopes.map(({ label }) => label),
      ['Order North', 'Order South'],
    );
    assert.ok(!result.result.text.includes('Secret'));
    return result.result;
  };
  const first = await discover();
  const north = first.scopes[0].ref;
  const south = first.scopes[1].ref;
  const notAnAction = await execute('click', { tab_id: null, target: south });
  assert.equal(notAnAction.ok, false);
  assert.equal(await page.locator('#picked').textContent(), 'none');
  const scoped = await execute('read_page_scoped', { tab_id: null, root: south, depth: 32, filter: 'all' });
  assert.equal(scoped.ok, true);
  assert.ok(scoped.result.text.includes('Public South') && scoped.result.text.includes('Deep South'));
  assert.ok(!scoped.result.text.includes('North') && !scoped.result.text.includes('Secret'));
  assert.deepEqual(
    scoped.result.elements.map(({ label }) => label),
    ['Open'],
  );
  const picked = await execute('click', { tab_id: null, target: scoped.result.elements[0].ref });
  assert.equal(picked.ok, true);
  assert.equal(await page.locator('#picked').textContent(), 'south');
  const expired = await execute('read_page_scoped', { tab_id: null, root: north, depth: 32, filter: 'all' });
  assert.equal(expired.ok, false);
  const second = await discover();
  const shallow = await execute('read_page_scoped', {
    tab_id: null,
    root: second.scopes[1].ref,
    depth: 1,
    filter: 'all',
  });
  assert.equal(shallow.ok, true);
  assert.ok(!shallow.result.text.includes('Deep') && !shallow.result.text.includes('Public'));

  // oxlint-disable no-await-in-loop -- Each case needs fresh refs from the same page, then a settled mutation.
  for (const mutation of ['hidden', 'replace', 'rename', 'tab']) {
    await driver.navigate({ tab_id: null, url });
    const observed = await discover();
    const old = observed.scopes[1].ref;
    if (mutation === 'hidden') {
      await page
        .locator('section')
        .nth(1)
        .evaluate((node) => {
          node.hidden = true;
        });
    }
    if (mutation === 'replace') {
      await page
        .locator('section')
        .nth(1)
        .evaluate((node) => {
          node.replaceWith(node.cloneNode(true));
        });
    }
    if (mutation === 'rename') {
      await page
        .locator('section')
        .nth(1)
        .evaluate((node) => {
          node.setAttribute('aria-label', 'Other order');
        });
    }
    if (mutation === 'tab') {
      const state = await driver.state();
      const original = state.tabs.find((tab) => tab.active).id;
      await driver.new_tab({ url });
      await driver.switch_tab({ tab_id: original });
    }
    const stale = await execute('read_page_scoped', { tab_id: null, root: old, depth: 32, filter: 'all' });
    assert.equal(stale.ok, false, mutation);
  }
  // oxlint-enable no-await-in-loop
  await driver.navigate({ tab_id: null, url });
  const legacy = await execute('read_page', { tab_id: null, filter: 'all' });
  assert.equal(legacy.ok, true);
  assert.equal(Object.hasOwn(legacy.result, 'scopes'), false);
  assert.deepEqual(
    legacy.result.elements.map(({ label }) => label),
    ['Open', 'Open'],
  );
  console.log(
    JSON.stringify({
      success: true,
      picked: 'south',
      depth: 'bounded',
      privacy: true,
      stale: ['read', 'hidden', 'replace', 'rename', 'tab'],
      legacy: true,
    }),
  );
} finally {
  await context.close();
  await browser.close();
  server.close();
  await once(server, 'close');
}
