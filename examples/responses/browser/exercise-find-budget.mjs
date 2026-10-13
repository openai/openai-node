import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const buttons = Array.from(
    { length: 100 },
    (_, index) => `<button>${index === 0 ? 'Target early' : `Choice ${index}`}</button>`,
  ).join('');
  const html = `${buttons}<button>Target late</button><button>Straße</button>
    <a href="/${'x'.repeat(4097)}">Overbudget link</a><output></output>
    <script>document.addEventListener('click', event => {
      if (event.target.tagName === 'BUTTON') document.querySelector('output').textContent = event.target.textContent;
    });</script>`;
  await context.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  const driver = createBrowserDriver(context);
  const page = await context.newPage();
  await page.goto(`https://fixture.invalid/private/${'x'.repeat(20_000)}?token=local#secret`);
  const state = await driver.state();
  assert.equal(state.tabs[0].url, 'https://fixture.invalid');
  const tab_id = state.tabs[0].id;
  const initial = await driver.read_page({ tab_id, filter: 'interactive' });
  assert.equal(initial.elements.length, 100);
  assert.ok(initial.omitted.includes('target_limit'));
  const found = await driver.find({ tab_id, query: 'Target' });
  assert.deepEqual(
    found.elements.map((item) => item.label),
    ['Target early', 'Target late'],
  );
  await driver.click({ tab_id, target: found.elements[0].ref });
  assert.equal(await page.locator('output').textContent(), 'Target early');
  await driver.click({ tab_id, target: found.elements[1].ref });
  assert.equal(await page.locator('output').textContent(), 'Target late');
  const all = await driver.find({ tab_id, query: '' });
  assert.equal(all.elements.length, 100);
  assert.ok(all.omitted.includes('target_limit'));
  const excluded = await driver.find({ tab_id, query: 'Overbudget' });
  assert.equal(excluded.elements.length, 0);
  assert.ok(excluded.omitted.includes('unsupported_control'));
  await context.close();
  console.log('PASS origin-only state, bounded read/find, late reference actions, oversized binding refusal');
} finally {
  await browser.close();
}
