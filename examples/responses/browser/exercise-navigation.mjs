// Disposable loopback Chromium only. From examples/: node responses/browser/exercise-navigation.mjs.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const fixture = await readFile(new URL('owned-fixture.html', import.meta.url));
const effects = [];
const hits = [];
const checks = [];
const server = createServer(async (req, res) => {
  hits.push(req.url);
  if (req.url === '/effect') {
    let body = '';
    for await (const part of req) {
      body += part;
    }
    effects.push(JSON.parse(body));
    res.end('recorded');
  } else if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/PRIVATE_UNINSTALLED?secret=one' }).end();
  } else if (['/a', '/b', '/frame'].includes(req.url)) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(fixture);
  } else {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const urls = ['/a', '/b', '/a#local', '/frame', '/effect', '/redirect'].map((path) => origin + path);
const browser = await chromium.launch({
  headless: true,
  env: {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
  },
});
async function session() {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 720 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const driver = createBrowserDriver(context, { ownedFixture: { urls } });
  const tab = await driver.new_tab({ url: `${origin}/a` });
  return { context, driver, tab, page: context.pages()[0] };
}
async function ref(driver, tab, label = 'Route') {
  const read = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  assert.equal(read.version, 1);
  const found = read.elements.find((element) => element.label === label);
  assert.ok(found, `Expected visible target ${label}`);
  return found.ref;
}
async function clickOnce(s) {
  const count = effects.length;
  await s.driver.click({ tab_id: s.tab, target: await ref(s.driver, s.tab) });
  const deadline = performance.now() + 1800;
  while (effects.length < count + 1 && performance.now() < deadline) {
    // The counter is read only after the real POST reaches the local server.
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  assert.deepEqual(effects.slice(count), [{ id: 'T-1042', action: 'route' }]);
}
async function stale(s, target) {
  const count = effects.length;
  await assert.rejects(s.driver.click({ tab_id: s.tab, target }), /stale|Unknown|changed/u);
  assert.equal(effects.length, count);
}
const deadline = setTimeout(() => {
  console.error('Navigation exercise exceeded 35 seconds.');
  void browser.close();
  server.closeAllConnections();
}, 35_000);
deadline.unref();
try {
  const s = await session();
  try {
    for (const [operation, path] of [
      [`${origin}/b`, '/b'],
      ['back', '/a'],
      ['forward', '/b'],
      ['reload', '/b'],
    ]) {
      // Each step holds a real ref from the previous document.
      // oxlint-disable-next-line no-await-in-loop
      const old = await ref(s.driver, s.tab);
      // oxlint-disable-next-line no-await-in-loop
      const result = await s.driver.navigate({ tab_id: s.tab, url: operation });
      assert.equal(
        result,
        operation.startsWith('http') ? 'Navigation checked.' : 'History navigation checked.',
      );
      assert.equal(s.page.url(), origin + path);
      // oxlint-disable-next-line no-await-in-loop
      await stale(s, old);
      // oxlint-disable-next-line no-await-in-loop
      await clickOnce(s);
    }
    checks.push('URL/back/forward/reload: old ref zero, actual fresh POST one');
    await s.driver.navigate({ tab_id: s.tab, url: `${origin}/a` });
    await s.page.evaluate(() => history.pushState({}, '', '#local'));
    const sameDocument = await ref(s.driver, s.tab);
    assert.equal(await s.driver.navigate({ tab_id: s.tab, url: 'back' }), 'History navigation checked.');
    assert.equal(s.page.url(), `${origin}/a`);
    await stale(s, sameDocument);
    await clickOnce(s);
    checks.push('same-document no-network history is validated and invalidates, not a BFCache claim');
  } finally {
    await s.context.close();
  }
  const noHistory = await session();
  try {
    const old = await ref(noHistory.driver, noHistory.tab);
    assert.equal(
      await noHistory.driver.navigate({ tab_id: noHistory.tab, url: 'forward' }),
      'History navigation checked.',
    );
    assert.equal(noHistory.page.url(), `${origin}/a`);
    await stale(noHistory, old);
    await clickOnce(noHistory);
    checks.push('empty forward history invalidates but does not claim transition');
  } finally {
    await noHistory.context.close();
  }
  const moved = await session();
  try {
    await moved.page.evaluate(() => {
      const row = document.querySelector('main');
      const shell = document.createElement('section');
      shell.id = 'panel';
      shell.style.cssText = 'height:400px;width:620px;overflow:auto;border:1px solid';
      row.before(shell);
      shell.append(row);
      const space = document.createElement('div');
      space.style.height = '1400px';
      row.append(space);
      const other = document.createElement('aside');
      other.id = 'sibling';
      other.style.cssText = 'position:absolute;left:700px;top:30px;height:160px;width:160px;overflow:auto';
      const fill = document.createElement('div');
      fill.style.height = '1000px';
      other.append(fill);
      document.body.append(other);
      window.armInputTrap();
    });
    const saved = await ref(moved.driver, moved.tab);
    const offsets = () =>
      moved.page.evaluate(() => {
        const panel = document.querySelector('#panel');
        const rect = panel.getBoundingClientRect();
        return {
          panel: panel.scrollTop,
          sibling: document.querySelector('#sibling').scrollTop,
          hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id,
          x: scrollX,
          y: scrollY,
        };
      });
    await moved.page.evaluate(() => {
      document.querySelector('#panel').scrollTop = 1000;
    });
    const before = await offsets();
    assert.ok(before.panel > 500);
    await moved.driver.scroll_to({ tab_id: moved.tab, target: saved });
    const after = await offsets();
    assert.ok(after.panel < before.panel);
    assert.deepEqual(
      { x: after.x, y: after.y, sibling: after.sibling },
      { x: before.x, y: before.y, sibling: before.sibling },
    );
    await stale(moved, saved);
    await clickOnce(moved);
    checks.push(
      'observed nested target scrolls only required chain; no trusted pointer/focus; next click needs fresh ref',
    );

    for (const refusal of [
      'forged',
      'private',
      'disabled',
      'covered-clipped',
      'inside-clipped',
      'recycle',
      'covered',
    ]) {
      // Bind each independently before the condition changes.
      // oxlint-disable-next-line no-await-in-loop
      const candidate = await ref(moved.driver, moved.tab);
      // oxlint-disable-next-line no-await-in-loop
      await moved.page.evaluate((kind) => {
        const row = document.querySelector('main');
        const button = document.querySelector('#route');
        if (kind === 'private') {
          row.dataset.browserPrivate = '';
        }
        if (kind === 'disabled') {
          button.disabled = true;
        }
        if (kind === 'recycle') {
          window.recycle();
        }
        const panel = document.querySelector('#panel');
        if (kind !== 'covered') {
          panel.scrollTop = 1000;
        }
        if (['covered', 'covered-clipped', 'inside-clipped'].includes(kind)) {
          const cover = document.createElement('div');
          const rect = (kind === 'covered' ? button : panel).getBoundingClientRect();
          cover.id = 'cover';
          cover.style.cssText = `position:fixed;z-index:999;background:white;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
          (kind === 'inside-clipped' ? panel : document.body).append(cover);
        }
      }, refusal);
      // oxlint-disable-next-line no-await-in-loop
      const was = await offsets();
      if (['covered-clipped', 'inside-clipped'].includes(refusal)) {
        assert.ok(was.panel > 500);
        assert.equal(was.hit, 'cover');
      }
      const count = effects.length;
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(
        moved.driver.scroll_to({
          tab_id: moved.tab,
          target: refusal === 'forged' ? 'foreign-ref' : candidate,
        }),
      );
      // oxlint-disable-next-line no-await-in-loop
      assert.deepEqual(await offsets(), was);
      assert.equal(effects.length, count);
      // oxlint-disable-next-line no-await-in-loop
      await moved.page.evaluate(() => {
        delete document.querySelector('main').dataset.browserPrivate;
        document.querySelector('#route').disabled = false;
        document.querySelector('#cover')?.remove();
        document.querySelector('#panel').scrollTop = 0;
      });
    }
    checks.push(
      'forged/private/disabled/recycled/covered targets, including covered clipping routes, refuse without scrolling or effects',
    );
  } finally {
    await moved.context.close();
  }
  const waiting = await session();
  try {
    const held = await ref(waiting.driver, waiting.tab);
    const wait = waiting.driver.wait_for({
      tab_id: waiting.tab,
      text: ' APPROVED\n READY ',
      timeout_ms: 1800,
    });
    await waiting.page.evaluate(() => {
      const banner = document.createElement('p');
      banner.textContent = 'Approved  ready';
      document.body.append(banner);
    });
    assert.equal(await wait, 'Visible condition met.');
    await waiting.driver.click({ tab_id: waiting.tab, target: held });
    checks.push('visible state ends one wait without issuing or destroying an unchanged ref');
  } finally {
    await waiting.context.close();
  }
  for (const text of ['PRIVATE_FIXTURE_VALUE', 'PRIVATE_HIDDEN_VALUE', 'never here']) {
    // A read that is pending at its deadline retires its disposable context.
    // oxlint-disable-next-line no-await-in-loop
    const missing = await session();
    try {
      const start = performance.now();
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(
        missing.driver.wait_for({ tab_id: missing.tab, text, timeout_ms: 100 }),
        /timed out/u,
      );
      assert.ok(performance.now() - start < 1200);
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await missing.context.close();
    }
  }
  const cancelling = await session();
  try {
    const signal = new AbortController();
    const pending = cancelling.driver.wait_for(
      { tab_id: cancelling.tab, text: 'not present', timeout_ms: 30_000 },
      { signal: signal.signal },
    );
    const failed = assert.rejects(pending);
    signal.abort(new Error('fixture stopped'));
    await failed;
  } finally {
    await cancelling.context.close();
  }
  const changing = await session();
  try {
    const change = changing.driver.wait_for({
      tab_id: changing.tab,
      text: 'page destination',
      timeout_ms: 4000,
    });
    const declined = assert.rejects(change);
    await changing.driver.invalidateReferences();
    await declined;
    checks.push('private/absent timeout bounded, AbortSignal and owner invalidation prevent later success');
  } finally {
    await changing.context.close();
  }
  for (const mode of ['deadline', 'Stop']) {
    // oxlint-disable-next-line no-await-in-loop -- Each observation owns and retires a different fixture context.
    const bounded = await session();
    // oxlint-disable-next-line no-await-in-loop
    const held = await ref(bounded.driver, bounded.tab);
    const frame = bounded.page.mainFrame();
    const locator = frame.locator.bind(frame);
    const arrived = Promise.withResolvers();
    const released = Promise.withResolvers();
    // A controlled local transport delay, not a page script or a provider call.
    frame.locator = (...args) => {
      const result = locator(...args);
      const scan = result.evaluateHandle.bind(result);
      result.evaluateHandle = async (...parameters) => {
        arrived.resolve();
        await released.promise;
        return scan(...parameters);
      };
      return result;
    };
    bounded.context.once('close', () => released.resolve());
    const limit = setTimeout(() => released.resolve(), 2000);
    const stop = new AbortController();
    const count = effects.length;
    try {
      const start = performance.now();
      const rejected = assert.rejects(
        bounded.driver.wait_for(
          { tab_id: bounded.tab, text: 'not present', timeout_ms: mode === 'deadline' ? 150 : 30_000 },
          { signal: stop.signal },
        ),
      );
      // oxlint-disable-next-line no-await-in-loop -- Stop exactly when the controlled scan starts.
      await arrived.promise;
      if (mode === 'Stop') {
        stop.abort(new Error('fixture stopped'));
      }
      // oxlint-disable-next-line no-await-in-loop
      await rejected;
      assert.ok(performance.now() - start < 1200, 'An active observation exceeded its deadline/Stop bound.');
      assert.equal(bounded.page.isClosed(), true);
      assert.equal(bounded.driver.hasUncertainEffects(), false);
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(bounded.driver.click({ tab_id: bounded.tab, target: held }));
      assert.equal(effects.length, count);
      checks.push(`stalled scan ${mode}: retired owned context, no late input or uncertain effect`);
    } finally {
      clearTimeout(limit);
      released.resolve();
      // oxlint-disable-next-line no-await-in-loop
      await bounded.context.close();
    }
  }
  const policy = await session();
  try {
    const nav = policy.driver.navigate({ tab_id: policy.tab, url: `${origin}/redirect` });
    await assert.rejects(nav);
    assert.equal(
      hits.some((url) => url.includes('PRIVATE_UNINSTALLED')),
      false,
    );
    // Dispatch may already have acted, even when Chromium retains the old URL.
    await assert.rejects(policy.driver.state(), /retired/u);
    assert.equal(policy.page.isClosed(), true);
    checks.push(
      'redirect never fetches a target or invents policy refusal; uninstalled error pages give no state',
    );
  } finally {
    await policy.context.close();
  }
  const forbidden = await session();
  try {
    await forbidden.page.evaluate(() => {
      history.pushState({}, '', '/PRIVATE_UNINSTALLED?secret=one');
      history.pushState({}, '', '/a');
    });
    await assert.rejects(forbidden.driver.navigate({ tab_id: forbidden.tab, url: 'back' }));
    assert.equal(
      hits.some((url) => url.includes('PRIVATE_UNINSTALLED')),
      false,
    );
    await assert.rejects(forbidden.driver.state());
    await assert.rejects(forbidden.driver.get_page_text({ tab_id: forbidden.tab }));
    await assert.rejects(forbidden.driver.screenshot({ tab_id: forbidden.tab }));
    checks.push('uninstalled same-document history: no text, screenshot, state or success');
  } finally {
    await forbidden.context.close();
  }
  console.log(
    JSON.stringify({
      success: true,
      checks,
      effects,
      apiRequests: 0,
      notProved: ['BFCache', 'borrowed contexts', 'hosted providers', 'hung-page elapsed deadlines'],
    }),
  );
} finally {
  clearTimeout(deadline);
  await browser.close();
  server.closeAllConnections();
  await promisify(server.close).call(server);
}
