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
async function read(s, name, args) {
  return s.tools.execute({
    type: 'function_call',
    name: `browser_${name}`,
    call_id: 'call_local',
    status: 'completed',
    arguments: JSON.stringify({ tab_id: s.tab, ...args }),
  });
}
async function coords(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: Math.floor(r.left + r.width / 2), y: Math.floor(r.top + r.height / 2) };
  });
}
function bytes(part) {
  return Buffer.from(part.image_url.split(',')[1], 'base64');
}
async function state(page) {
  return page.evaluate(() => ({
    ...structuredClone(window.proof),
    visible: document.querySelector('#receipt').textContent,
  }));
}
const refused = /stale|private|busy|unknown|retired|refused|aborted/iu;

async function cancelledCapture(kind) {
  const s = await session();
  const nativeTools = ['computer', 'gesture'].includes(kind) ? await native(s) : null;
  const adapter = nativeTools?.adapter;
  let point;
  if (kind === 'gesture') {
    point = await coords(s.page, '#source');
    await adapter.screenshot();
  }
  let moves = 0;
  const originalMove = s.page.mouse.move.bind(s.page.mouse);
  s.page.mouse.move = async (...args) => {
    moves += 1;
    return originalMove(...args);
  };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const drained = Promise.withResolvers();
  const original = s.page.screenshot.bind(s.page);
  s.page.screenshot = async (...args) => {
    entered.resolve();
    await release.promise;
    try {
      return await original(...args);
    } finally {
      drained.resolve();
    }
  };
  const run = async () => {
    try {
      if (kind === 'gesture') {
        await computer(s, nativeTools.tool, [{ type: 'move', ...point }]);
      } else if (adapter) {
        await adapter.screenshot();
      } else if (kind === 'zoom') {
        await s.driver.zoom({ tab_id: s.tab, region: [0, 0, 100, 100] }, { signal: s.controller.signal });
      } else {
        await s.driver.screenshot({ tab_id: s.tab }, { signal: s.controller.signal });
      }
      return 'completed';
    } catch (error) {
      return error.name;
    }
  };
  const outcome = run();
  try {
    await entered.promise;
    s.controller.abort();
    assert.equal(await Promise.race([outcome, delay(500, 'timeout')]), 'AbortError');
    assert.equal(s.context.pages().length, 0);
    assert.equal(moves, 0);
    await assert.rejects(s.driver.state(), /retired/u);
    receipts.push(`${kind} capture stops and closes its owned context`);
  } finally {
    release.resolve();
    await drained.promise;
    await outcome;
    await s.context.close();
  }
}

async function cancelledInput(kind) {
  const s = await session();
  const n = await native(s);
  const first = await coords(s.page, '#source');
  const last = await coords(s.page, '#zone');
  await computer(s, n.tool, [shot]);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const drained = Promise.withResolvers();
  const owner = kind === 'key' ? s.page.keyboard : s.page.mouse;
  const member = kind === 'key' ? 'down' : kind;
  const original = owner[member].bind(owner);
  let calls = 0;
  owner[member] = async (...args) => {
    calls += 1;
    await original(...args);
    entered.resolve();
    await release.promise;
    drained.resolve();
  };
  const run = async () => {
    try {
      await computer(s, n.tool, [{ type: 'drag', keys: ['Shift'], path: [first, last] }]);
      return 'completed';
    } catch (error) {
      return String(error);
    }
  };
  const outcome = run();
  try {
    await Promise.race([
      entered.promise,
      delay(3000).then(() => {
        throw new Error('Input not reached');
      }),
    ]);
    s.controller.abort();
    const result = await Promise.race([outcome, delay(kind === 'up' ? 7000 : 1000, 'timeout')]);
    // The public helper prioritizes its aborted signal; the driver separately reports uncertainty.
    assert.match(result, /AbortError/u);
    assert.equal(s.driver.hasUncertainEffects(), true);
    assert.equal(s.context.pages().length, 0);
    const expected = kind === 'up' ? 2 : 1;
    assert.equal(calls, expected);
    await assert.rejects(s.driver.state(), /retired/u);
    release.resolve();
    await drained.promise;
    await delay(30);
    assert.equal(calls, expected, 'Stopped gesture must not dispatch later input');
    receipts.push({ nativeStopped: kind, unknown: true, noLaterInput: true });
  } finally {
    release.resolve();
    await outcome;
    await s.context.close();
  }
}

async function cancelledSecondClick() {
  const s = await session();
  const pointer = await s.driver.createOwnedBrowser({ record: s.record, signal: s.controller.signal });
  const point = await coords(s.page, '#source');
  await pointer.screenshot({ tab_id: s.tab });
  const checked = Promise.withResolvers();
  const allowCheck = Promise.withResolvers();
  const checkFinished = Promise.withResolvers();
  const releasing = Promise.withResolvers();
  const allowRelease = Promise.withResolvers();
  let downs = 0;
  const down = s.page.mouse.down.bind(s.page.mouse);
  s.page.mouse.down = async (...args) => {
    downs += 1;
    await down(...args);
  };
  const keyUp = s.page.keyboard.up.bind(s.page.keyboard);
  s.page.keyboard.up = async (...args) => {
    releasing.resolve();
    await allowRelease.promise;
    await keyUp(...args);
  };
  const makeHandle = s.page.evaluateHandle.bind(s.page);
  s.page.evaluateHandle = async (...args) => {
    const handle = await makeHandle(...args);
    const evaluate = handle.evaluate.bind(handle);
    handle.evaluate = async (...evalArgs) => {
      const result = await evaluate(...evalArgs);
      checked.resolve();
      await allowCheck.promise;
      checkFinished.resolve();
      return result;
    };
    return handle;
  };
  const run = async () => {
    try {
      await pointer.click_at({ tab_id: s.tab, ...point, button: 'left', click_count: 2, keys: ['Shift'] });
      return 'completed';
    } catch (error) {
      return String(error);
    }
  };
  const outcome = run();
  try {
    await checked.promise;
    s.controller.abort();
    await releasing.promise;
    assert.equal(downs, 1);
    allowCheck.resolve();
    await checkFinished.promise;
    await delay(30);
    assert.equal(downs, 1, 'Stop during double-click revalidation must not send a second mouse-down');
    assert.equal(s.context.pages().length, 1, 'Release-before-close is still in progress');
    allowRelease.resolve();
    assert.match(await outcome, /outcome is unknown/u);
    assert.equal(s.driver.hasUncertainEffects(), true);
    assert.equal(s.context.pages().length, 0);
    receipts.push('second-click check cannot dispatch during Stop cleanup');
  } finally {
    allowCheck.resolve();
    allowRelease.resolve();
    await outcome;
    await s.context.close();
  }
}

async function fixtureURLAdmission() {
  for (const url of [
    'https://fixture.invalid',
    'https://FIXTURE.invalid/',
    'https://fixture.invalid:443/',
    'https://fixture.invalid/page#section',
    'https://fixture.invalid/page#',
    'https://fixture.invalid/one/../page',
    'https://fixture.invalid/one/%2e%2e/page',
    'http://127.1/fixture',
  ]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      assert.throws(
        () => createBrowserDriver(context, { ownedFixture: { urls: [url] } }),
        /exact installed HTTP\(S\) URLs/u,
      );
      assert.equal(context.pages().length, 0);
    } finally {
      await context.close();
    }
  }
  for (const url of [
    'https://fixture.invalid/',
    'https://fixture.invalid/page',
    'https://fixture.invalid/page?q=one%20two',
  ]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      createBrowserDriver(context, {
        ownedFixture: { urls: [url], publicValues: [[url, 'record', 'field']], publicViewports: [url] },
      });
      assert.equal(context.pages().length, 0);
    } finally {
      await context.close();
    }
  }
  receipts.push('fixture URL admission preserves exact URL, field and viewport keys');
}

try {
  await fixtureURLAdmission();
  await cancelledSecondClick();
  for (const kind of ['move', 'down', 'key', 'up']) {
    await cancelledInput(kind);
  }
  for (const kind of ['browser', 'zoom', 'computer', 'gesture']) {
    await cancelledCapture(kind);
  }
  const no = await session({ pixels: false });
  assert.equal(
    no.tools.tools().some(({ name }) => name === 'browser_zoom'),
    false,
  );
  const denied = await read(no, 'screenshot', {});
  assert.match(denied.output[0].text, /"ok":false/u);
  await assert.rejects(native(no), refused);
  await no.context.close();
  receipts.push('default-empty pixel grant: screenshot/factory refused, zoom absent');

  for (const dpr of [1, 2]) {
    const s = await session({ dpr });
    try {
      const n = await native(s);
      await s.page.evaluate(() => scrollTo(79, 700));
      const zoom = await read(s, 'zoom', { region: [58, 245, 261, 354] });
      assert.match(zoom.output[0].text, /"ok":true/u);
      const png = bytes(zoom.output[1]);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [203, 109]);
      const corners = await s.page.evaluate(async (uri) => {
        const response = await fetch(uri);
        const picture = await createImageBitmap(await response.blob());
        const paint = new OffscreenCanvas(picture.width, picture.height).getContext('2d');
        paint.drawImage(picture, 0, 0);
        return [
          [0, 0],
          [202, 0],
          [0, 108],
          [202, 108],
        ].map(([x, y]) => [...paint.getImageData(x, y, 1, 1).data]);
      }, zoom.output[1].image_url);
      assert.deepEqual(corners, [
        [215, 21, 42, 255],
        [11, 97, 203, 255],
        [41, 163, 57, 255],
        [251, 181, 13, 255],
      ]);
      await assert.rejects(computer(s, n.tool, [{ type: 'move', x: 58, y: 245 }]), refused);
      receipts.push({ zoomDpr: dpr, size: [203, 109], bytes: png.length, corners, zoomDoesNotArm: true });
    } finally {
      await s.context.close();
    }
  }

  const menu = await session();
  try {
    const n = await native(menu);
    const trigger = await coords(menu.page, '#menuTrigger');
    await computer(menu, n.tool, [shot]);
    await computer(menu, n.tool, [{ type: 'move', ...trigger }]);
    let menuState = await state(menu.page);
    assert.equal(menuState.visible, 'Menu open');
    await computer(menu, n.tool, [{ type: 'click', ...trigger, button: 'left' }]);
    await computer(menu, n.tool, [{ type: 'keypress', keys: ['Enter'] }]);
    await computer(menu, n.tool, [{ type: 'keypress', keys: ['Escape'] }]);
    menuState = await state(menu.page);
    assert.deepEqual(menuState.result, ['menu']);
    await assert.rejects(computer(menu, n.tool, [{ type: 'keypress', keys: ['Enter'] }]), refused);
    await computer(menu, n.tool, [shot]);
    await computer(menu, n.tool, [{ type: 'click', x: 620, y: 125, button: 'right' }]);
    menuState = await state(menu.page);
    assert.equal(menuState.visible, 'Context open');
    const choice = await coords(menu.page, '#contextAction');
    await computer(menu, n.tool, [{ type: 'click', ...choice, button: 'left' }]);
    menuState = await state(menu.page);
    assert.deepEqual(menuState.result, ['menu', 'context']);
    receipts.push('actual native hover/left/Enter/Escape/right/choice, business result menu and context');
  } finally {
    await menu.context.close();
  }

  const drag = await session();
  try {
    const n = await native(drag);
    const start = await coords(drag.page, '#source');
    const end = await coords(drag.page, '#zone');
    const path = [start, { x: start.x + 30, y: start.y }, { x: end.x - 30, y: end.y }, end, end];
    const action = { type: 'drag', keys: ['Shift'], path };
    for (const bad of [
      { type: 'click', ...start, button: 'back' },
      { type: 'double_click', ...start, keys: null },
      { type: 'move', ...start, keys: ['Control'] },
      { type: 'drag', path: [start, { x: 900, y: 10 }] },
      { type: 'drag', path: [start] },
      { type: 'wait' },
      { type: 'type', text: 'forbidden' },
    ]) {
      await computer(drag, n.tool, [shot]);
      const before = await state(drag.page);
      await assert.rejects(computer(drag, n.tool, [bad]), refused);
      const after = await state(drag.page);
      assert.equal(after.events.length, before.events.length);
    }
    await computer(drag, n.tool, [shot]);
    await computer(drag, n.tool, [action]);
    const done = await state(drag.page);
    assert.deepEqual(done.result, ['dropped:card-A']);
    assert.ok(done.events.some(({ kind }) => kind === 'drop'));
    receipts.push({ drag: done.result, invalidBeforeAnyEvents: 7 });
  } finally {
    await drag.context.close();
  }

  for (const caseName of [
    'visible',
    'count',
    'click_count',
    'moveExtra',
    'keyExtra',
    'dragPoint',
    'hit',
    'record',
    'parent',
  ]) {
    const s = await session();
    try {
      const n = await native(s);
      const trigger = await coords(s.page, '#menuTrigger');
      await computer(s, n.tool, [shot]);
      await computer(s, n.tool, [{ type: 'click', ...trigger, button: 'left' }]);
      const choice = await coords(s.page, '#action');
      const start = await coords(s.page, '#source');
      const end = await coords(s.page, '#zone');
      if (caseName === 'hit') {
        await s.page.locator('#action').evaluate((element) => {
          element.style.opacity = '0';
        });
      }
      if (caseName === 'record') {
        await s.record.evaluate((element) => {
          element.style.opacity = '0';
        });
      }
      if (caseName === 'parent') {
        await s.page.locator('body').evaluate((element) => {
          element.style.opacity = '0';
        });
      }
      // A fresh full image does not authorize invisible current targets.
      await computer(s, n.tool, [shot]);
      let action = { type: 'click', ...choice, button: 'left' };
      if (caseName === 'count') {
        action = { ...action, count: 2 };
      }
      if (caseName === 'click_count') {
        action = { ...action, click_count: 3 };
      }
      if (caseName === 'moveExtra') {
        action = { type: 'move', ...choice, speed: 'unsupported' };
      }
      if (caseName === 'keyExtra') {
        action = { type: 'keypress', keys: ['Enter'], repeat: 3 };
      }
      if (caseName === 'dragPoint') {
        action = { type: 'drag', path: [start, { ...end, count: 3 }] };
      }
      const before = await state(s.page);
      if (caseName === 'visible') {
        await computer(s, n.tool, [action]);
        const after = await state(s.page);
        assert.deepEqual(after.result, ['menu']);
      } else {
        await assert.rejects(computer(s, n.tool, [action]), refused);
        const after = await state(s.page);
        assert.equal(after.events.length, before.events.length);
        assert.deepEqual(after.result, []);
        assert.equal(s.driver.hasUncertainEffects(), false);
        // A refused action consumed its permit even if it made no browser input.
        await assert.rejects(computer(s, n.tool, [{ type: 'move', ...start }]), refused);
      }
      receipts.push(`strict native task action: ${caseName}`);
    } finally {
      await s.context.close();
    }
  }

  const draining = await session();
  try {
    // As in owned-fixture reference tasks, the launcher constructs a fixed record before handoff.
    await draining.record.evaluate((record) => {
      record.dataset.recordId = 'fixture-drain';
    });
    const n = await native(draining);
    const trigger = await coords(draining.page, '#menuTrigger');
    await computer(draining, n.tool, [shot]);
    await computer(draining, n.tool, [{ type: 'move', ...trigger }]);
    let result = await read(draining, 'read_page', { filter: 'interactive' });
    const first = JSON.parse(result.output[0].text).result;
    const target = first.elements.find((item) => item.label === 'Select item').ref;
    // Ordinary reference confirmation remains useful before a native failure.
    result = await read(draining, 'click', { target });
    assert.match(result.output[0].text, /"ok":true/u);
    const prior = await state(draining.page);
    assert.deepEqual(prior.result, ['menu']);
    const source = await coords(draining.page, '#source');
    await computer(draining, n.tool, [shot]);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const down = draining.page.mouse.down.bind(draining.page.mouse);
    draining.page.mouse.down = async (...args) => {
      await down(...args);
      throw new Error('PRIVATE_LOST_DOWN_REPLY');
    };
    const up = draining.page.mouse.up.bind(draining.page.mouse);
    draining.page.mouse.up = async (...args) => {
      entered.resolve();
      await release.promise;
      await up(...args);
    };
    const pending = computer(draining, n.tool, [{ type: 'click', ...source, button: 'left' }]);
    const ended = assert.rejects(pending, {
      name: 'Error',
      message: 'Owned native input outcome is unknown; context retired.',
    });
    try {
      await entered.promise;
      assert.equal(draining.driver.hasUncertainEffects(), true);
      const afterDown = await state(draining.page);
      assert.ok(afterDown.events.some((event) => event.kind === 'pointerdown'));
      await assert.rejects(read(draining, 'read_page', { filter: 'interactive' }), /state/iu);
      await assert.rejects(read(draining, 'click', { target }), /state/iu);
      await assert.rejects(draining.driver.state(), refused);
      const held = await state(draining.page);
      assert.deepEqual(held.result, ['menu']);
      assert.equal(held.events.length, afterDown.events.length);
    } finally {
      release.resolve();
      await ended;
    }
    assert.equal(draining.driver.hasUncertainEffects(), true);
    receipts.push(
      'ordinary confirmed ref click works; known uncertain native down revokes BEFORE held cleanup up',
    );
  } finally {
    await draining.context.close();
  }

  // A native observation is specific to its original document/record, adapter and generation.
  for (const invalidation of [
    'read',
    'human',
    'record',
    'navigate',
    'resize',
    'browserShot',
    'otherAdapter',
  ]) {
    const s = await session();
    try {
      const n = await native(s);
      const pt = await coords(s.page, '#source');
      if (!['browserShot', 'otherAdapter'].includes(invalidation)) {
        await computer(s, n.tool, [shot]);
      }
      if (invalidation === 'read') {
        await read(s, 'read_page', { filter: 'interactive' });
      }
      if (invalidation === 'human') {
        await s.driver.invalidateReferences();
      }
      if (invalidation === 'record') {
        await s.page.locator('#record').evaluate((record) => record.replaceWith(record.cloneNode(true)));
      }
      if (invalidation === 'navigate') {
        await s.driver.navigate({ tab_id: s.tab, url: `${origin}/other` });
      }
      if (invalidation === 'resize') {
        await s.page.setViewportSize({ width: 910, height: 620 });
      }
      if (invalidation === 'browserShot') {
        await read(s, 'screenshot', {});
      }
      if (invalidation === 'otherAdapter') {
        const other = await native(s);
        await computer(s, other.tool, [shot]);
      }
      const before = await state(s.page);
      await assert.rejects(computer(s, n.tool, [{ type: 'click', ...pt, button: 'left' }]), refused);
      const after = await state(s.page);
      assert.equal(after.events.length, before.events.length);
      receipts.push(`no input: ${invalidation}`);
    } finally {
      await s.context.close();
    }
  }

  const concurrent = await session();
  try {
    const n = await native(concurrent);
    const other = await native(concurrent);
    const pt = await coords(concurrent.page, '#source');
    const trigger = await coords(concurrent.page, '#menuTrigger');
    const opener = { type: 'move', ...trigger };
    await computer(concurrent, n.tool, [shot]);
    // One call cannot borrow an intermediate native screenshot. First move may already have opened the menu.
    await assert.rejects(
      computer(concurrent, n.tool, [opener, shot, { type: 'click', ...trigger, button: 'left' }]),
      refused,
    );
    let observed = await state(concurrent.page);
    assert.equal(observed.visible, 'Menu open');
    assert.deepEqual(observed.result, []);
    await computer(concurrent, n.tool, [shot]);
    const down = concurrent.page.mouse.down.bind(concurrent.page.mouse);
    let blocked = false;
    concurrent.page.mouse.down = async (...args) => {
      await down(...args);
      await assert.rejects(computer(concurrent, other.tool, [shot]), refused);
      blocked = true;
    };
    await computer(concurrent, n.tool, [{ type: 'click', ...pt, button: 'left' }]);
    assert.equal(blocked, true);
    await assert.rejects(computer(concurrent, other.tool, [opener]), refused);
    observed = await state(concurrent.page);
    assert.deepEqual(observed.result, []);
    receipts.push(
      'one gesture per call, no arm on intermediate screenshot or concurrent capture during down',
    );
  } finally {
    await concurrent.context.close();
  }

  const approval = await session();
  try {
    const n = await native(approval);
    const target = await coords(approval.page, '#source');
    await computer(approval, n.tool, [shot]);
    const before = await state(approval.page);
    await assert.rejects(
      computer(approval, n.tool, [{ type: 'click', ...target, button: 'left' }], {
        beforeAction: async (action) => {
          if (action.type === 'click') {
            await approval.page.evaluate(() => scrollTo(0, 220));
          }
          return true;
        },
      }),
      refused,
    );
    const after = await state(approval.page);
    assert.equal(after.events.length, before.events.length);
    receipts.push('scroll during actual beforeAction approval refuses before first input');
  } finally {
    await approval.context.close();
  }

  // Capture is held after actual pixels exist. Inject forbidden post-capture material or concurrency.
  for (const kind of ['password', 'frame', 'shadow', 'budget', 'secondAdapter']) {
    const s = await session();
    try {
      const n = await native(s);
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const screenshot = s.page.screenshot.bind(s.page);
      s.page.screenshot = async (...args) => {
        const png = await screenshot(...args);
        entered.resolve();
        await release.promise;
        return png;
      };
      const capture = computer(s, n.tool, [shot]);
      // Attach immediately so intentional rejected captures cannot trigger an unhandled rejection.
      const observed = (async () => {
        try {
          return { value: await capture };
        } catch (error) {
          return { error };
        }
      })();
      await entered.promise;
      if (kind === 'secondAdapter') {
        const other = await native(s);
        await assert.rejects(computer(s, other.tool, [shot]), refused);
      } else {
        await s.page.evaluate((injected) => {
          if (injected === 'password') {
            const el = document.createElement('input');
            el.type = 'password';
            el.value = 'PRIVATE_PIXEL';
            document.body.append(el);
          }
          if (injected === 'frame') {
            document.body.append(document.createElement('iframe'));
          }
          if (injected === 'shadow') {
            const host = document.createElement('div');
            document.body.append(host);
            host.attachShadow({ mode: 'open' }).innerHTML = '<p>PRIVATE_PIXEL</p>';
          }
          if (injected === 'budget') {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < 2001; i += 1) {
              fragment.append(document.createElement('i'));
            }
            document.body.append(fragment);
          }
        }, kind);
      }
      release.resolve();
      const result = await observed;
      if (kind === 'secondAdapter') {
        assert.equal(result.value.output.type, 'computer_screenshot');
      } else {
        assert.ok(result.error);
        const pt = await coords(s.page, '#source');
        await assert.rejects(computer(s, n.tool, [{ type: 'move', ...pt }]), refused);
      }
      receipts.push(`held capture: ${kind}`);
    } finally {
      await s.context.close();
    }
  }

  for (const injected of [
    'cancel',
    'lostDown',
    'failedUp',
    'readDuringDown',
    'replace',
    'cover',
    'private',
  ]) {
    const s = await session();
    const n = await native(s);
    const start = await coords(s.page, '#source');
    const end = await coords(s.page, '#zone');
    let evidence;
    const keyUp = s.page.keyboard.up.bind(s.page.keyboard);
    s.page.keyboard.up = async (...args) => {
      await keyUp(...args);
      await s.page.mouse.move(22, 22);
      evidence = await state(s.page);
    };
    const down = s.page.mouse.down.bind(s.page.mouse);
    s.page.mouse.down = async (...args) => {
      await down(...args);
      const downState = await state(s.page);
      assert.ok(downState.events.some(({ kind }) => kind === 'pointerdown'));
      if (injected === 'cancel') {
        s.controller.abort();
      }
      if (injected === 'lostDown') {
        throw new Error('PRIVATE_LOST_REPLY');
      }
      if (injected === 'readDuringDown') {
        await read(s, 'read_page', { filter: 'interactive' });
      }
      if (injected === 'replace') {
        await s.page.locator('#record').evaluate((record) => record.replaceWith(record.cloneNode(true)));
      }
      if (injected === 'cover') {
        await s.page.evaluate(() => {
          const cover = document.createElement('div');
          Object.assign(cover.style, { position: 'fixed', inset: '0', background: 'white', zIndex: 100 });
          document.body.append(cover);
        });
      }
      if (injected === 'private') {
        await s.page.locator('#zone').evaluate((zone) => {
          zone.dataset.browserPrivate = '';
        });
      }
    };
    if (injected === 'failedUp') {
      const up = s.page.mouse.up.bind(s.page.mouse);
      s.page.mouse.up = async (...args) => {
        await up(...args);
        throw new Error('PRIVATE_UP_REPLY');
      };
    }
    try {
      await computer(s, n.tool, [shot]);
      await assert.rejects(
        computer(s, n.tool, [{ type: 'drag', keys: ['Shift'], path: [start, end, end] }]),
        (error) => {
          assert.doesNotMatch(String(error), /PRIVATE/u);
          assert.equal(error.cause, undefined);
          return refused.test(String(error));
        },
      );
      assert.equal(s.driver.hasUncertainEffects(), true);
      assert.ok(evidence.events.some(({ kind }) => kind === 'pointerdown'));
      const neutral = evidence.events.findLast(({ kind }) => kind === 'mousemove');
      assert.deepEqual({ buttons: neutral.buttons, shift: neutral.shift }, { buttons: 0, shift: false });
      if (injected !== 'failedUp') {
        assert.deepEqual(evidence.result, []);
      }
      receipts.push({ afterDown: injected, result: evidence.result, neutral: true, retired: true });
    } finally {
      await s.context.close();
    }
  }
  assert.ok(requests.every((url) => ['/pointer', '/other'].includes(url)));
  console.log(
    JSON.stringify(
      {
        kind: 'built SDK and local Chromium only; no API',
        success: true,
        chromium: browser.version(),
        receipts,
        requests,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
