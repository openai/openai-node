import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { withBorrowedBrowser } from './browserbase-session.mjs';

const server = createServer((_request, response) =>
  response
    .writeHead(200, { 'Content-Type': 'text/html' })
    .end(
      '<!doctype html><title>Synthetic managed page</title>' +
        '<button aria-label="Apply">Apply</button><output>0</output>' +
        '<script>let count=0;document.querySelector("button").onclick=()=>' +
        'document.querySelector("output").textContent=++count;</script>',
    ),
);
let browser;
const results = [];
const read = async (driver, tab) => {
  const page = await driver.read_page({ tab_id: tab, filter: 'all' });
  assert.equal(page.elements.length, 1);
  return page.elements[0].ref;
};
const effect = (driver, tab, ref) => driver.click({ tab_id: tab, target: ref });
const count = async (driver, tab) => {
  const text = await driver.get_page_text({ tab_id: tab });
  return Number(text.match(/\d+$/u)[0]);
};
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  const config = { allowedOrigins: [origin] };
  const check = async (name, driver, tab, ref) => {
    const before = await count(driver, tab);
    let rejected = false;
    try {
      await effect(driver, tab, ref);
    } catch (error) {
      assert.match(error.message, /ref|stale|document|changed/iu);
      rejected = true;
    }
    const after = await count(driver, tab);
    results.push({ name, rejected, before, after, pass: rejected && before === after });
    console.log(JSON.stringify(results.at(-1)));
  };
  await withBorrowedBrowser(browser, config, async (driver) => {
    const tab = await driver.new_tab({ url: `${origin}/a` });
    const initial = await read(driver, tab);
    await effect(driver, tab, initial);
    assert.equal(await count(driver, tab), 1, 'A live ref must actually activate its original control.');
    const other = await driver.new_tab({ url: `${origin}/b` });
    await driver.switch_tab({ tab_id: tab });
    await check('A -> B -> A', driver, tab, initial);
    const beforeHash = await read(driver, tab);
    const context = browser
      .contexts()
      .find((candidate) => candidate.pages().some((p) => p.url() === `${origin}/a`));
    const page = context.pages().find((p) => p.url() === `${origin}/a`);
    await page.evaluate(() => {
      location.hash = 'changed';
    });
    await page.waitForURL('**/a#changed');
    await check('same-document navigation', driver, tab, beforeHash);
    const beforeClose = await read(driver, tab);
    await driver.close_tab({ tab_id: other });
    await check('known tab close', driver, tab, beforeClose);
    const current = await read(driver, tab);
    const before = await count(driver, tab);
    await effect(driver, tab, current);
    assert.equal(await count(driver, tab), before + 1, 'Fresh post-event refs still work.');
    await withBorrowedBrowser(browser, config, async (second) => {
      const unrelated = await second.new_tab({ url: `${origin}/unrelated` });
      const own = await read(second, unrelated);
      await check('ref from another live session', second, unrelated, initial);
      const beforeOwn = await count(second, unrelated);
      await effect(second, unrelated, own);
      assert.equal(await count(second, unrelated), beforeOwn + 1);
    });
    await read(driver, tab);
    await check('ref from before re-read', driver, tab, current);
  });
  assert.equal(browser.contexts().length, 0, 'Both borrowed contexts must close.');
  assert.ok(browser.isConnected(), 'The borrowed browser belongs to the caller.');
  console.log(JSON.stringify({ contexts: browser.contexts().length, results }, null, 2));
  assert.ok(
    results.every(({ pass }) => pass),
    'Every stale or foreign ref must be refused with no effect.',
  );
} finally {
  await browser?.close();
  await promisify(server.close.bind(server))();
}
