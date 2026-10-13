import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { serve } from './workflow.mjs';

const protectedServer = await serve();
try {
  const other = await serve();
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${other.origin}/inbox?fixture=A`);
      assert.equal(await page.evaluate(() => Boolean(window.workflowFixtures?.A)), true);
      await page.evaluate(() => delete window.workflowFixtures);
      await assert.rejects(page.addScriptTag({ url: `${protectedServer.origin}/fixtures.js` }));
      assert.equal(await page.evaluate(() => window.workflowFixtures === undefined), true);
      await page.addScriptTag({ url: `${other.origin}/fixtures.js` });
      assert.equal(await page.evaluate(() => Boolean(window.workflowFixtures?.A)), true);
    } finally {
      await browser.close();
    }
  } finally {
    await other.close();
  }
} finally {
  await protectedServer.close();
}
console.log('PASS local scripts load, while another origin cannot load workflow fixtures');
