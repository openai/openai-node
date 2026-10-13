import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createBrowserDriver, guardBrowserContext } from './driver.mjs';

let forbiddenRequests = 0;
const forbidden = createServer((request, response) => {
  forbiddenRequests += 1;
  response.end('Must not be reached');
});
forbidden.listen(0, '127.0.0.1');
await once(forbidden, 'listening');
const deniedURL = `http://127.0.0.1:${forbidden.address().port}/denied`;
const allowedServer = createServer((request, response) => {
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: deniedURL });
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><title>Fixture</title>
    <input type="password" aria-label="Account password" value="SYNTHETIC_PASSWORD">
    <button id="first" onclick="document.body.dataset.clicked='first'">First<span hidden>HIDDEN_LABEL</span></button>
    <button id="second" data-sdk-browser-ref="r2" onclick="document.body.dataset.clicked='second'">Second</button>
    <a target="_blank" href="${deniedURL}">Popup</a>
    <a href="/redirect">Redirect</a>
    <script>window.privateFixture='HIDDEN_SCRIPT';</script>`);
});
allowedServer.listen(0, '127.0.0.1');
await once(allowedServer, 'listening');
const origin = `http://127.0.0.1:${allowedServer.address().port}`;
const allowed = (url) => new URL(url).origin === origin || url === 'about:blank';
const browser = await chromium.launch({
  headless: true,
  env: {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
  },
});
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await guardBrowserContext(context, allowed);
  const driver = createBrowserDriver(context);
  const tab = await driver.new_tab({ url: origin });
  const toolset = new BrowserToolset(driver, { confirm: () => true, urlPolicy: (_, url) => allowed(url) });
  let callId = 0;
  const execute = (name, args) => {
    callId += 1;
    return toolset.execute({
      type: 'function_call',
      status: 'completed',
      name: `browser_${name}`,
      call_id: `call_${callId}`,
      arguments: JSON.stringify(args),
    });
  };
  let guard;
  await guardBrowserContext(
    {
      async routeWebSocket(pattern) {
        assert.equal(pattern, '**');
      },
      // Playwright's route registration receives a handler.
      // oxlint-disable-next-line promise/prefer-await-to-callbacks
      async route(_pattern, callback) {
        guard = callback;
      },
    },
    () => true,
  );
  for (const [status, fail] of [
    [200, false],
    [301, false],
    [200, true],
  ]) {
    let disposed = 0;
    let fulfilled = 0;
    let aborted = 0;
    const response = {
      status: () => status,
      async dispose() {
        disposed += 1;
      },
    };
    // The three transport outcomes deliberately share one registered handler.
    // oxlint-disable-next-line no-await-in-loop
    await guard({
      request: () => ({ url: () => origin }),
      async fetch(options) {
        assert.deepEqual(options, { maxRedirects: 0, timeout: 0 });
        return response;
      },
      async fulfill(value) {
        assert.equal(value.response, response);
        fulfilled += 1;
        if (fail) {
          throw new Error('Synthetic response consumption failure');
        }
      },
      async abort() {
        aborted += 1;
      },
    });
    assert.equal(disposed, 1);
    assert.equal(fulfilled, status === 200 ? 1 : 0);
    assert.equal(aborted, status === 301 || fail ? 1 : 0);
  }
  const initialResult = await execute('find', { tab_id: tab, query: 'First' });
  const initial = JSON.parse(initialResult.output[0].text);
  assert.equal(initial.ok, true);
  assert.deepEqual(
    initial.result.elements.map((entry) => entry.label),
    ['First'],
  );
  assert.doesNotMatch(
    JSON.stringify(await execute('find', { tab_id: tab, query: 'HIDDEN_LABEL' })),
    /HIDDEN_LABEL/u,
  );
  assert.doesNotMatch(
    JSON.stringify(await execute('find', { tab_id: tab, query: 'Account password' })),
    /SYNTHETIC_PASSWORD/u,
  );
  const observed = await execute('read_page', { tab_id: tab, filter: 'all' });
  assert.doesNotMatch(JSON.stringify(observed), /SYNTHETIC_PASSWORD|HIDDEN_LABEL|HIDDEN_SCRIPT/u);
  const result = JSON.parse(observed.output[0].text);
  const { elements } = result.result;
  assert.equal(result.result.version, 1);
  const first = elements.find((entry) => entry.label === 'First').ref;
  const popup = elements.find((entry) => entry.label === 'Popup').ref;
  const redirect = elements.find((entry) => entry.label === 'Redirect').ref;
  const [page] = context.pages();
  await page.evaluate((ref) => {
    const button = document.querySelector('#first');
    const second = document.querySelector('#second');
    second.dataset.sdkBrowserRef = ref;
    button.before(second);
  }, first);
  await execute('click', { tab_id: tab, target: first });
  assert.equal(await page.locator('body').getAttribute('data-clicked'), 'first');

  await execute('click', { tab_id: tab, target: popup });
  await execute('click', { tab_id: tab, target: redirect });
  assert.equal(forbiddenRequests, 0);
  await driver.navigate({ tab_id: tab, url: origin });
  const readAgain = await execute('find', { tab_id: tab, query: 'First' });
  const next = JSON.parse(readAgain.output[0].text).result.elements.find(
    (entry) => entry.label === 'First',
  ).ref;
  assert.notEqual(next, first);
  const stale = await execute('click', { tab_id: tab, target: first });
  assert.equal(JSON.parse(stale.output[0].text).ok, false);
  assert.equal(await page.locator('body').getAttribute('data-clicked'), null);

  await page.evaluate(() => {
    const button = document.querySelector('#first');
    const replacement = button.cloneNode(true);
    replacement.removeAttribute('onclick');
    replacement.addEventListener('click', () => {
      document.body.dataset.clicked = 'replacement';
    });
    button.replaceWith(replacement);
  });
  const detached = await execute('click', { tab_id: tab, target: next });
  assert.equal(JSON.parse(detached.output[0].text).ok, false);
  assert.equal(await page.locator('body').getAttribute('data-clicked'), null);
  assert.equal(forbiddenRequests, 0);
  // These synthetic controls exceed the work and output budgets.
  await page.setContent('<main id="fixture"></main>');
  await page.evaluate(() => {
    const main = document.querySelector('#fixture');
    const text = document.createElement('p');
    text.textContent = 'Visible text '.repeat(4000);
    main.append(text);
    for (let count = 0; count < 2400; count += 1) {
      const item = document.createElement('button');
      item.textContent = `Item ${count}`;
      main.append(item);
    }
    const secret = document.createElement('input');
    secret.type = 'password';
    secret.value = 'LOCAL_PASSWORD_SENTINEL';
    main.prepend(secret);
  });
  const limitedResult = await execute('read_page', { tab_id: tab, filter: 'all' });
  const limited = JSON.parse(limitedResult.output[0].text);
  assert.equal(limited.ok, true);
  assert.equal(limited.result.version, 1);
  assert.equal(limited.result.elements.length, 100);
  for (const reason of ['target_limit', 'work_limit', 'text_limit']) {
    assert.ok(limited.result.omitted.includes(reason));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(limited.result)) <= 65_536);
  assert.doesNotMatch(JSON.stringify(limited.result), /LOCAL_PASSWORD_SENTINEL/u);
  const textOnly = await driver.get_page_text({ tab_id: tab });
  assert.equal(typeof textOnly, 'string');
  assert.ok(Buffer.byteLength(textOnly) <= 16_384);
  const found = await driver.find({ tab_id: tab, query: limited.result.elements[0].label });
  assert.ok(found.elements.some((entry) => entry.label === limited.result.elements[0].label));
  assert.ok(found.elements.every((entry) => entry.ref !== limited.result.elements[0].ref));
  await page.setContent(`
    <label for="field">Note</label><input id="field">
    <label for="choice">Service</label><select id="choice">
      <option value="standard">Standard</option><option value="express">Express</option>
    </select>`);
  const form = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  const fieldRef = form.elements.find((entry) => entry.label === 'Note').ref;
  const choiceRef = form.elements.find((entry) => entry.label === 'Service').ref;
  await driver.type({ tab_id: tab, target: fieldRef, text: 'Initial' });
  await driver.type({ tab_id: tab, target: fieldRef, text: 'Updated' });
  assert.equal(await page.locator('#field').inputValue(), 'Updated');
  await driver.select_option({ tab_id: tab, target: choiceRef, values: ['express'] });
  await driver.select_option({ tab_id: tab, target: choiceRef, values: ['standard'] });
  await driver.select_option({ tab_id: tab, target: choiceRef, values: ['express'] });
  assert.equal(await page.locator('#choice').inputValue(), 'express');
  await page.locator('option[value="standard"]').evaluate((node) => {
    node.textContent = 'Different service';
  });
  await assert.rejects(
    driver.select_option({ tab_id: tab, target: choiceRef, values: ['standard'] }),
    /stale|changed|fresh/iu,
  );
  assert.equal(await page.locator('#choice').inputValue(), 'express');
  await page.setContent('<base href="/before/"><a href="receipt">Local receipt</a>');
  const linkReport = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  const localLink = linkReport.elements[0].ref;
  await page.locator('base').evaluate((node) => {
    node.href = '/after/';
  });
  await assert.rejects(driver.click({ tab_id: tab, target: localLink }), /stale|changed|fresh/iu);
  assert.equal(page.url(), `${origin}/`);
  await page.setContent('<label for="check">Include</label><input type="checkbox" id="check">');
  const checkRead = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  const checkRef = checkRead.elements.find((item) => item.label === 'Include').ref;
  await page.locator('#check').evaluate((node) => {
    node.checked = true;
  });
  await assert.rejects(driver.click({ tab_id: tab, target: checkRef }), /stale|changed|fresh/iu);
  assert.equal(await page.locator('#check').isChecked(), true);
  const freshCheck = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  await driver.click({ tab_id: tab, target: freshCheck.elements[0].ref });
  assert.equal(await page.locator('#check').isChecked(), false);
  await page.setContent('<label for="note">Note</label><textarea id="note"></textarea>');
  await page.locator('#note').fill(`${'😺'.repeat(128)}\t`);
  const multibyteResult = await execute('read_page', { tab_id: tab, filter: 'interactive' });
  const multibyte = JSON.parse(multibyteResult.output[0].text);
  assert.equal(multibyte.ok, true);
  assert.equal(multibyte.result.elements[0].value, '😺'.repeat(128));
  assert.ok(multibyte.result.omitted.includes('value'));
  for (const [changed, selector, attribute, value] of [
    ['label', '#action', 'aria-label', 'Revised action'],
    ['role', '#action', 'role', 'switch'],
    ['disabled', '#action', 'disabled', ''],
    ['inline action', '#action', 'onclick', "document.body.dataset.effects='1'"],
    ['destination', '#link', 'href', '/updated'],
    ['private field', '#field', 'type', 'password'],
    ['readonly field', '#field', 'readonly', ''],
    ['form destination', '#form', 'action', '/updated'],
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    await page.setContent(`<form id="form"><button id="action" type="button">Action</button>
      <a id="link" href="/original">Link</a><label for="field">Note</label><input id="field"></form>`);
    // oxlint-disable-next-line no-await-in-loop
    const read = await driver.read_page({ tab_id: tab, filter: 'interactive' });
    const wanted =
      new Map([
        ['#link', 'Link'],
        ['#field', 'Note'],
      ]).get(selector) ?? 'Action';
    const target = read.elements.find((entry) => entry.label === wanted).ref;
    // oxlint-disable-next-line no-await-in-loop
    await page
      .locator(selector)
      .evaluate((node, change) => node.setAttribute(change.attribute, change.value), { attribute, value });
    const member = wanted === 'Note' ? 'type' : 'click';
    const args =
      wanted === 'Note' ? { target, tab_id: tab, text: 'Synthetic note' } : { target, tab_id: tab };
    // oxlint-disable-next-line no-await-in-loop
    const response = await execute(member, args);
    assert.equal(JSON.parse(response.output[0].text).ok, false, changed);
    // oxlint-disable-next-line no-await-in-loop
    assert.equal(await page.locator('#field').inputValue(), '');
    // oxlint-disable-next-line no-await-in-loop
    assert.equal(await page.locator('body').getAttribute('data-effects'), null);
  }
  for (const event of ['dialog', 'download']) {
    // Each failed callback must retire its own disposable context.
    // oxlint-disable-next-line no-await-in-loop
    const disposable = await browser.newContext({ serviceWorkers: 'block' });
    const owned = createBrowserDriver(disposable, { ownedFixture: { urls: [`${origin}/`] } });
    // oxlint-disable-next-line no-await-in-loop
    await owned.new_tab({ url: `${origin}/` });
    const reached = Promise.withResolvers();
    const fail = async () => {
      reached.resolve();
      throw new Error('Synthetic event transport closed');
    };
    disposable.pages()[0].emit(event, { type: () => 'alert', dismiss: fail, cancel: fail });
    // oxlint-disable-next-line no-await-in-loop
    await reached.promise;
    // Allow the registered async handler to finish, including its rejection path.
    // oxlint-disable-next-line no-await-in-loop
    await nextTurn();
    assert.equal(owned.hasUncertainEffects(), true, event);
    // oxlint-disable-next-line no-await-in-loop
    await assert.rejects(owned.state(), /retired/u);
    // oxlint-disable-next-line no-await-in-loop
    await disposable.close();
  }
  console.log(
    'Verified stale, forged and replaced refs; password and hidden text; cross-origin redirect and popup guards.',
  );
} finally {
  await browser.close();
  await promisify(allowedServer.close.bind(allowedServer))();
  await promisify(forbidden.close.bind(forbidden))();
}
