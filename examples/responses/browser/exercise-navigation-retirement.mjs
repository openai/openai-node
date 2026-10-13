import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

let effects = 0;
const checks = [];
const server = createServer((req, res) => {
  if (req.url === '/commit') {
    effects += 1;
  }
  res
    .writeHead(200, { 'Content-Type': 'text/html' })
    .end(
      '<title>Fixture</title><p>Ready</p><div data-record-id="owned"><button id="ready">Ready</button></div>',
    );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
// oxlint-disable no-await-in-loop -- One local effect ledger; settle each context before the next.
try {
  for (const operation of ['goto', 'back', 'new_tab']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const driver = createBrowserDriver(context);
    const tab = await driver.new_tab({ url: `${origin}/a` });
    const [page] = context.pages();
    const evaluate = page.evaluateHandle.bind(page);
    let reference;
    page.evaluateHandle = async (...args) => {
      const scan = await evaluate(...args);
      const getProperty = scan.getProperty.bind(scan);
      scan.getProperty = async (name) => {
        const handle = await getProperty(name);
        if (name === 'targets') {
          const getProperties = handle.getProperties.bind(handle);
          handle.getProperties = async () => {
            const properties = await getProperties();
            for (const candidate of properties.values()) {
              const property = candidate.getProperty.bind(candidate);
              // oxlint-disable-next-line no-loop-func -- The reference is local to this context, settled before the next fixture.
              candidate.getProperty = async (key) => {
                const part = await property(key);
                if (key === 'node') {
                  reference ??= part.asElement();
                }
                return part;
              };
            }
            return properties;
          };
        }
        return handle;
      };
      return scan;
    };
    const read = await driver.read_page({ tab_id: tab, filter: 'all' });
    assert.ok(reference && read.elements.some((item) => item.label === 'Ready'));
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    const dispose = reference.dispose.bind(reference);
    reference.dispose = async () => {
      entered.resolve();
      await released.promise;
      await dispose();
    };
    const stop = new AbortController();
    const reason = new Error('Stop during reference disposal');
    // oxlint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Observe both outcomes before testing the pre-release deadline.
    const pending = (
      operation === 'new_tab'
        ? driver.new_tab({ url: `${origin}/commit` }, { signal: stop.signal })
        : driver.navigate(
            { tab_id: tab, url: operation === 'goto' ? `${origin}/commit` : operation },
            { signal: stop.signal },
          )
    ).then(
      () => ({ succeeded: true }),
      (error) => ({ error }),
    );
    // oxlint-enable promise/prefer-await-to-then, promise/prefer-await-to-callbacks
    try {
      await entered.promise;
      stop.abort(reason);
      const result = await Promise.race([pending, delay(500, { timedOut: true })]);
      assert.deepEqual(result, { error: reason }, 'Stop must settle before held disposal is released');
      assert.equal(effects, 0);
      await assert.rejects(driver.state(), /retired/u);
    } finally {
      released.resolve();
      await pending;
    }
    assert.equal(effects, 0);
    assert.equal(context.pages().length, 1);
    assert.equal(page.url(), `${origin}/a`);
    assert.equal(await page.locator('#ready').textContent(), 'Ready');
    await context.close();
    checks.push(`borrowed ${operation}: stopped before disposal, no late navigation`);
  }
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    const route = context.route.bind(context);
    context.route = async (...args) => {
      entered.resolve();
      await released.promise;
      return await route(...args);
    };
    const driver = createBrowserDriver(context, {
      ownedFixture: { urls: [`${origin}/a`, `${origin}/commit`] },
    });
    const stop = new AbortController();
    const reason = new Error('Stop during guard installation');
    // oxlint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Observe both outcomes before testing the pre-release deadline.
    const pending = driver.new_tab({ url: `${origin}/commit` }, { signal: stop.signal }).then(
      () => ({ succeeded: true }),
      (error) => ({ error }),
    );
    // oxlint-enable promise/prefer-await-to-then, promise/prefer-await-to-callbacks
    try {
      await entered.promise;
      stop.abort(reason);
      const result = await Promise.race([pending, delay(500, { timedOut: true })]);
      assert.deepEqual(result, { error: reason }, 'Stop must settle before held guards are released');
      await assert.rejects(driver.state(), /retired/u);
    } finally {
      released.resolve();
      await pending;
    }
    assert.equal(effects, 0);
    assert.equal(context.pages().length, 0);
    await context.close();
    checks.push('owned new_tab: stopped before guards, no late page');
  }
  for (const owned of [false, true]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const witness = owned ? null : await context.newPage();
    const driver = createBrowserDriver(
      context,
      owned ? { ownedFixture: { urls: [`${origin}/a`, `${origin}/commit`] } } : {},
    );
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(driver.new_tab({ url: `${origin}/commit` }, { signal: stop.signal }));
    assert.equal(effects, 0);
    const blank = await driver.new_tab({ url: null });
    assert.ok(blank);
    const before = effects;
    const start = context.newPage.bind(context);
    let created;
    context.newPage = async (...args) => {
      const page = await start(...args);
      created = page;
      const goto = page.goto.bind(page);
      page.goto = async (...nav) => {
        await goto(...nav);
        throw new Error('Synthetic failure after checked local GET');
      };
      return page;
    };
    await assert.rejects(driver.new_tab({ url: `${origin}/commit` }), /retired|unknown/u);
    assert.equal(effects, before + 1);
    assert.equal(created.isClosed(), true);
    await assert.rejects(driver.new_tab({ url: `${origin}/commit` }), /retired/u);
    assert.equal(effects, before + 1);
    if (witness) {
      assert.equal(witness.isClosed(), false);
      assert.equal(await witness.evaluate(() => 7), 7);
    } else {
      assert.deepEqual(context.pages(), []);
    }
    await context.close();
    effects = 0;
    checks.push(`new_tab ${owned ? 'owned' : 'borrowed'}: stop and failed GET`);
  }
  for (const operation of ['goto', 'back', 'forward', 'reload']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const driver = createBrowserDriver(context, {
      ownedFixture: { urls: [`${origin}/a`, `${origin}/commit`] },
    });
    const tab = await driver.new_tab({ url: `${origin}/a` });
    const [page] = context.pages();
    const stop = new AbortController();
    const url = operation === 'goto' ? `${origin}/commit` : operation;
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(driver.navigate({ tab_id: tab, url }, { signal: aborted.signal }));
    assert.equal(page.isClosed(), false);
    assert.equal(effects, 0);
    const method = { goto: 'goto', back: 'goBack', forward: 'goForward', reload: 'reload' }[operation];
    const goto = page.goto.bind(page);
    page[method] = async () => {
      const response = await goto(`${origin}/commit`);
      stop.abort();
      return response;
    };
    const closed = once(page, 'close');
    await assert.rejects(driver.navigate({ tab_id: tab, url }, { signal: stop.signal }), /retired|unknown/u);
    assert.equal(effects, 1);
    await assert.rejects(driver.state(), /retired/u);
    assert.equal(effects, 1);
    assert.equal(await Promise.race([closed.then(() => true), delay(2000, false)]), true);
    assert.equal(page.isClosed(), true);
    await context.close();
    effects = 0;
    checks.push(`owned ${operation}: preabort reusable, effect then Stop retired`);
  }
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const driver = createBrowserDriver(context, { ownedFixture: { urls: [`${origin}/a`] } });
    const tab = await driver.new_tab({ url: `${origin}/a` });
    const [page] = context.pages();
    const frame = page.mainFrame();
    const locator = frame.locator.bind(frame);
    const html = locator('html');
    const scanPage = html.evaluateHandle.bind(html);
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    let disposals = 0;
    let closes = 0;
    const close = context.close.bind(context);
    context.close = async (...args) => {
      closes += 1;
      return close(...args);
    };
    frame.locator = (selector, ...args) => (selector === 'html' ? html : locator(selector, ...args));
    html.evaluateHandle = async (...args) => {
      const scan = await scanPage(...args);
      const property = scan.getProperty.bind(scan);
      scan.getProperty = async (name) => {
        const value = await property(name);
        if (name === 'targets') {
          const properties = value.getProperties.bind(value);
          value.getProperties = async () => {
            const candidates = await properties();
            for (const candidate of candidates.values()) {
              const candidateProperty = candidate.getProperty.bind(candidate);
              // oxlint-disable-next-line no-loop-func -- Each owned handle is held until the one fixture release, before any next case.
              candidate.getProperty = async (key) => {
                const held = await candidateProperty(key);
                if (key === 'observation') {
                  const dispose = held.dispose.bind(held);
                  held.dispose = async () => {
                    disposals += 1;
                    entered.resolve();
                    await released.promise;
                    return dispose();
                  };
                }
                return held;
              };
            }
            return candidates;
          };
        }
        return value;
      };
      return scan;
    };
    const observed = await driver.read_page({ tab_id: tab, filter: 'interactive' });
    frame.locator = locator;
    const target = observed.elements.find((element) => element.label === 'Ready')?.ref;
    assert.ok(target, JSON.stringify(observed));
    const stop = new AbortController();
    const reason = new Error('Stop after applied scroll');
    // oxlint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Observe the controlled action before the finite disposal gate opens.
    const pending = driver.scroll_to({ tab_id: tab, target }, { signal: stop.signal }).then(
      () => ({ succeeded: true }),
      (error) => ({ error }),
    );
    // oxlint-enable promise/prefer-await-to-then, promise/prefer-await-to-callbacks
    try {
      assert.equal(await Promise.race([entered.promise.then(() => true), delay(1000, false)]), true);
      stop.abort(reason);
      assert.deepEqual(await Promise.race([pending, delay(500, { timedOut: true })]), { error: reason });
      assert.equal(driver.hasUncertainEffects(), true);
      await assert.rejects(driver.state(), /retired/u);
      assert.equal(closes, 1);
    } finally {
      released.resolve();
      await pending;
      await close();
    }
    assert.equal(disposals, 1);
    checks.push('owned scroll_to: applied scroll disposal observes Stop and retires after the effect');
  }
  console.log(JSON.stringify({ checks, apiCalls: 0 }));
} finally {
  await browser.close();
  server.closeAllConnections();
  // oxlint-disable-next-line promise/avoid-new -- Drain native HTTP server close callback.
  await new Promise((resolve) => {
    server.close(resolve);
  });
}
