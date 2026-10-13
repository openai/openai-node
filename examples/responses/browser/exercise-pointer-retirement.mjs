// One Chromium process, ordered fixture admission/effect/cleanup assertions.
// oxlint-disable no-await-in-loop
// Built SDK + isolated real Chromium, only fixed loopback fixtures. No API call or credential.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { ComputerToolset } from 'openai/helpers/computer';
import { createBrowserDriver } from './driver.mjs';

const fixture = await readFile(new URL('pointer-fixture.html', import.meta.url));
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (!['/pointer', '/other'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' }).end(fixture);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
});
const receipts = [];
const shot = { type: 'screenshot' };
async function session({ pixels = true, dpr = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 620 },
    deviceScaleFactor: dpr,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const driver = createBrowserDriver(context, {
    ownedFixture: {
      urls: [`${origin}/pointer`, `${origin}/other`],
      publicViewports: pixels ? [`${origin}/pointer`] : [],
    },
  });
  const tab = await driver.new_tab({ url: `${origin}/pointer` });
  const [page] = context.pages();
  const record = await page.locator('#record').elementHandle();
  const controller = new AbortController();
  const tools = new BrowserToolset(driver, { confirm: () => true, urlPolicy: () => true });
  return { context, driver, tab, page, record, controller, tools };
}
async function native(s) {
  const adapter = await s.driver.createOwnedComputer({ record: s.record, signal: s.controller.signal });
  return { adapter, tool: new ComputerToolset(adapter) };
}
async function computer(s, tool, actions, options = {}) {
  return tool.execute(
    {
      type: 'computer_call',
      id: 'cu_local',
      call_id: 'call_local',
      status: 'completed',
      actions,
      pending_safety_checks: [],
    },
    { signal: s.controller.signal, ...options },
  );
}
async function coords(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: Math.floor(r.left + r.width / 2), y: Math.floor(r.top + r.height / 2) };
  });
}
async function state(page) {
  return page.evaluate(() => ({
    ...structuredClone(window.proof),
    visible: document.querySelector('#receipt').textContent,
  }));
}
try {
  for (const [boundary, cancellation] of [
    ['check', 'owner'],
    ['check', 'caller'],
    ['dispose', 'owner'],
    ['dispose', 'caller'],
    ['dispose', 'none'],
  ]) {
    const s = await session();
    const pointer = await s.driver.createOwnedBrowser({ record: s.record, signal: s.controller.signal });
    const point = await coords(s.page, '#source');
    await pointer.screenshot({ tab_id: s.tab });
    const caller = new AbortController();
    const checking = Promise.withResolvers();
    const allowCheck = Promise.withResolvers();
    const disposing = Promise.withResolvers();
    const allowDispose = Promise.withResolvers();
    const disposed = Promise.withResolvers();
    const realClose = s.context.close.bind(s.context);
    const realDown = s.page.mouse.down.bind(s.page.mouse);
    const makeHandle = s.page.evaluateHandle.bind(s.page);
    let closes = 0;
    let downs = 0;
    let disposals = 0;
    s.context.close = async (...args) => {
      closes += 1;
      await realClose(...args);
    };
    s.page.mouse.down = async (...args) => {
      downs += 1;
      await realDown(...args);
    };
    s.page.evaluateHandle = async (...args) => {
      const handle = await makeHandle(...args);
      const realEvaluate = handle.evaluate.bind(handle);
      const realDispose = handle.dispose.bind(handle);
      handle.evaluate = async (...checkArgs) => {
        const accepted = await realEvaluate(...checkArgs);
        checking.resolve();
        if (boundary === 'check') {
          await allowCheck.promise;
        }
        return accepted;
      };
      handle.dispose = async () => {
        disposals += 1;
        disposing.resolve();
        await allowDispose.promise;
        try {
          await realDispose();
        } finally {
          disposed.resolve();
        }
      };
      return handle;
    };
    const active = (async () => {
      try {
        await pointer.click_at(
          { tab_id: s.tab, ...point, button: 'left', click_count: 2, keys: ['Shift'] },
          { signal: caller.signal },
        );
        return 'completed';
      } catch (error) {
        return String(error);
      }
    })();
    try {
      assert.equal(
        await Promise.race([(boundary === 'check' ? checking : disposing).promise, delay(1800, 'blocked')]),
        undefined,
        'The admitted multi-click reached its held boundary',
      );
      if (cancellation === 'none') {
        assert.equal(await Promise.race([active, delay(120, 'joining')]), 'joining');
        assert.equal(downs, 2);
        assert.equal(closes, 0);
        allowDispose.resolve();
        assert.equal(await active, 'completed');
        await s.driver.state();
        assert.equal(s.driver.hasUncertainEffects(), false);
      } else {
        (cancellation === 'owner' ? s.controller : caller).abort(new Error('Fixture multi-click Stop'));
        assert.equal(
          await Promise.race([active, delay(850, 'blocked by target cleanup')]),
          'Error: Owned native input outcome is unknown; context retired.',
        );
        assert.equal(downs, boundary === 'check' ? 1 : 2);
        assert.equal(s.driver.hasUncertainEffects(), true);
        await assert.rejects(s.driver.state(), /retired/u);
        assert.equal(closes, 1);
        allowCheck.resolve();
        allowDispose.resolve();
        await disposed.promise;
        assert.equal(downs, boundary === 'check' ? 1 : 2, 'No late input after Stop');
      }
      await disposed.promise;
      assert.equal(disposals, 1);
      receipts.push({ multiClick: boundary, cancellation, downs, closes, disposals });
    } finally {
      allowCheck.resolve();
      allowDispose.resolve();
      await active;
      await realClose();
    }
  }
  for (const boundary of ['record check', 'reference invalidation']) {
    for (const cancellation of ['owner', 'caller']) {
      const s = await session();
      const n = await native(s);
      const first = await coords(s.page, '#source');
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const live = new AbortController();
      const originalClose = s.context.close.bind(s.context);
      let closes = 0;
      let moves = 0;
      s.context.close = async (...args) => {
        closes += 1;
        await originalClose(...args);
      };
      const realMove = s.page.mouse.move.bind(s.page.mouse);
      s.page.mouse.move = async (...args) => {
        moves += 1;
        await realMove(...args);
      };
      if (boundary === 'reference invalidation') {
        // Retain one ordinary owned reference, then hold only its own cleanup method.
        await s.record.evaluate((record) => {
          record.dataset.recordId = 'fixture-pointer';
        });
        const frame = s.page.mainFrame();
        const locator = frame.locator.bind(frame);
        const html = locator('html');
        const scanPage = html.evaluateHandle.bind(html);
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
                  candidate.getProperty = async (key) => {
                    const held = await candidateProperty(key);
                    if (key === 'observation') {
                      const dispose = held.dispose.bind(held);
                      held.dispose = async () => {
                        entered.resolve();
                        await release.promise;
                        await dispose();
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
        const report = await s.driver.read_page({ tab_id: null, filter: 'interactive' });
        assert.ok(report.elements.length > 0, JSON.stringify(report));
        frame.locator = locator;
      }
      await computer(s, n.tool, [shot]);
      if (boundary === 'record check') {
        const evaluate = s.record.evaluate.bind(s.record);
        s.record.evaluate = async (...args) => {
          entered.resolve();
          await release.promise;
          return evaluate(...args);
        };
      }
      const pending = computer(s, n.tool, [{ type: 'move', ...first }], { signal: live.signal });
      const result = (async () => {
        try {
          await pending;
          return 'unexpected success';
        } catch (error) {
          return String(error);
        }
      })();
      try {
        await entered.promise;
        const reason = new Error(`Fixture ${cancellation} Stop at ${boundary}`);
        (cancellation === 'owner' ? s.controller : live).abort(reason);
        assert.equal(
          await Promise.race([result, delay(850, 'blocked')]),
          String(reason),
          `Stop retained pre-input ${boundary}`,
        );
        assert.equal(moves, 0);
        assert.equal(s.driver.hasUncertainEffects(), false);
        await assert.rejects(s.driver.state(), /retired/u);
        assert.equal(closes, 1);
        release.resolve();
        await delay(0);
        assert.equal(moves, 0, 'Late admission must not dispatch native input');
        receipts.push({ boundary, cancellation, moves, closes, uncertain: false });
      } finally {
        release.resolve();
        await result;
        await originalClose();
      }
    }
  }
  for (const [when, failClose] of [
    ['before', false],
    ['before', true],
    ['during', false],
    ['during', true],
    ['none', false],
    ['none', true],
  ]) {
    const s = await session();
    const n = await native(s);
    const first = await coords(s.page, '#source');
    const last = await coords(s.page, '#zone');
    const release = Promise.withResolvers();
    const closing = Promise.withResolvers();
    const settled = Promise.withResolvers();
    const originalClose = s.context.close.bind(s.context);
    const down = s.page.mouse.down.bind(s.page.mouse);
    let closeCalls = 0;
    let neutral;
    s.page.mouse.down = async (...args) => {
      await down(...args);
      if (when === 'before') {
        s.controller.abort(new Error('Fixture Stop after down'));
      } else {
        throw new Error('Synthetic lost input reply');
      }
    };
    s.context.close = async (...args) => {
      closeCalls += 1;
      assert.equal(s.driver.hasUncertainEffects(), true);
      await s.page.mouse.move(22, 22);
      const proof = await state(s.page);
      neutral = proof.events.findLast(({ kind }) => kind === 'mousemove');
      closing.resolve();
      await release.promise;
      try {
        await originalClose(...args);
        if (failClose) {
          throw new Error('Synthetic close failure');
        }
      } finally {
        settled.resolve();
      }
    };
    try {
      await computer(s, n.tool, [shot]);
      const pending = computer(s, n.tool, [{ type: 'drag', keys: ['Shift'], path: [first, last] }]);
      const outcome = (async () => {
        try {
          await pending;
          return 'unexpected success';
        } catch (error) {
          return String(error);
        }
      })();
      await closing.promise;
      assert.deepEqual({ buttons: neutral.buttons, shift: neutral.shift }, { buttons: 0, shift: false });
      assert.equal(closeCalls, 1);
      if (when !== 'before') {
        assert.equal(await Promise.race([outcome, delay(150, 'joining')]), 'joining');
      }
      if (when === 'during') {
        s.controller.abort(new Error('Fixture Stop after down'));
      }
      if (when === 'none') {
        release.resolve();
        assert.match(await outcome, /unknown|retired/iu);
      } else {
        assert.equal(
          await Promise.race([outcome, delay(1000, 'blocked on close')]),
          'Error: Fixture Stop after down',
        );
      }
      await assert.rejects(s.driver.state(), /retired/u);
      receipts.push({ when, failClose, neutral: true, uncertain: true, closeCalls });
    } finally {
      release.resolve();
      await settled.promise;
      await originalClose();
    }
  }
  console.log(JSON.stringify({ checks: receipts, api_calls: 0, vendor_calls: 0 }));
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
