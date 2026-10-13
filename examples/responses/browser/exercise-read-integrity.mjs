import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const browser = await chromium.launch();
let checks = 0;
const observations = [];
const html =
  '<main data-record-id="a:b"><input id="allowed" type="text" aria-label="Allowed" data-browser-field="c" value="shown"><input id="other" type="text" aria-label="Other" data-browser-field="other" value="hidden"></main><main data-record-id="a"><input id="denied" type="text" aria-label="Denied" data-browser-field="b:c" value="unlisted"><input id="native-PaSsWoRd" type="PaSsWoRd"><input id="native-FiLe" type="file"><input id="native-HiDdEn" type="hidden"></main>';
const server = createServer((_request, response) =>
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html),
);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const second = `http://127.0.0.1:${server.address().port}/second`;
try {
  const context = await browser.newContext();
  await context.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const driver = createBrowserDriver(context);
  const page = await context.newPage();
  await page.goto(url);
  const state = await driver.state();
  const tab = state.tabs[0].id;
  const read = () => driver.read_page({ tab_id: tab, filter: 'all' });
  const nativeEvaluate = page.evaluateHandle.bind(page);
  let mismatch;
  const observed = { previous: null };
  page.evaluateHandle = async (...args) => {
    const scan = await nativeEvaluate(...args);
    const originalProperty = scan.getProperty.bind(scan);
    scan.getProperty = async (name) => {
      const handle = await originalProperty(name);
      if (name === 'report' && (mismatch === 'label' || mismatch === 'value')) {
        const originalValue = handle.jsonValue.bind(handle);
        handle.jsonValue = async () => {
          const report = JSON.parse(await originalValue());
          report.elements[0][mismatch] = 'Mismatched projection';
          return JSON.stringify(report);
        };
      }
      if (name === 'targets') {
        const originalProperties = handle.getProperties.bind(handle);
        handle.getProperties = async () => {
          const props = await originalProperties();
          const missingValue = mismatch === 'missing-value';
          const privateType = mismatch?.startsWith('private-') ? mismatch.slice(8) : null;
          for (const candidate of props.values()) {
            const candidateProperty = candidate.getProperty.bind(candidate);
            candidate.getProperty = async (key) => {
              const part = await candidateProperty(key);
              if (key === 'node' && !observed.previous) {
                observed.previous = part.asElement();
              }
              if (key === 'node' && privateType) {
                await part.dispose();
                return page.$(`#native-${privateType}`);
              }
              if (key === 'binding' && missingValue) {
                const original = part.jsonValue.bind(part);
                part.jsonValue = async () => {
                  const fields = await original();
                  fields.splice(20);
                  return fields;
                };
              }
              return part;
            };
          }
          return props;
        };
      }
      return handle;
    };
    return scan;
  };
  await read();
  assert.ok(observed.previous);
  const waiting = Promise.withResolvers();
  const held = Promise.withResolvers();
  const originalDispose = observed.previous.dispose.bind(observed.previous);
  observed.previous.dispose = async () => {
    waiting.resolve();
    await held.promise;
    await originalDispose();
  };
  const early = assert.rejects(read(), /changed|read again/iu);
  await waiting.promise;
  const later = await read();
  held.resolve();
  await early;
  observations.push({ case: 'generation', rejected: true });
  const live = later.elements.find((item) => item.label === 'Allowed');
  await driver.type({ tab_id: tab, target: live.ref, text: 'still fresh' });
  assert.equal(await page.locator('#allowed').inputValue(), 'still fresh');
  assert.ok(!page.isClosed());
  checks += 3;
  for (const field of [
    'label',
    'value',
    'missing-value',
    'private-PaSsWoRd',
    'private-FiLe',
    'private-HiDdEn',
  ]) {
    mismatch = field;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each read must finish before the test changes its projection.
    await assert.rejects(read(), /changed|read again/iu);
    observations.push({ case: `projection ${field}`, rejected: true });
    assert.ok(!page.isClosed());
  }
  mismatch = undefined;
  const ordinary = await read();
  const entry = ordinary.elements.find((item) => item.label === 'Allowed');
  await driver.type({ tab_id: tab, target: entry.ref, text: 'normal' });
  assert.equal(await page.locator('#allowed').inputValue(), 'normal');
  await driver.type({ tab_id: tab, target: entry.ref, text: 'same reference' });
  assert.equal(await page.locator('#allowed').inputValue(), 'same reference');
  checks += 14;
  const fullReady = Promise.withResolvers();
  const fullGate = Promise.withResolvers();
  const textReady = Promise.withResolvers();
  const textGate = Promise.withResolvers();
  page.evaluateHandle = async (...args) => {
    const scan = await nativeEvaluate(...args);
    if (args[1]?.textOnly) {
      textReady.resolve();
      await textGate.promise;
    } else {
      fullReady.resolve();
      await fullGate.promise;
    }
    return scan;
  };
  const producing = read();
  await fullReady.promise;
  const text = driver.get_page_text({ tab_id: tab });
  await textReady.promise;
  fullGate.resolve();
  const issued = await producing;
  textGate.resolve();
  assert.equal(typeof (await text), 'string');
  page.evaluateHandle = nativeEvaluate;
  const future = await read();
  const priorRefs = new Set(issued.elements.map((item) => item.ref));
  assert.ok(
    future.elements.every((item) => !priorRefs.has(item.ref)),
    'text-only read must not rewind ref counter',
  );
  observations.push({ case: 'text-only counter', unique: true });
  checks += 2;
  await page.setContent(`
    <button disabled>Unavailable</button>
    <fieldset disabled><select aria-label="Unavailable select"><option>One</option></select></fieldset>
    <input readonly aria-label="Read only" value="fixed">
    <input id="editable" aria-label="Editable" value="before">
    <select id="choice" aria-label="Current choice">
      <option value="one">One</option><option value="">Empty</option>
    </select>
  `);
  const controls = await read();
  assert.deepEqual(
    controls.elements.map((item) => item.label),
    ['Editable', 'Current choice'],
  );
  assert.ok(controls.omitted.includes('unsupported_control'));
  const choice = controls.elements.find((item) => item.label === 'Current choice');
  assert.equal(choice.value, 'one');
  await driver.select_option({ tab_id: tab, target: choice.ref, values: [''] });
  await driver.select_option({ tab_id: tab, target: choice.ref, values: ['one'] });
  assert.equal(await page.locator('#choice').inputValue(), 'one');
  await driver.select_option({ tab_id: tab, target: choice.ref, values: [''] });
  checks += 1;
  const changed = await read();
  assert.equal(changed.elements.find((item) => item.label === 'Current choice').value, '');
  const editable = changed.elements.find((item) => item.label === 'Editable');
  await page.locator('#editable').evaluate((element) => {
    element.readOnly = true;
  });
  await assert.rejects(driver.type({ tab_id: tab, target: editable.ref, text: 'must not dispatch' }));
  assert.equal(await page.locator('#editable').inputValue(), 'before');
  const refreshed = await read();
  assert.deepEqual(
    refreshed.elements.map((item) => item.label),
    ['Current choice'],
  );
  assert.ok(!page.isClosed());
  checks += 8;
  const displayed = 'Room "A" \\ north 😺';
  await page.setContent(
    '<main><p id="name"></p><input aria-label="Note" value=""><input type="PaSsWoRd" value="private"><input type="file" aria-label="Private file"><input type="hidden" value="private hidden"><input type=" password " aria-label="Invalid type" value="ordinary"></main>',
  );
  await page.locator('#name').evaluate((element, value) => {
    element.textContent = value;
  }, displayed);
  await page.locator('input[aria-label="Note"]').fill(displayed);
  const quoted = await read();
  assert.equal(quoted.text, displayed);
  assert.equal(quoted.elements[0].value, displayed);
  assert.ok(quoted.omitted.includes('private'));
  assert.deepEqual(
    quoted.elements.map((item) => item.label),
    ['Note', 'Invalid type'],
  );
  assert.equal(quoted.elements[1].value, 'ordinary');
  assert.ok(!JSON.stringify(quoted).includes('private hidden'));
  checks += 6;
  await page.setContent('<input id="ship" aria-label="Ship   order"><input aria-label="Other">');
  const spaced = await driver.find({ tab_id: tab, query: '  ship \n ORDER  ' });
  assert.deepEqual(
    spaced.elements.map((item) => item.label),
    ['Ship   order'],
  );
  await driver.type({ tab_id: tab, target: spaced.elements[0].ref, text: 'found' });
  assert.equal(await page.locator('#ship').inputValue(), 'found');
  const option = `<option value="${'v'.repeat(384)}">${'L'.repeat(128)}</option>`;
  await page.setContent(
    Array.from(
      { length: 6 },
      (_, index) => `<select aria-label="Choice ${index}">${option.repeat(24)}</select>`,
    ).join(''),
  );
  const prefix = await read();
  assert.deepEqual(
    prefix.elements.map((item) => item.label),
    ['Choice 0', 'Choice 1', 'Choice 2', 'Choice 3'],
  );
  assert.ok(prefix.omitted.includes('report_limit'));
  assert.ok(Buffer.byteLength(JSON.stringify(prefix), 'utf-8') <= 65_536);
  assert.equal(prefix.elements[0].options.length, 24);
  observations.push({
    case: 'borrowed search whitespace and report prefix',
    matched: true,
    count: prefix.elements.length,
  });
  checks += 6;
  await context.close();

  const owned = await browser.newContext();
  const grants = [
    [url, 'a:b', 'c'],
    [url, 'a', 'other'],
  ];
  const ownedDriver = createBrowserDriver(owned, {
    ownedFixture: { urls: [url, second], publicValues: grants },
  });
  const ownedPage = await owned.newPage();
  await ownedPage.goto(url);
  const report = await ownedDriver.read_page({ tab_id: null, filter: 'all' });
  const map = new Map(report.elements.map((item) => [item.label, item]));
  assert.equal(map.get('Allowed')?.value, 'shown');
  assert.equal(map.get('Denied')?.value, undefined);
  assert.equal(map.get('Other')?.value, undefined);
  await ownedPage.goto(second);
  const secondReport = await ownedDriver.read_page({ tab_id: null, filter: 'all' });
  assert.ok(secondReport.elements.every((item) => !Object.hasOwn(item, 'value')));
  checks += 4;
  await owned.close();
  // oxlint-disable eslint/no-await-in-loop -- Every case owns its two ordinary tabs and one finite native gate.
  for (const ownedCase of [false, true]) {
    for (const member of ['switch_tab', 'close_tab']) {
      const fixture = await browser.newContext();
      const observedDriver = createBrowserDriver(fixture, ownedCase ? { ownedFixture: { urls: [url] } } : {});
      const first = await fixture.newPage();
      const witness = await fixture.newPage();
      const beforeTab = await observedDriver.state();
      const selected = beforeTab.tabs[0].id;
      const cancelled = new AbortController();
      cancelled.abort(new Error('Pre-cancelled'));
      await assert.rejects(
        observedDriver[member]({ tab_id: selected }, { signal: cancelled.signal }),
        /Pre-cancelled/u,
      );
      const afterPreabort = await observedDriver.state();
      assert.equal(afterPreabort.tabs.length, 2);
      assert.ok(!first.isClosed());
      const name = member === 'switch_tab' ? 'bringToFront' : 'close';
      const native = first[name].bind(first);
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const closeEntered = Promise.withResolvers();
      const closeRelease = Promise.withResolvers();
      const closeFinished = Promise.withResolvers();
      const nativeClose = fixture.close.bind(fixture);
      fixture.close = async (...args) => {
        closeEntered.resolve();
        await closeRelease.promise;
        try {
          return await nativeClose(...args);
        } finally {
          closeFinished.resolve();
        }
      };
      first[name] = async () => {
        entered.resolve();
        await release.promise;
      };
      try {
        const controller = new AbortController();
        const pending = assert.rejects(
          observedDriver[member]({ tab_id: selected }, { signal: controller.signal }),
          /Stop tab/u,
        );
        await entered.promise;
        controller.abort(new Error('Stop tab'));
        await Promise.race([
          pending,
          delay(1500, 'teardown-blocked', { ref: false }).then((message) => {
            throw new Error(message);
          }),
        ]);
        await assert.rejects(observedDriver.state());
        assert.equal(witness.isClosed(), false);
        if (ownedCase) {
          await closeEntered.promise;
          closeRelease.resolve();
          await closeFinished.promise;
          assert.equal(witness.isClosed(), true);
        }
        release.resolve();
        await assert.rejects(observedDriver.state());
      } finally {
        release.resolve();
        closeRelease.resolve();
        first[name] = native;
        fixture.close = nativeClose;
        await nativeClose();
      }
      checks += 6;
    }
  }
  // oxlint-enable eslint/no-await-in-loop
  console.log(JSON.stringify({ checks, observations, api_calls: 0, vendor_calls: 0 }));
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
