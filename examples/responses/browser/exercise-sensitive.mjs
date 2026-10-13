import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createSensitiveDriver } from './sensitive-driver.mjs';

const html = await readFile(new URL('sensitive-fixture.html', import.meta.url));
let escaped = 0;
const server = createServer((_request, response) =>
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html),
);
const other = createServer((_request, response) => {
  escaped += 1;
  response.writeHead(200).end('unreachable');
});
server.listen(0, '127.0.0.1');
other.listen(0, '127.0.0.1');
await Promise.all([once(server, 'listening'), once(other, 'listening')]);
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const blocked = `http://127.0.0.1:${other.address().port}/SENTINEL_NETWORK`;
const browser = await chromium.launch({ headless: true });
let sequence = 0;
const execute = async (tools, member, args, signal) => {
  sequence += 1;
  const output = await tools.execute(
    {
      type: 'function_call',
      status: 'completed',
      id: `i${sequence}`,
      call_id: `c${sequence}`,
      name: `browser_${member}`,
      arguments: JSON.stringify(args),
    },
    { signal },
  );
  return JSON.parse(output.output[0].text);
};
try {
  const occupied = await browser.newContext({ serviceWorkers: 'block' });
  const witness = await occupied.newPage();
  await witness.setContent('<p>Existing page must survive</p>');
  const listeners = occupied.listenerCount('page');
  await assert.rejects(async () => {
    const unexpected = createSensitiveDriver(occupied, { url, diagnostics: true, scripts: true });
    await unexpected.state();
  }, /empty owned context/u);
  assert.equal(occupied.listenerCount('page'), listeners);
  assert.equal(witness.isClosed(), false);
  assert.equal(await witness.locator('p').textContent(), 'Existing page must survive');
  await occupied.close();

  const disabledContext = await browser.newContext({ serviceWorkers: 'block' });
  const disabled = createSensitiveDriver(disabledContext, { url });
  assert.equal(disabled.read_diagnostics, undefined);
  assert.equal(disabled.run_script, undefined);
  await disabledContext.close();

  const rootURL = new URL(url).origin;
  const rootContext = await browser.newContext({ serviceWorkers: 'block' });
  const rootDriver = createSensitiveDriver(rootContext, { url: rootURL, diagnostics: true });
  await rootDriver.new_tab({ url: rootURL });
  const rootTools = new BrowserToolset(rootDriver, { members: ['read_diagnostics'], confirm: () => true });
  const rootReport = await execute(rootTools, 'read_diagnostics', {
    tab_id: null,
    source: 'network',
    limit: 100,
  });
  assert.equal(rootReport.ok, true);
  await rootDriver.navigate({ tab_id: null, url: rootURL });
  assert.equal(rootContext.pages()[0].url(), `${rootURL}/`);
  await assert.rejects(rootDriver.navigate({ tab_id: null, url: `${rootURL}/other` }), /fixture/u);
  await rootContext.close();

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const driver = createSensitiveDriver(context, { url, diagnostics: true, scripts: true });
  await driver.new_tab({ url });
  const [page] = context.pages();
  const tools = new BrowserToolset(driver, {
    members: ['read_page', 'read_diagnostics', 'run_script', 'click'],
    confirm: () => true,
  });
  const visible = await execute(tools, 'read_page', { tab_id: null, filter: 'all' });
  assert.ok(!visible.result.text.includes('SENTINEL') && !visible.result.text.includes('synthetic-42'));
  const diagnostics = { tab_id: null, source: 'console', limit: 100 };
  const first = await execute(tools, 'read_diagnostics', diagnostics);
  const second = await execute(tools, 'read_diagnostics', diagnostics);
  assert.deepEqual(first.result, second.result);
  assert.ok(first.result.text.includes('console:warning'));
  const network = await execute(tools, 'read_diagnostics', { ...diagnostics, source: 'network' });
  assert.ok(network.result.text.includes('failed'));
  assert.ok(!JSON.stringify([first, network]).includes('SENTINEL'));
  assert.deepEqual(first.result.elements, []);
  const script = await execute(tools, 'run_script', {
    tab_id: null,
    timeout_ms: 2000,
    source: `document.querySelector('#box').setAttribute('x', '70');
      await fetch(${JSON.stringify(blocked)}).catch(() => null); return window.fixtureValue;`,
  });
  assert.equal(script.result, 'synthetic-42');
  assert.equal(await page.locator('#box').getAttribute('x'), '70');
  assert.equal(escaped, 0);
  const stale = await execute(tools, 'click', { tab_id: null, target: visible.result.elements[0].ref });
  assert.equal(stale.ok, false);
  await context.close();

  // oxlint-disable no-await-in-loop -- Each case proves retirement of its own fresh owned context.
  for (const stage of ['root', 'references']) {
    for (const mode of ['timeout', 'cancel']) {
      const heldContext = await browser.newContext({ serviceWorkers: 'block' });
      const held = createSensitiveDriver(heldContext, { url, scripts: true });
      await held.new_tab({ url });
      const [heldPage] = heldContext.pages();
      const gate = new EventTarget();
      const paused = once(gate, 'release');
      const entered = once(gate, 'entered');
      const controller = new AbortController();
      if (stage === 'root') {
        const locate = heldPage.locator.bind(heldPage);
        heldPage.locator = (...args) => {
          const locator = locate(...args);
          if (args[0] === 'html') {
            const acquire = locator.elementHandle.bind(locator);
            locator.elementHandle = async (...options) => {
              gate.dispatchEvent(new Event('entered'));
              await paused;
              return await acquire(...options);
            };
          }
          return locator;
        };
      } else {
        const invalidate = held.invalidateReferences;
        held.invalidateReferences = async () => {
          gate.dispatchEvent(new Event('entered'));
          await paused;
          await invalidate();
        };
      }
      const pending = held.run_script(
        { tab_id: null, source: 'return "done";', timeout_ms: mode === 'timeout' ? 80 : 2000 },
        { signal: controller.signal },
      );
      const settled = (async () => {
        try {
          await pending;
          return 'completed';
        } catch {
          return 'retired';
        }
      })();
      try {
        await entered;
        if (mode === 'cancel') {
          controller.abort();
        }
        const result = await Promise.race([settled, delay(500, 'still waiting for setup')]);
        assert.equal(result, 'retired', `${stage} ${mode}`);
        assert.equal(held.hasUncertainEffects(), true);
        await assert.rejects(held.state());
        await held.retire();
        assert.equal(heldPage.isClosed(), true);
      } finally {
        gate.dispatchEvent(new Event('release'));
        await settled;
        await heldContext.close();
      }
    }
  }
  for (const mode of ['ordinary', 'timeout', 'cancel']) {
    const closingContext = await browser.newContext({ serviceWorkers: 'block' });
    const closingDriver = createSensitiveDriver(closingContext, { url, scripts: true });
    await closingDriver.new_tab({ url });
    const [closingPage] = closingContext.pages();
    const nativeClose = closingContext.close.bind(closingContext);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    closingContext.close = async () => {
      entered.resolve();
      await release.promise;
      await nativeClose();
    };
    const stop = new AbortController();
    const settled = (async () => {
      try {
        await closingDriver.run_script(
          { tab_id: null, source: 'return 42;', timeout_ms: mode === 'timeout' ? 200 : 3000 },
          { signal: stop.signal },
        );
        return 'accepted';
      } catch {
        return 'retired';
      }
    })();
    try {
      await entered.promise;
      await assert.rejects(closingDriver.state());
      assert.equal(closingPage.isClosed(), false);
      if (mode === 'ordinary') {
        assert.equal(await Promise.race([settled, delay(75, 'joining')]), 'joining');
        release.resolve();
      } else if (mode === 'cancel') {
        stop.abort();
      }
      assert.equal(await Promise.race([settled, delay(750, 'blocked')]), 'retired', mode);
      release.resolve();
      await closingDriver.retire();
      assert.equal(closingPage.isClosed(), true);
    } finally {
      release.resolve();
      closingContext.close = nativeClose;
      await settled;
      await nativeClose();
    }
  }
  if (process.argv.includes('--bounded')) {
    console.log('PASS bounded sensitive origin, navigation, root/reference setup cancellation and timeout');
  } else {
    for (const value of ['42', '({a: 1})', "'é'.repeat(8193)", 'String.fromCharCode(0xd800)']) {
      const invalidContext = await browser.newContext({ serviceWorkers: 'block' });
      const invalidDriver = createSensitiveDriver(invalidContext, { url, scripts: true });
      await invalidDriver.new_tab({ url });
      const [invalidPage] = invalidContext.pages();
      const invalidTools = new BrowserToolset(invalidDriver, {
        members: ['run_script'],
        confirm: () => true,
      });
      try {
        const invalid = await execute(invalidTools, 'run_script', {
          tab_id: null,
          timeout_ms: 2000,
          source: `document.querySelector('#box').setAttribute('x','71'); return ${value};`,
        });
        assert.equal(invalid.ok, false);
      } catch (error) {
        if (error instanceof assert.AssertionError) {
          throw error;
        }
      }
      assert.equal(invalidDriver.hasUncertainEffects(), true);
      assert.equal(invalidPage.isClosed(), true);
      await assert.rejects(invalidDriver.state());
    }
    for (const mode of ['timeout', 'cancel']) {
      const heldContext = await browser.newContext({ serviceWorkers: 'block' });
      const heldDriver = createSensitiveDriver(heldContext, { url, scripts: true });
      await heldDriver.new_tab({ url });
      const heldTools = new BrowserToolset(heldDriver, { members: ['run_script'], confirm: () => true });
      const controller = new AbortController();
      const pending = execute(
        heldTools,
        'run_script',
        {
          tab_id: null,
          timeout_ms: mode === 'timeout' ? 80 : 2000,
          source: 'return await new Promise(() => {});',
        },
        controller.signal,
      );
      if (mode === 'cancel') {
        setTimeout(() => controller.abort(), 80);
      }
      await assert.rejects(pending);
      assert.equal(heldDriver.hasUncertainEffects(), true);
      await assert.rejects(heldDriver.state());
      await assert.rejects(heldDriver.new_tab({ url }));
    }
    // oxlint-enable no-await-in-loop
    console.log(
      JSON.stringify({
        success: true,
        console: 'warning',
        network: 'failed',
        sentinels: 0,
        script: 'synthetic-42',
        svg: '70',
        escaped,
        stale: true,
        retired: ['timeout', 'cancel'],
      }),
    );
  }
} finally {
  await browser.close();
  server.close();
  other.close();
  await Promise.all([once(server, 'close'), once(other, 'close')]);
}
