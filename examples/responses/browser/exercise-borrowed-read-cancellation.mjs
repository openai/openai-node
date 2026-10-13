import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

async function checkInputs(browser) {
  const checks = [];
  // oxlint-disable no-await-in-loop -- Each local context and held input is released before the next case.
  for (const kind of ['type', 'key', 'scroll']) {
    const context = await browser.newContext();
    try {
      const driver = createBrowserDriver(context);
      const page = await context.newPage();
      await page.setContent('<title>Local input</title><label>Note<input></label>');
      const {
        tabs: [{ id }],
      } = await driver.state();
      await page.locator('input').focus();
      const signal = new AbortController();
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const settled = Promise.withResolvers();
      let dispatched = 0;
      const methods = {
        type: [
          page.keyboard,
          'insertText',
          () => driver.type({ tab_id: id, target: null, text: 'hello' }, { signal: signal.signal }),
        ],
        key: [
          page.keyboard,
          'press',
          () => driver.key({ tab_id: id, keys: ['A'] }, { signal: signal.signal }),
        ],
        scroll: [
          page.mouse,
          'wheel',
          () => driver.scroll({ tab_id: id, direction: 'down', amount: 50 }, { signal: signal.signal }),
        ],
      };
      const [owner, method, invoke] = methods[kind];
      const native = owner[method].bind(owner);
      owner[method] = async (...args) => {
        dispatched += 1;
        entered.resolve();
        try {
          await release.promise;
          await native(...args);
          throw new Error('Local late input result');
        } finally {
          settled.resolve();
        }
      };
      // oxlint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Observe the dispatched input before triggering Stop.
      const result = invoke().then(
        () => 'completed',
        (error) => error.message,
      );
      // oxlint-enable promise/prefer-await-to-then, promise/prefer-await-to-callbacks
      try {
        await entered.promise;
        signal.abort();
        assert.equal(
          await Promise.race([result, delay(700, 'blocked')]),
          'Borrowed browser input outcome is unknown; driver retired.',
          kind,
        );
        assert.equal(dispatched, 1);
        await assert.rejects(driver.state(), /retired/u);
        assert.equal(page.isClosed(), false);
      } finally {
        release.resolve();
        await settled.promise;
        await result;
        owner[method] = native;
      }
      await assert.rejects(driver.state(), /retired/u);
      assert.equal(await page.title(), 'Local input');
      checks.push(`${kind}: prompt Stop, observed late input, retained caller context`);
    } finally {
      await context.close();
    }
  }
  // oxlint-enable no-await-in-loop
  return checks;
}

async function checkStringIteration(browser) {
  const context = await browser.newContext();
  try {
    const driver = createBrowserDriver(context);
    const page = await context.newPage();
    await page.setContent('<p>Iterator target é😀漢</p><button>Iterator target é😀漢</button>');
    const {
      tabs: [{ id: tab }],
    } = await driver.state();
    await page.evaluate(() => {
      const original = String.prototype[Symbol.iterator];
      window.iteratorCalls = 0;
      const label = 'Iterator target é😀漢\uD800';
      for (const element of document.querySelectorAll('p, button')) {
        element.textContent = label;
      }
      // oxlint-disable-next-line eslint/no-extend-native -- Exercise a hostile page's out-of-bounds string getter.
      Object.defineProperty(String.prototype, label.length, {
        get() {
          window.iteratorCalls += 1;
          throw new Error('Page-owned out-of-bounds string getter reached');
        },
      });
      // oxlint-disable-next-line eslint/no-extend-native -- Exercise a hostile page's own string iterator.
      String.prototype[Symbol.iterator] = function hostileIterator() {
        if (String(this).includes('Iterator target')) {
          window.iteratorCalls += 1;
          throw new Error('Page-owned string iteration reached');
        }
        return original.call(this);
      };
    });
    const read = await driver.read_page({ tab_id: tab, filter: 'all' });
    const found = await driver.find({ tab_id: tab, query: 'Iterator target' });
    const text = await driver.get_page_text({ tab_id: tab });
    for (const value of [read, found, text]) {
      assert.ok(JSON.stringify(value).includes('Iterator target é😀漢'));
    }
    assert.equal(await page.evaluate(() => window.iteratorCalls), 0);
    return 'borrowed reads preserve Unicode without invoking page-owned string iterators';
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  // oxlint-disable no-await-in-loop -- Each case settles and releases Chromium before the next case.
  try {
    checks.push(...(await checkInputs(browser)));
    if (process.argv.includes('--input-only')) {
      console.log(JSON.stringify({ checks, apiCalls: 0 }));
      return;
    }
    checks.push(await checkStringIteration(browser));
    for (const [operation, boundary] of [
      ['state', 'title'],
      ['read_page', 'scanner'],
      ['get_page_text', 'property'],
      ['find', 'disposal'],
    ]) {
      const context = await browser.newContext();
      const driver = createBrowserDriver(context);
      const page = await context.newPage();
      await page.setContent('<title>Held read</title><p>Fixture text</p><button>Save</button>');
      const observed = await driver.state();
      const tab = observed.tabs[0].id;
      const nativeRead = page.evaluateHandle.bind(page);
      let disposals = 0;
      let disposed;
      // oxlint-disable-next-line promise/avoid-new -- Track the single issued ref, not arbitrary Playwright handles.
      const refDisposed = new Promise((resolve) => {
        disposed = resolve;
      });
      if (boundary === 'title') {
        page.evaluateHandle = async (...args) => {
          const scan = await nativeRead(...args);
          const scanProperty = scan.getProperty.bind(scan);
          scan.getProperty = async (name) => {
            const value = await scanProperty(name);
            if (name === 'targets') {
              const targets = value.getProperties.bind(value);
              value.getProperties = async () => {
                const candidates = await targets();
                for (const candidate of candidates.values()) {
                  const property = candidate.getProperty.bind(candidate);
                  // oxlint-disable-next-line eslint/no-loop-func -- This block-scoped single-ref fixture settles before the next case.
                  candidate.getProperty = async (key) => {
                    const result = await property(key);
                    if (key === 'node') {
                      const dispose = result.dispose.bind(result);
                      result.dispose = async () => {
                        await dispose();
                        disposals += 1;
                        disposed();
                      };
                    }
                    return result;
                  };
                }
                return candidates;
              };
            }
            return value;
          };
          return scan;
        };
      }
      const before = await driver.read_page({ tab_id: tab, filter: 'all' });
      page.evaluateHandle = nativeRead;
      assert.ok(before.elements.some((item) => item.label === 'Save'));
      const stop = new AbortController();
      let entered;
      let release;
      // oxlint-disable-next-line promise/avoid-new -- Controlled read entry gate.
      const seen = new Promise((resolve) => {
        entered = resolve;
      });
      // oxlint-disable-next-line promise/avoid-new -- Controlled read completion gate.
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const nativeEvaluate = page.evaluate.bind(page);
      const nativeScan = page.evaluateHandle.bind(page);
      if (boundary === 'title') {
        page.evaluate = async (...args) => {
          entered();
          await gate;
          return await nativeEvaluate(...args);
        };
      } else {
        page.evaluateHandle = async (...args) => {
          const scan = await nativeScan(...args);
          if (boundary === 'scanner') {
            entered();
            await gate;
          } else if (boundary === 'property') {
            const property = scan.getProperty.bind(scan);
            scan.getProperty = async (name) => {
              if (name === 'report') {
                entered();
                await gate;
              }
              return await property(name);
            };
          } else {
            const dispose = scan.dispose.bind(scan);
            scan.dispose = async () => {
              entered();
              await gate;
              return await dispose();
            };
          }
          return scan;
        };
      }
      const options = { signal: stop.signal };
      const args = { tab_id: tab, filter: 'all', query: 'Save' };
      const operationPromise =
        operation === 'state' ? driver.state(options) : driver[operation](args, options);
      // oxlint-disable-next-line promise/prefer-await-to-then -- Observe rejection before triggering Stop.
      const outcome = operationPromise.then(
        () => 'resolved',
        () => 'cancelled',
      );
      try {
        await seen;
        stop.abort();
        assert.equal(await Promise.race([outcome, delay(500, 'blocked')]), 'cancelled', boundary);
        await assert.rejects(driver.state(), /retired/u);
        // A provider owns its context; an ordinary caller's page must survive Stop.
        assert.equal(page.isClosed(), false);
        if (boundary === 'title') {
          assert.equal(
            await Promise.race([refDisposed.then(() => 'disposed'), delay(500, 'blocked')]),
            'disposed',
          );
          assert.equal(disposals, 1);
        }
      } finally {
        release();
        page.evaluate = nativeEvaluate;
        page.evaluateHandle = nativeScan;
      }
      await outcome;
      await delay(30);
      await assert.rejects(driver.state(), /retired/u);
      assert.equal(await page.evaluate(() => document.querySelector('button').textContent), 'Save');
      await context.close();
      checks.push(`${operation} held at ${boundary}: promptly retired, caller retains context`);
    }
    for (const event of ['dialog', 'download']) {
      const context = await browser.newContext();
      const caller = await browser.newContext();
      const callerPage = await caller.newPage();
      const driver = createBrowserDriver(context, { ownedFixture: { urls: ['https://fixture.invalid/'] } });
      const page = await context.newPage();
      let settled = 0;
      const confirm = async () => {
        settled += 1;
      };
      const successful =
        event === 'dialog' ? { type: () => 'confirm', dismiss: confirm } : { cancel: confirm };
      for (const handle of page.listeners(event)) {
        await handle(successful);
      }
      assert.equal(settled, 1);
      const observed = await driver.state();
      assert.ok(
        observed.observation.changes.some(
          (change) => change.type === (event === 'dialog' ? 'dialog_dismissed' : 'download'),
        ),
      );
      const failure = async () => {
        throw new Error(`Fixture ${event} cleanup failed`);
      };
      const uncertain =
        event === 'dialog' ? { type: () => 'confirm', dismiss: failure } : { cancel: failure };
      for (const handle of page.listeners(event)) {
        await handle(uncertain);
      }
      assert.equal(page.isClosed(), true);
      assert.equal(callerPage.isClosed(), false);
      await assert.rejects(driver.state(), /retired/u);
      await caller.close();
      await context.close();
      checks.push(
        `owned ${event}: success reported, unconfirmed cleanup retires and closes only owned context`,
      );
    }
    for (const operation of ['state', 'read_page', 'get_page_text', 'find', 'read_page_scoped']) {
      const context = await browser.newContext();
      const driver = createBrowserDriver(context, {
        ownedFixture: { urls: ['http://127.0.0.1:39851/fixture'] },
      });
      const tab = await driver.new_tab({ url: null });
      const [page] = context.pages();
      await page.setContent(
        '<title>Owned</title><p>Visible text</p><div data-record-id="record"><button>Save</button></div>',
      );
      const before = await driver.read_page({ tab_id: tab, filter: 'all' });
      assert.ok(before.elements.some((item) => item.label === 'Save'));
      const stop = new AbortController();
      const preAborted = new AbortController();
      preAborted.abort();
      await assert.rejects(driver.state({ signal: preAborted.signal }), { name: 'AbortError' });
      assert.equal(page.isClosed(), false);
      const closed = Promise.withResolvers();
      context.once('close', closed.resolve);
      let entered;
      let release;
      // oxlint-disable-next-line promise/avoid-new -- Controlled renderer read entry.
      const seen = new Promise((resolve) => {
        entered = resolve;
      });
      // oxlint-disable-next-line promise/avoid-new -- Controlled renderer read completion.
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const nativeTitle = page.title.bind(page);
      const frame = page.mainFrame();
      const nativeLocator = frame.locator.bind(frame);
      if (operation === 'state') {
        page.title = async () => {
          entered();
          await gate;
          return await nativeTitle();
        };
      } else {
        frame.locator = (...args) => {
          const locator = nativeLocator(...args);
          const nativeScan = locator.evaluateHandle.bind(locator);
          locator.evaluateHandle = async (...scanArgs) => {
            entered();
            await gate;
            return await nativeScan(...scanArgs);
          };
          return locator;
        };
      }
      const args = { tab_id: tab, filter: 'all', query: 'Save', root: null, depth: 1 };
      const pending =
        operation === 'state'
          ? driver.state({ signal: stop.signal })
          : driver[operation](args, { signal: stop.signal });
      // oxlint-disable-next-line promise/prefer-await-to-then -- Observe rejection before Stop.
      const outcome = pending.then(
        () => 'resolved',
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Attach rejection before abort so it is never unhandled.
        (error) => error.name,
      );
      try {
        await seen;
        stop.abort();
        assert.equal(await Promise.race([outcome, delay(700, 'blocked')]), 'AbortError', operation);
        await assert.rejects(driver.state(), /retired/u);
        assert.notEqual(await Promise.race([closed.promise, delay(3000, 'blocked')]), 'blocked');
        assert.equal(page.isClosed(), true);
      } finally {
        release();
        frame.locator = nativeLocator;
        page.title = nativeTitle;
      }
      await delay(30);
      await assert.rejects(driver.state(), /retired/u);
      checks.push(
        `owned ${operation}: stopped read closes only delegated context; late read cannot restore refs`,
      );
    }
    for (const [title, expected] of [
      ['😺'.repeat(400), '😺'.repeat(256)],
      [`${'x'.repeat(1023)}😺`, 'x'.repeat(1023)],
    ]) {
      const context = await browser.newContext();
      const driver = createBrowserDriver(context);
      const page = await context.newPage();
      await page.setContent('<p>Title fixture</p><button>Save</button>');
      await page.evaluate((value) => {
        document.title = value;
      }, title);
      const state = await driver.state();
      assert.equal(state.tabs[0].title, expected);
      assert.ok(Buffer.byteLength(state.tabs[0].title) <= 1024);
      await context.close();
      checks.push('borrowed normal multibyte title is bounded without split character');
    }
    for (const kind of ['text', 'report']) {
      const context = await browser.newContext();
      const driver = createBrowserDriver(context);
      const page = await context.newPage();
      await page.setContent('<p>Visible</p><button>Save</button>');
      const {
        tabs: [{ id: tab }],
      } = await driver.state();
      const before = await driver.read_page({ tab_id: tab, filter: 'all' });
      const { ref } = before.elements.find((item) => item.label === 'Save');
      const original = page.evaluateHandle.bind(page);
      const properties = [];
      page.evaluateHandle = async () => {
        const handle = await original(
          (value) => ({
            report: {
              version: 1,
              text: value === 'text' ? 'z'.repeat(16_385) : '',
              elements: [],
              omitted: [],
              ...(value === 'report' ? { extra: 'z'.repeat(65_537) } : {}),
            },
            targets: [],
            nextRef: 1000,
          }),
          kind,
        );
        const read = handle.getProperty.bind(handle);
        handle.getProperty = (name) => {
          properties.push(name);
          return read(name);
        };
        return handle;
      };
      try {
        await assert.rejects(driver.read_page({ tab_id: tab, filter: 'all' }), /report budget/u);
        assert.deepEqual(properties, ['report']);
      } finally {
        page.evaluateHandle = original;
      }
      await assert.rejects(driver.click({ tab_id: tab, target: ref }), /stale|expired|Unknown/u);
      assert.equal(page.isClosed(), false);
      const after = await driver.read_page({ tab_id: tab, filter: 'all' });
      assert.ok(after.elements.some((item) => item.label === 'Save'));
      await context.close();
      checks.push(`borrowed ${kind} over budget rejected before target capture, fresh read usable`);
    }
    console.log(JSON.stringify({ checks, apiCalls: 0 }));
  } finally {
    await browser.close();
  }
}

await main();
