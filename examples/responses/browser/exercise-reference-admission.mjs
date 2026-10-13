import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserToolset } from 'openai/helpers/browser';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const html =
  '<main data-record-id="form"><input aria-label="Name" data-browser-field="name" value="initial"><select aria-label="Room" data-browser-field="room"><option value="a">A</option><option value="b">B</option></select><input aria-label="Password" type="password" data-browser-field="password" value="PRIVATE_PASSWORD"><input aria-label="Upload" type="file" data-browser-field="upload"><input aria-label="Token" type="hidden" data-browser-field="token" value="PRIVATE_TOKEN"></main>';
const server = createServer((request, response) => {
  if (request.url === '/vector') {
    response
      .writeHead(200, { 'Content-Type': 'image/svg+xml' })
      .end('<svg xmlns="http://www.w3.org/2000/svg"><text>Outside HTML</text></svg>');
  } else if (request.url === '/data') {
    response
      .writeHead(200, { 'Content-Type': 'application/xml' })
      .end('<?xml-stylesheet type="text/css" href="/xml.css"?><record><name>Outside HTML</name></record>');
  } else if (request.url === '/xml.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' }).end('record, name { display: block; }');
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
function gate() {
  let release;
  // oxlint-disable-next-line promise/avoid-new -- The test owns and releases every pending transport call.
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function call(member, tab, target, value) {
  const args =
    member === 'type' ? { tab_id: tab, target, text: value } : { tab_id: tab, target, values: [value] };
  return {
    id: 'item',
    call_id: 'call',
    name: `browser_${member}`,
    type: 'function_call',
    status: 'completed',
    arguments: JSON.stringify(args),
  };
}
function ok(output) {
  return JSON.parse(output.output[0].text).ok;
}
// oxlint-disable no-await-in-loop -- Each finite fixture cleans up before the next one.
async function unsupportedRoots() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const driver = createBrowserDriver(context);
  try {
    const tab = await driver.new_tab({ url });
    const [page] = context.pages();
    for (const path of ['/vector', '/data', '/fixture']) {
      await page.goto(new URL(path, url).href);
      if (path === '/fixture') {
        await page.evaluate(() => document.body.remove());
      }
      assert.equal(await page.evaluate(() => document.body === null), true, path);
      const empty = { version: 1, text: '', elements: [], omitted: ['unsupported_root'] };
      assert.deepEqual(await driver.read_page({ tab_id: tab, filter: 'all' }), empty);
      assert.deepEqual(await driver.find({ tab_id: tab, query: 'Name' }), empty);
      assert.equal(await driver.get_page_text({ tab_id: tab }), '');
      await page.goto(url);
      const usable = await driver.read_page({ tab_id: tab, filter: 'all' });
      assert.deepEqual(
        usable.elements.map((item) => item.label),
        ['Name', 'Room'],
      );
      checks += 5;
    }
  } finally {
    await context.close();
  }
}
async function consumedClick(boundary) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const close = context.close.bind(context);
  let closes = 0;
  context.close = async (...args) => {
    closes += 1;
    await close(...args);
  };
  const driver = createBrowserDriver(context);
  const entered = gate();
  const release = gate();
  const disposed = gate();
  const stop = new AbortController();
  let clicks = 0;
  let disposals = 0;
  let pending;
  try {
    const tab = await driver.new_tab({ url });
    const [page] = context.pages();
    await page.setContent(
      '<button onclick="this.dataset.clicked=String(Number(this.dataset.clicked||0)+1)">Save</button><input aria-label="Name">',
    );
    const report = await driver.read_page({ tab_id: tab, filter: 'all' });
    const save = report.elements.find((item) => item.label === 'Save').ref;
    const name = report.elements.find((item) => item.label === 'Name').ref;
    const evaluate = page.evaluate.bind(page);
    let hooked = false;
    page.evaluate = async (fn, args) => {
      if (args?.checkedNode && !hooked) {
        hooked = true;
        const handle = args.checkedNode;
        const click = handle.click.bind(handle);
        const dispose = handle.dispose.bind(handle);
        handle.click = async (...params) => {
          clicks += 1;
          await click(...params);
          if (boundary === 'click') {
            entered.release();
            await release.promise;
          }
        };
        handle.dispose = async () => {
          disposals += 1;
          if (boundary !== 'check') {
            if (boundary !== 'click') {
              entered.release();
            }
            await release.promise;
          }
          await dispose();
          disposed.release();
        };
        if (boundary === 'check') {
          entered.release();
          await release.promise;
        }
      }
      return await evaluate(fn, args);
    };
    pending = driver.click({ tab_id: tab, target: save }, { signal: stop.signal });
    const outcome = (async () => {
      try {
        await pending;
        return 'complete';
      } catch (error) {
        return String(error);
      }
    })();
    await Promise.race([
      entered.promise,
      delay(3000, 'not reached').then((value) => {
        assert.notEqual(value, 'not reached');
      }),
    ]);
    assert.equal(await Promise.race([outcome, delay(80, 'pending')]), 'pending');
    if (boundary === 'none') {
      release.release();
      assert.equal(await outcome, 'complete');
      await assert.rejects(driver.click({ tab_id: tab, target: save }), /stale|expired|read|reference/iu);
      await driver.type({ tab_id: tab, target: name, text: 'still usable' });
      assert.equal(await page.locator('input').inputValue(), 'still usable');
    } else {
      stop.abort(new Error('Borrowed fixture stopped'));
      const result = await Promise.race([outcome, delay(1000, 'blocked on disposal')]);
      assert.match(result, boundary === 'check' ? /Borrowed fixture stopped/u : /unknown; driver retired/u);
      await assert.rejects(driver.state(), /retired/u);
    }
    assert.equal(clicks, boundary === 'check' ? 0 : 1);
    assert.equal(closes, 0);
    assert.equal(
      await page.locator('button').getAttribute('data-clicked'),
      boundary === 'check' ? null : '1',
    );
    checks += boundary === 'none' ? 7 : 6;
  } finally {
    release.release();
    await pending?.catch(() => {
      // The assertion above checks the cancellation result.
    });
    await Promise.race([
      disposed.promise,
      delay(3000, 'not disposed').then((value) => {
        assert.notEqual(value, 'not disposed');
      }),
    ]);
    assert.equal(disposals, 1);
    await close();
  }
}
try {
  await unsupportedRoots();
  for (const boundary of ['check', 'click', 'dispose', 'none']) {
    await consumedClick(boundary);
  }
  for (const owned of [false, true]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const driver = createBrowserDriver(
      context,
      owned
        ? {
            ownedFixture: {
              urls: [url],
              publicValues: ['name', 'room', 'password', 'upload', 'token'].map((field) => [
                url,
                'form',
                field,
              ]),
            },
          }
        : {},
    );
    const tab = await driver.new_tab({ url });
    const [page] = context.pages();
    try {
      const report = await driver.read_page({ tab_id: tab, filter: 'all' });
      assert.deepEqual(
        report.elements.map((item) => item.label),
        ['Name', 'Room'],
      );
      assert.doesNotMatch(JSON.stringify(report), /PRIVATE_PASSWORD|PRIVATE_TOKEN|Password|Upload|Token/u);
      checks += 2;
      if (owned) {
        // The owned action shares the same reservation; unchanged successful refs remain reusable.
        const name = report.elements.find((item) => item.label === 'Name').ref;
        const stop = new AbortController();
        stop.abort(new Error('Description stopped'));
        await assert.rejects(
          driver.describe_target({ tab_id: tab, target: name }, { signal: stop.signal }),
          /Description stopped/u,
        );
        assert.deepEqual(await driver.describe_target({ tab_id: tab, target: name }), {
          label: 'Name',
          role: 'textbox',
        });
        await driver.type({ tab_id: tab, target: name, text: 'first' });
        await driver.type({ tab_id: tab, target: name, text: 'last' });
        assert.equal(await page.locator('input').first().inputValue(), 'last');
        checks += 3;
      } else {
        for (const [member, label, first, last] of [
          ['type', 'Name', 'first', 'last'],
          ['select_option', 'Room', 'a', 'b'],
        ]) {
          const { ref } = report.elements.find((item) => item.label === label);
          const policy = { members: [member], confirm: () => true };
          const a = new BrowserToolset(driver, policy);
          const b = new BrowserToolset(driver, policy);
          const entered = gate();
          const release = gate();
          const evaluate = page.evaluate.bind(page);
          let held = false;
          page.evaluate = async (fn, args) => {
            if (args?.checkedNode && !held) {
              held = true;
              entered.release();
              await release.promise;
            }
            return await evaluate(fn, args);
          };
          const pending = a.execute(call(member, tab, ref, first));
          try {
            await entered.promise;
            assert.equal(ok(await b.execute(call(member, tab, ref, last))), false);
            checks += 1;
          } finally {
            release.release();
            await pending;
          }
          assert.equal(ok(await pending), true);
          assert.equal(ok(await b.execute(call(member, tab, ref, last))), true);
          page.evaluate = evaluate;
          checks += 2;
        }
      }
    } finally {
      await context.close();
    }
  }
  for (const when of ['during', 'none']) {
    for (const failClose of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const driver = createBrowserDriver(context, { ownedFixture: { urls: [url] } });
      const stop = new AbortController();
      const closing = gate();
      const release = gate();
      const realClose = context.close.bind(context);
      const newPage = context.newPage.bind(context);
      let closeCalls = 0;
      context.newPage = async () => {
        const page = await newPage();
        page.goto = async () => {
          throw new Error('Synthetic lost navigation reply');
        };
        return page;
      };
      context.close = async () => {
        closeCalls += 1;
        closing.release();
        await release.promise;
        await realClose();
        if (failClose) {
          throw new Error('Synthetic failed context close');
        }
      };
      const pending = driver.new_tab({ url }, { signal: stop.signal });
      const outcome = (async () => {
        try {
          await pending;
          return 'unexpected success';
        } catch (error) {
          return String(error);
        }
      })();
      try {
        await closing.promise;
        assert.equal(await Promise.race([outcome, delay(150, 'joining')]), 'joining');
        assert.equal(closeCalls, 1);
        if (when === 'during') {
          stop.abort(new Error('Fixture stopped during close'));
        } else {
          release.release();
        }
        assert.match(await Promise.race([outcome, delay(1000, 'blocked on close')]), /unknown|retired/u);
        await assert.rejects(driver.state(), /retired/u);
        checks += 4;
      } finally {
        release.release();
        await outcome;
        await realClose();
      }
    }
  }
  for (const owned of [false, true]) {
    for (const boundary of owned ? ['newPage', 'goto'] : ['newPage', 'goto', 'close', 'failedClose']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const witness = owned ? null : await context.newPage();
      const driver = createBrowserDriver(context, owned ? { ownedFixture: { urls: [url] } } : {});
      const entered = gate();
      const release = gate();
      const arrived = gate();
      const closeStarted = gate();
      const closeRelease = gate();
      let closeCalls = 0;
      const start = context.newPage.bind(context);
      const stop = new AbortController();
      let created;
      let navigations = 0;
      context.newPage = async () => {
        if (boundary === 'newPage') {
          entered.release();
          await release.promise;
        }
        created = await start();
        arrived.release();
        const goto = created.goto.bind(created);
        if (boundary === 'close' || boundary === 'failedClose') {
          const close = created.close.bind(created);
          created.close = async (...args) => {
            closeCalls += 1;
            closeStarted.release();
            await closeRelease.promise;
            await close(...args);
            if (boundary === 'failedClose') {
              throw new Error('Synthetic page close failure.');
            }
          };
        }
        created.goto = async (...args) => {
          navigations += 1;
          entered.release();
          await release.promise;
          return await goto(...args);
        };
        return created;
      };
      const pending = driver.new_tab({ url }, { signal: stop.signal });
      try {
        await entered.promise;
        stop.abort(new Error('fixture stopped'));
        const result = await Promise.race([
          pending.then(() => 'unexpected success', String),
          delay(1000, 'close blocked Stop'),
        ]);
        assert.match(result, /retired|unknown/u);
        assert.equal(navigations, boundary === 'newPage' ? 0 : 1);
        if (boundary === 'close' || boundary === 'failedClose') {
          await closeStarted.promise;
          assert.equal(closeCalls, 1);
          assert.equal(created.isClosed(), false);
          checks += 2;
        } else if (boundary === 'goto' && !created.isClosed()) {
          await created.waitForEvent('close', { timeout: 3000 });
        }
        if (witness) {
          assert.equal(await witness.evaluate(() => 7), 7);
        }
        await assert.rejects(driver.state(), /retired/u);
        checks += 4;
      } finally {
        closeRelease.release();
        release.release();
        await pending.catch(() => {
          // The assertion above checked the cancellation outcome.
        });
        // The native pending result is observed; the fixture may now settle against a closed context.
        if (!owned && boundary === 'newPage') {
          await Promise.race([
            arrived.promise,
            delay(3000).then(() => {
              throw new Error('Late page did not settle');
            }),
          ]);
          if (!created.isClosed()) {
            await created.waitForEvent('close', { timeout: 3000 });
          }
          assert.equal(context.pages().length, 1);
          checks += 1;
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
console.log(JSON.stringify({ checks, api_calls: 0, vendor_calls: 0 }));
