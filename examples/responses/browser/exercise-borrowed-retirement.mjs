import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createBrowserDriver } from './driver.mjs';

// Controlled context events test the existing 100-live-page contract without opening a popup workload.
// oxlint-disable-next-line unicorn/prefer-event-target -- Match Playwright's on/emit event API.
const registry = new EventEmitter();
let closes = 0;
Object.assign(registry, {
  pages: () => [],
  route: async () => {
    /* No requests in the synthetic registry. */
  },
  routeWebSocket: async () => {
    /* No sockets in the synthetic registry. */
  },
  async close() {
    closes += 1;
    registry.emit('closed');
  },
});
const registryDriver = createBrowserDriver(registry, {
  ownedFixture: { urls: ['http://127.0.0.1/fixture'] },
});
const makePage = () => {
  // oxlint-disable-next-line unicorn/prefer-event-target -- Match Playwright's on/emit event API.
  const page = new EventEmitter();
  Object.assign(page, { isClosed: () => false, url: () => 'about:blank', title: async () => 'Fixture' });
  return page;
};
// oxlint-disable no-await-in-loop -- Each registration and close updates the same owned registry.
for (let index = 0; index < 120; index += 1) {
  const page = makePage();
  registry.emit('page', page);
  page.emit('close');
}
const empty = await registryDriver.state();
assert.equal(empty.tabs.length, 0);
for (let index = 0; index < 100; index += 1) {
  registry.emit('page', makePage());
}
const full = await registryDriver.state();
assert.equal(full.tabs.length, 100);
const closed = once(registry, 'closed');
registry.emit('page', makePage());
await closed;
await assert.rejects(registryDriver.state(), /retired/u);
assert.equal(closes, 1);
// oxlint-enable no-await-in-loop

const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
const context = await browser.newContext();
try {
  const captureContext = await browser.newContext();
  try {
    const trial = createBrowserDriver(captureContext);
    const page = await captureContext.newPage();
    await page.setContent('<title>Capture</title><button>Save</button>');
    const captureState = await trial.state();
    const [{ id }] = captureState.tabs;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const drained = Promise.withResolvers();
    const nativeCapture = page.screenshot.bind(page);
    page.screenshot = async () => {
      entered.resolve();
      await release.promise;
      try {
        return await nativeCapture();
      } finally {
        drained.resolve();
      }
    };
    const stop = new AbortController();
    const captureOutcome = async () => {
      try {
        await trial.screenshot({ tab_id: id }, { signal: stop.signal });
        return 'completed';
      } catch (error) {
        return error.name;
      }
    };
    const outcome = captureOutcome();
    try {
      await entered.promise;
      stop.abort();
      assert.equal(await Promise.race([outcome, delay(500, 'timeout')]), 'AbortError');
      await assert.rejects(trial.state(), /retired/u);
      assert.equal(page.isClosed(), false);
    } finally {
      release.resolve();
      await drained.promise;
      await outcome;
      page.screenshot = nativeCapture;
    }
    assert.equal(await page.title(), 'Capture');
    console.log(
      'PASS stalled screenshot stops promptly, retires the driver, and preserves the caller context',
    );
  } finally {
    await captureContext.close();
  }
  const findContext = await browser.newContext();
  try {
    const trial = createBrowserDriver(findContext);
    const page = await findContext.newPage();
    await page.setContent(
      `<button>Other</button><button onclick="document.body.dataset.saved='yes'">Save</button><button>Later</button>`,
    );
    const state = await trial.state();
    const [{ id }] = state.tabs;
    const before = await trial.read_page({ tab_id: id, filter: 'interactive' });
    const previous = before.elements.find((item) => item.label === 'Other').ref;
    const nativeScan = page.evaluateHandle.bind(page);
    const captured = [];
    page.evaluateHandle = async (...args) => {
      const scan = await nativeScan(...args);
      const getProperty = scan.getProperty.bind(scan);
      scan.getProperty = async (name) => {
        const found = await getProperty(name);
        if (name === 'targets') {
          const getProperties = found.getProperties.bind(found);
          found.getProperties = async () => {
            const candidates = await getProperties();
            for (const candidate of candidates.values()) {
              const property = candidate.getProperty.bind(candidate);
              candidate.getProperty = async (member) => {
                if (member === 'node') {
                  // Observe which real page controls leave the renderer for action registration.
                  captured.push(await candidate.evaluate((value) => value.item.label));
                }
                return await property(member);
              };
            }
            return candidates;
          };
        }
        return found;
      };
      return scan;
    };
    let matches;
    try {
      matches = await trial.find({ tab_id: id, query: 'sAv' });
    } finally {
      page.evaluateHandle = nativeScan;
    }
    assert.deepEqual(
      matches.elements.map((item) => item.label),
      ['Save'],
    );
    assert.deepEqual(captured, ['Save']);
    const sample = await page.$('button');
    const prototype = Object.getPrototypeOf(sample);
    await sample.dispose();
    const nativeDispose = prototype.dispose;
    const disposed = [];
    prototype.dispose = async function dispose() {
      disposed.push(await this.textContent());
      return await nativeDispose.call(this);
    };
    try {
      await assert.rejects(trial.click({ tab_id: id, target: previous }), /stale|expired|Unknown/u);
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(
        trial.click({ tab_id: id, target: matches.elements[0].ref }, { signal: aborted.signal }),
        { name: 'AbortError' },
      );
      assert.deepEqual(disposed, []);
      await trial.click({ tab_id: id, target: matches.elements[0].ref });
      assert.deepEqual(disposed, ['Save']);
      assert.equal(await page.getAttribute('body', 'data-saved'), 'yes');
    } finally {
      prototype.dispose = nativeDispose;
    }
    const fresh = await trial.read_page({ tab_id: id, filter: 'all' });
    assert.deepEqual(
      fresh.elements.map((item) => item.label),
      ['Other', 'Save', 'Later'],
    );
  } finally {
    await findContext.close();
  }
  // oxlint-disable no-await-in-loop -- Each fixture observes one completed or failed input before cleanup.
  for (const kind of ['click', 'fill', 'untargeted', 'select', 'key', 'scroll', 'hover']) {
    for (const outcome of ['failed', 'cancelled']) {
      const owned = await browser.newContext();
      try {
        const trial = createBrowserDriver(owned);
        const fixture = await owned.newPage();
        await fixture.setContent(`<button id="button">Count</button><label for="note">Note</label><input id="note">
          <label for="choice">Choice</label><select id="choice"><option>a</option><option>b</option></select>`);
        const trialState = await trial.state();
        const [{ id }] = trialState.tabs;
        const read = await trial.read_page({ tab_id: id, filter: 'interactive' });
        const noteRef = read.elements.find((item) => item.label === 'Note').ref;
        const selectRef = read.elements.find((item) => item.label === 'Choice').ref;
        const buttonRef = read.elements.find((item) => item.label === 'Count').ref;
        await fixture.locator('#note').focus();
        const stop = new AbortController();
        const handle = await fixture.$('#note');
        const methods = {
          click: [
            Object.getPrototypeOf(handle),
            'click',
            () => trial.click({ tab_id: id, target: buttonRef }, { signal: stop.signal }),
          ],
          fill: [
            Object.getPrototypeOf(handle),
            'fill',
            () => trial.type({ tab_id: id, target: noteRef, text: 'entered' }, { signal: stop.signal }),
          ],
          untargeted: [
            fixture.keyboard,
            'insertText',
            () => trial.type({ tab_id: id, target: null, text: 'entered' }, { signal: stop.signal }),
          ],
          select: [
            Object.getPrototypeOf(handle),
            'selectOption',
            () =>
              trial.select_option({ tab_id: id, target: selectRef, values: ['b'] }, { signal: stop.signal }),
          ],
          key: [
            fixture.keyboard,
            'press',
            () => trial.key({ tab_id: id, keys: ['A'] }, { signal: stop.signal }),
          ],
          scroll: [
            fixture.mouse,
            'wheel',
            () => trial.scroll({ tab_id: id, direction: 'down', amount: 100 }, { signal: stop.signal }),
          ],
          hover: [
            Object.getPrototypeOf(handle),
            'hover',
            () => trial.hover({ tab_id: id, target: buttonRef }, { signal: stop.signal }),
          ],
        };
        const [owner, member, invoke] = methods[kind];
        const native = owner[member];
        const prototype = Object.getPrototypeOf(handle);
        const nativeDispose = prototype.dispose;
        const disposed = [];
        if (kind === 'click') {
          prototype.dispose = async function dispose() {
            disposed.push(await this.getAttribute('id'));
            await nativeDispose.call(this);
            throw new Error('Synthetic Playwright remote object already closed.');
          };
        }
        let dispatched = 0;
        owner[member] = async function perform(...args) {
          await native.apply(this, args);
          dispatched += 1;
          if (outcome === 'failed') {
            throw new Error('Synthetic local transport failure after input.');
          }
          stop.abort();
        };
        try {
          await assert.rejects(invoke(), /Borrowed browser input outcome is unknown; driver retired\./u);
          await assert.rejects(trial.state(), /retired/u);
          await assert.rejects(trial.type({ tab_id: id, target: noteRef, text: 'retry' }), /retired/u);
          assert.equal(dispatched, 1, kind);
          if (kind === 'click') {
            assert.deepEqual(disposed, ['button']);
          }
        } finally {
          owner[member] = native;
          prototype.dispose = nativeDispose;
          await handle.dispose();
        }
        const callerPage = await owned.newPage();
        assert.equal(await callerPage.evaluate(() => 2 + 2), 4);
      } finally {
        await owned.close();
      }
    }
  }
  // oxlint-enable no-await-in-loop
  // Every intercepted request stays inside this local, synthetic route.
  // oxlint-disable no-await-in-loop -- Each history action owns one context and record.
  for (const [url, member] of [
    ['back', 'goBack'],
    ['forward', 'goForward'],
    ['reload', 'reload'],
    ['ordinary', 'goto'],
  ]) {
    for (const outcome of ['failed', 'cancelled']) {
      const historyContext = await browser.newContext();
      const posts = [];
      const fixtureOrigin = 'http://127.0.0.1:31337';
      const destination = url === 'ordinary' ? `${fixtureOrigin}/records` : url;
      await historyContext.route(`${fixtureOrigin}/**`, async (route) => {
        if (route.request().url() === `${fixtureOrigin}/records`) {
          posts.push(route.request().method());
        }
        await route.fulfill({
          contentType: 'text/html',
          body: '<title>History</title><button>Record</button>',
        });
      });
      try {
        const historyDriver = createBrowserDriver(historyContext);
        const fixture = await historyContext.newPage();
        await fixture.goto(`${fixtureOrigin}/form`);
        const before = await historyDriver.state();
        const ident = before.tabs[0].id;
        await assert.rejects(historyDriver.navigate({ tab_id: 'missing', url: destination }));
        await assert.rejects(
          historyDriver.navigate({ tab_id: ident, url: destination }, { signal: AbortSignal.abort() }),
        );
        if (url === 'ordinary') {
          await assert.rejects(historyDriver.navigate({ tab_id: ident, url: 'invalid absolute URL' }));
          await historyDriver.navigate({ tab_id: ident, url: `${fixtureOrigin}/permitted` });
        }
        const afterRefusal = await historyDriver.state();
        assert.equal(afterRefusal.tabs.length, 1);
        const native = fixture[member].bind(fixture);
        const stop = new AbortController();
        fixture[member] = async () => {
          await (url === 'ordinary'
            ? native(destination)
            : fixture.evaluate(async () => {
                await fetch('/records', { method: 'POST', body: 'synthetic-record' });
              }));
          if (outcome === 'failed') {
            throw new Error('Synthetic transport failure after a history resubmission');
          }
          stop.abort();
          return null;
        };
        try {
          await assert.rejects(
            historyDriver.navigate({ tab_id: ident, url: destination }, { signal: stop.signal }),
            /unknown|retired/u,
          );
          await assert.rejects(historyDriver.navigate({ tab_id: ident, url: destination }), /retired/u);
          await assert.rejects(historyDriver.state(), /retired/u);
          assert.deepEqual(posts, [url === 'ordinary' ? 'GET' : 'POST']);
        } finally {
          fixture[member] = native;
        }
        const witness = await historyContext.newPage();
        assert.equal(await witness.evaluate(() => 2 + 2), 4);
      } finally {
        await historyContext.close();
      }
    }
  }
  // oxlint-enable no-await-in-loop
  const driver = createBrowserDriver(context);
  const page = await context.newPage();
  await page.setContent(`<form onsubmit="event.preventDefault();this.dataset.saved='1'">
    <input id="submit" type="submit" value="Save form"><input type="button" value="Help">
    <input type="reset" value="Reset form"><input type="image" alt="Image action" value="PRIVATE_IMAGE_VALUE">
    <input type="submit" aria-label="Named submit" value="Not the name">
    <label for="labelled">Visible reset</label><input id="labelled" type="reset" value="Other reset">
    <input type="password" aria-label="PRIVATE_PASSWORD_LABEL" value="PRIVATE_PASSWORD_VALUE">
    <input type="file" aria-label="PRIVATE_FILE_LABEL">
  </form>`);
  const formState = await driver.state();
  const formTab = formState.tabs[0].id;
  const form = await driver.read_page({ tab_id: formTab, filter: 'interactive' });
  assert.deepEqual(
    form.elements.map(({ role, label }) => [role, label]),
    [
      ['button', 'Save form'],
      ['button', 'Help'],
      ['button', 'Reset form'],
      ['button', 'Image action'],
      ['button', 'Named submit'],
      ['button', 'Visible reset'],
    ],
  );
  assert.ok(form.elements.every((element) => !Object.hasOwn(element, 'value')));
  assert.equal(JSON.stringify(form).includes('PRIVATE_'), false);
  await page.locator('#submit').evaluate((input) => {
    input.value = 'Archive form';
  });
  await assert.rejects(driver.click({ tab_id: formTab, target: form.elements[0].ref }), /stale|document/u);
  assert.equal(await page.locator('form').getAttribute('data-saved'), null);
  const renamed = await driver.read_page({ tab_id: formTab, filter: 'interactive' });
  assert.equal(renamed.elements[0].label, 'Archive form');
  await driver.click({ tab_id: formTab, target: renamed.elements[0].ref });
  assert.equal(await page.locator('form').getAttribute('data-saved'), '1');
  await page.setContent(
    `<button onclick="document.body.dataset.count=String(Number(document.body.dataset.count||0)+1)">Count</button>
    <label for="note">Note</label><input id="note">
    <label for="service">Service</label><select id="service">
      <option value="standard">Standard</option><option value="express">Express</option></select>`,
  );
  const state = await driver.state();
  const tab_id = state.tabs[0].id;
  await driver.switch_tab({ tab_id });
  const titleTools = new BrowserToolset(driver, { members: ['read_page'] });
  // oxlint-disable no-await-in-loop -- Observe each title through the real toolset before replacing it.
  for (const [title, expected] of [
    ['Short fixture title', 'Short fixture title'],
    [`${'😺'.repeat(256)}é${'extra'.repeat(50_000)}`, '😺'.repeat(256)],
  ]) {
    await page.evaluate((value) => {
      document.title = value;
    }, title);
    const result = await titleTools.execute({
      type: 'function_call',
      status: 'completed',
      name: 'browser_read_page',
      call_id: 'title-fixture',
      arguments: JSON.stringify({ tab_id, filter: 'interactive' }),
    });
    const output = JSON.parse(result.output[0].text);
    assert.equal(output.ok, true);
    assert.equal(output.state.tabs[0].title, expected);
  }
  // oxlint-enable no-await-in-loop
  const report = await driver.read_page({ tab_id, filter: 'interactive' });
  const target = report.elements.find((item) => item.label === 'Count').ref;
  const note = report.elements.find((item) => item.label === 'Note').ref;
  const service = report.elements.find((item) => item.label === 'Service').ref;
  const refused = [];
  // oxlint-disable no-await-in-loop -- Each cancellation must retire its own independent caller-owned context.
  for (const name of ['click', 'type', 'select', 'hover']) {
    const ownedByCaller = await browser.newContext();
    const trial = createBrowserDriver(ownedByCaller);
    const checkedPage = await ownedByCaller.newPage();
    await checkedPage.setContent(await page.content());
    const trialState = await trial.state();
    const [{ id }] = trialState.tabs;
    const current = await trial.read_page({ tab_id: id, filter: 'interactive' });
    const refs = Object.fromEntries(current.elements.map((item) => [item.label, item.ref]));
    const evaluate = checkedPage.evaluate.bind(checkedPage);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const drained = Promise.withResolvers();
    const stop = new AbortController();
    checkedPage.evaluate = async (expression, data) => {
      if (!data?.checkedNode) {
        return await evaluate(expression, data);
      }
      entered.resolve();
      await release.promise;
      try {
        return await evaluate(expression, data);
      } finally {
        drained.resolve();
      }
    };
    const action = {
      click: () => trial.click({ tab_id: id, target: refs.Count }, { signal: stop.signal }),
      type: () => trial.type({ tab_id: id, target: refs.Note, text: 'cancelled' }, { signal: stop.signal }),
      select: () =>
        trial.select_option(
          { tab_id: id, target: refs.Service, values: ['express'] },
          { signal: stop.signal },
        ),
      hover: () => trial.hover({ tab_id: id, target: refs.Count }, { signal: stop.signal }),
    }[name];
    const result = (async () => {
      try {
        await action();
        return null;
      } catch (error) {
        return error;
      }
    })();
    try {
      await entered.promise;
      stop.abort();
      const outcome = await Promise.race([result, delay(1500, 'blocked')]);
      assert.notEqual(outcome, 'blocked', name);
      assert.equal(outcome.name, 'AbortError', name);
      refused.push(name);
      await assert.rejects(trial.state(), /retired/u);
      assert.equal(await checkedPage.evaluate(() => Number(document.body.dataset.count || 0)), 0);
      assert.equal(await checkedPage.locator('#note').inputValue(), '');
      assert.equal(await checkedPage.locator('#service').inputValue(), 'standard');
      const witness = await ownedByCaller.newPage();
      assert.equal(await witness.evaluate(() => 2 + 2), 4);
    } finally {
      release.resolve();
      await drained.promise;
      await result;
      await ownedByCaller.close();
    }
  }
  // oxlint-enable no-await-in-loop
  await page.locator('#note').focus();
  const alreadyStopped = AbortSignal.abort();
  try {
    await driver.type({ tab_id, target: null, text: 'cancelled untargeted' }, { signal: alreadyStopped });
  } catch (error) {
    assert.equal(error.name, 'AbortError');
    refused.push('untargeted');
  }
  const observed = {
    refused,
    clicks: await page.evaluate(() => Number(document.body.dataset.count || 0)),
    note: await page.locator('#note').inputValue(),
    service: await page.locator('#service').inputValue(),
  };
  assert.deepEqual(observed, {
    refused: ['click', 'type', 'select', 'hover', 'untargeted'],
    clicks: 0,
    note: '',
    service: 'standard',
  });
  // Independent active refs remain usable; a pre-aborted call did not retire this driver.
  await driver.type({ tab_id, target: note, text: 'accepted' });
  const values = ['express'];
  const currentScan = page.evaluate.bind(page);
  page.evaluate = async (...args) => {
    const found = await currentScan(...args);
    if (args[1]?.checkedNode) {
      values[0] = 'standard';
    }
    return found;
  };
  try {
    await driver.select_option({ tab_id, target: service, values });
  } finally {
    page.evaluate = currentScan;
  }
  assert.deepEqual(values, ['standard']);
  assert.equal(await page.locator('#note').inputValue(), 'accepted');
  assert.equal(await page.locator('#service').inputValue(), 'express');
  await Promise.all(
    ['standard', [{ label: 'Standard' }]].map((invalid) =>
      assert.rejects(driver.select_option({ tab_id, target: service, values: invalid }), /list of strings/u),
    ),
  );
  assert.equal(await page.locator('#service').inputValue(), 'express');
  await driver.select_option({ tab_id, target: service, values: ['standard'] });
  assert.equal(await page.locator('#service').inputValue(), 'standard');
  await page.locator('#note').evaluate((node) => node.remove());
  await assert.rejects(driver.type({ tab_id, target: note, text: 'removed' }), /stale|expired/u);
  console.log('PASS select captures admitted values, repeated refs work, and a missing node refuses input');
  await assert.rejects(driver.click({ tab_id, target: 'nonexistent' }));
  const afterStale = await driver.state();
  assert.equal(afterStale.tabs.length, 1);
  const handle = await page.$('button');
  const proto = Object.getPrototypeOf(handle);
  const nativeClick = proto.click;
  try {
    proto.click = async function click(...args) {
      await nativeClick.apply(this, args);
      throw new Error('Synthetic transport failure after native input');
    };
    await assert.rejects(driver.click({ tab_id, target }), /unknown|retired/u);
    await assert.rejects(driver.click({ tab_id, target }));
    await assert.rejects(driver.state());
    assert.equal(await page.evaluate(() => document.body.dataset.count), '1');
    assert.equal(await context.newPage().then((p) => p.evaluate(() => 2 + 2)), 4);
  } finally {
    proto.click = nativeClick;
    await handle.dispose();
  }
  console.log(
    JSON.stringify({ pass: true, dispatched: 1, staleReusable: true, callerContextSurvived: true }),
  );
} finally {
  await context.close();
  await browser.close();
}
