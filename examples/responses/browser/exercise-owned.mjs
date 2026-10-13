// Real Chromium and local server oracle; no API requests or customer pages.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { createBrowserDriver } from './driver.mjs';

const fixture = await readFile(new URL('owned-fixture.html', import.meta.url));
const richFixture = await readFile(new URL('rich-child.html', import.meta.url));
const effects = [];
const requests = [];
const server = createServer(async (request, response) => {
  requests.push(request.url);
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: '/PRIVATE_REDIRECT?token=PRIVATE_QUERY' }).end();
    return;
  }
  if (request.url === '/attachment') {
    response
      .writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="PRIVATE_FILENAME.txt"',
        'X-Fixture-Private': 'PRIVATE_HEADER',
      })
      .end('PRIVATE_FILE_BYTES');
    return;
  }
  if (request.url === '/failed') {
    request.socket.destroy();
    return;
  }
  if (request.url === '/effect' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    effects.push(JSON.parse(body));
    response.end('recorded');
    return;
  }
  if (request.url === '/rich-child') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(richFixture);
    return;
  }
  if (!['/fixture', '/other', '/frame'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(fixture);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const urls = [
  '/fixture',
  '/other',
  '/frame',
  '/rich-child',
  '/effect',
  '/redirect',
  '/attachment',
  '/failed',
].map((path) => origin + path);
// A separately named, launcher-owned loopback origin for the inaccessible
// frame boundary. Both URLs reach the same disposable local fixture server.
const otherOrigin = `http://localhost:${server.address().port}`;
urls.push(`${otherOrigin}/rich-child`, `${otherOrigin}/frame`, `${otherOrigin}/effect`);
const browser = await chromium.launch({
  headless: true,
  env: {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
  },
});
const receipts = [];
async function session(publicValues = []) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 720 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const driver = createBrowserDriver(context, { ownedFixture: { urls, publicValues } });
  const tab = await driver.new_tab({ url: `${origin}/fixture` });
  return { context, driver, tab, page: context.pages()[0] };
}
async function read(driver, tab) {
  const value = await driver.read_page({ tab_id: tab, filter: 'interactive' });
  assert.equal(value.version, 1);
  return {
    ...value,
    ref: (label) => {
      const entry = value.elements.find((item) => item.label === label);
      assert.ok(entry, `Expected issued ref for ${label}`);
      return entry.ref;
    },
  };
}
async function waitEffects(length) {
  const deadline = Date.now() + 1800;
  while (effects.length < length && Date.now() < deadline) {
    // Wait for the independent server oracle before checking the recorded ID.
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  assert.equal(effects.length, length);
}
async function execute(toolset, member, args) {
  const output = await toolset.execute({
    type: 'function_call',
    status: 'completed',
    name: `browser_${member}`,
    arguments: JSON.stringify(args),
    call_id: 'owned-events',
  });
  return JSON.parse(output.output[0].text);
}
function changesOf(state, type) {
  return state.observation.changes.filter((change) => change.type === type);
}
async function waitChange(driver, type, after) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    // The browser may acknowledge dialog dismissal or download cancellation after the page resumes.
    // oxlint-disable-next-line no-await-in-loop
    const state = await driver.state();
    if (changesOf(state, type).some((change) => change.sequence > after)) {
      return state;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  assert.fail(`Browser did not report ${type}`);
}
function fixtureCall(name, call_id, args) {
  return {
    type: 'function_call',
    id: `fc_${call_id}`,
    call_id,
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
  };
}
async function dateFeedback() {
  const { context, driver, tab, page } = await session();
  try {
    await page.evaluate(() => {
      document.body.innerHTML = `<section id="row" data-record-id="fixture_date">
        <label>Date<input id="date" type="date" name="date"></label>
        <label>Note<textarea id="note" name="note"></textarea></label></section>`;
      window.dateEvents = [];
      for (const name of ['input', 'change']) {
        document.addEventListener(name, (event) => window.dateEvents.push([event.type, event.target.id]));
      }
    });
    const toolset = new BrowserToolset(driver, { members: ['type'], confirm: () => true });
    const snapshot = () =>
      page.evaluate(() => ({ date: date.value, note: note.value, events: [...window.dateEvents] }));
    const refs = await read(driver, tab);
    const before = await snapshot();
    const bad = await execute(toolset, 'type', { tab_id: tab, target: refs.ref('Date'), text: '12/30/2031' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'Use a valid native date in YYYY-MM-DD format.');
    assert.deepEqual(await snapshot(), before);
    const fresh = await read(driver, tab);
    const valid = await execute(toolset, 'type', {
      tab_id: tab,
      target: fresh.ref('Date'),
      text: '2031-12-30',
    });
    assert.equal(valid.ok, true);
    assert.deepEqual(await snapshot(), {
      date: '2031-12-30',
      note: '',
      events: [
        ['input', 'date'],
        ['change', 'date'],
      ],
    });
    for (const change of ['stale', 'covered', 'private']) {
      // Each case changes a bound element only after a trusted read.
      // oxlint-disable-next-line no-await-in-loop
      const issued = await read(driver, tab);
      // oxlint-disable-next-line no-await-in-loop
      await page.evaluate((kind) => {
        if (kind === 'stale') {
          date.replaceWith(date.cloneNode(true));
        } else if (kind === 'private') {
          date.dataset.browserPrivate = '';
        } else {
          document.body.insertAdjacentHTML(
            'beforeend',
            '<div id="cover" style="display:block;position:fixed;inset:0;z-index:999;background:white"></div>',
          );
        }
      }, change);
      // oxlint-disable-next-line no-await-in-loop
      const previous = await snapshot();
      // oxlint-disable-next-line no-await-in-loop
      const denied = await execute(toolset, 'type', {
        tab_id: tab,
        target: issued.ref('Date'),
        text: '12/30/2031',
      });
      assert.equal(denied.ok, false, change);
      assert.match(denied.error, /ref.*stale|stale.*ref/iu, change);
      // oxlint-disable-next-line no-await-in-loop
      assert.deepEqual(await snapshot(), previous, change);
      // oxlint-disable-next-line no-await-in-loop
      await page.evaluate(() => {
        document.querySelector('#cover')?.remove();
        delete date.dataset.browserPrivate;
      });
    }
    const batch = await read(driver, tab);
    const old = await snapshot();
    const modelRequests = [];
    let records = 0;
    const client = new OpenAI({
      apiKey: 'synthetic-local-only',
      fetch: async (_url, init) => {
        modelRequests.push(JSON.parse(init.body));
        return Response.json({
          id: 'resp_fixture',
          object: 'response',
          created_at: 0,
          status: 'completed',
          output:
            modelRequests.length === 1
              ? [
                  fixtureCall('browser_type', 'date', {
                    tab_id: tab,
                    target: batch.ref('Date'),
                    text: '12/30/2031',
                  }),
                  fixtureCall('browser_type', 'note', {
                    tab_id: tab,
                    target: batch.ref('Note'),
                    text: 'must stay empty',
                  }),
                  fixtureCall('record', 'ordinary', {}),
                ]
              : [
                  {
                    id: 'msg_fixture',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'done', annotations: [] }],
                  },
                ],
        });
      },
    });
    const runner = new ResponsesToolRunner({
      browser: toolset,
      functions: [
        {
          tool: {
            type: 'function',
            name: 'record',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            strict: true,
          },
          execute: () => {
            records += 1;
            return 'recorded';
          },
        },
      ],
    });
    await runner.run(client, { model: 'fixture', input: 'Local test' });
    assert.equal(modelRequests.length, 2);
    assert.equal(records, 1);
    const results = modelRequests[1].input.filter((item) => item.type === 'function_call_output');
    assert.deepEqual(
      results.map((item) => item.call_id),
      ['date', 'note', 'ordinary'],
    );
    assert.equal(
      JSON.parse(results[0].output[0].text).error,
      'Use a valid native date in YYYY-MM-DD format.',
    );
    assert.match(JSON.parse(results[1].output[0].text).error, /skipped.*earlier browser call failed/iu);
    assert.deepEqual(await snapshot(), old);
    receipts.push('native-date-feedback-no-events-recovery-guards-and-real-mixed-batch-skip');
  } finally {
    await context.close();
  }
}
async function interruptedActions() {
  // oxlint-disable no-await-in-loop -- A disposable context belongs to exactly one action case.
  for (const action of ['click', 'type', 'select_option', 'set_checked', 'scroll_to']) {
    const current = await session([[`${origin}/fixture`, 'ROW', 'choice']]);
    const { page, driver, tab, context } = current;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const drained = Promise.withResolvers();
    const stop = new AbortController();
    let proto;
    let original;
    try {
      await page.evaluate(() => {
        document.body.innerHTML = `<section data-record-id="ROW">
          <button id="save">Save row</button>
          <label for="note">Note</label><input id="note" data-browser-field="note">
          <label for="choice">Choice</label><select id="choice" size="3" data-browser-field="choice">
          <option value="standard">Standard</option><option value="express">Express</option></select>
          <label for="checked">Complete</label><input type="checkbox" id="checked" data-browser-field="checked">
          </section>`;
        const longChoice = document.createElement('option');
        longChoice.textContent = 'Oversized choice';
        longChoice.value = '😺'.repeat(129);
        document.querySelector('#choice').append(longChoice);
      });
      const report = await driver.read_page({ tab_id: tab, filter: 'all' });
      const choice = report.elements.find((item) => item.label === 'Choice');
      assert.deepEqual(
        choice.options.map((item) => [item.label, item.value]),
        [
          ['Standard', 'standard'],
          ['Express', 'express'],
        ],
      );
      assert.ok(report.omitted.includes('value'));
      const refs = Object.fromEntries(report.elements.map((item) => [item.label, item.ref]));
      const specimen = await page.locator('#save').elementHandle();
      proto = Object.getPrototypeOf(specimen);
      original = proto.evaluate;
      proto.evaluate = async function evaluate(expression, options) {
        if (options?.action !== action) {
          return await original.call(this, expression, options);
        }
        const result = await original.call(this, expression, options);
        assert.equal(result, true, action);
        entered.resolve();
        await release.promise;
        drained.resolve();
        return result;
      };
      const target = {
        click: refs['Save row'],
        type: refs.Note,
        select_option: refs.Choice,
        set_checked: refs.Complete,
        scroll_to: refs['Save row'],
      }[action];
      const args = { tab_id: tab, target };
      const invoke = {
        click: () => driver.click(args, { signal: stop.signal }),
        type: () => driver.type({ ...args, text: 'accepted' }, { signal: stop.signal }),
        select_option: () => driver.select_option({ ...args, values: ['express'] }, { signal: stop.signal }),
        set_checked: () => driver.set_checked({ ...args, checked: true }, { signal: stop.signal }),
        scroll_to: () => driver.scroll_to(args, { signal: stop.signal }),
      }[action];
      const outcome = (async () => {
        try {
          await invoke();
          return null;
        } catch (error) {
          return error;
        }
      })();
      await entered.promise;
      stop.abort();
      const result = await Promise.race([outcome, delay(1500, 'blocked')]);
      assert.notEqual(result, 'blocked', action);
      assert.match(result.message, /outcome is unknown/u);
      assert.equal(driver.hasUncertainEffects(), true, action);
      assert.ok(page.isClosed());
      await assert.rejects(driver.state(), /retired/u);
      release.resolve();
      await drained.promise;
      await outcome;
      await assert.rejects(driver.state(), /retired/u);
    } finally {
      release.resolve();
      if (proto) {
        proto.evaluate = original;
      }
      await context.close();
    }
  }
  // oxlint-enable no-await-in-loop
  receipts.push(
    'representable owned options only; five interrupted checked actions retire owned context with unknown effect',
  );
}

try {
  await interruptedActions();
  await dateFeedback();
  const a = await session();
  const s = await a.driver.state();
  assert.equal(s.observation.version, 1, 'owned context must explicitly report V1');
  assert.equal(s.tabs[0].url, origin);
  assert.equal(typeof a.driver.hover, 'undefined');
  const first = await read(a.driver, a.tab);
  assert.ok(first.omitted.includes('unsupported_control'));
  assert.ok(first.omitted.includes('private'));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_FIXTURE_VALUE|PRIVATE_HIDDEN_VALUE/u);
  const route = first.ref('Route');
  const b = await session();
  await assert.rejects(b.driver.click({ tab_id: b.tab, target: route }), /ref/u);
  await assert.rejects(a.driver.click({ tab_id: a.tab, target: 'not-issued' }), /ref/u);
  await a.page.evaluate(() => window.recycle());
  await assert.rejects(a.driver.click({ tab_id: a.tab, target: route }), /ref/u);
  assert.equal(effects.length, 0);
  const current = await read(a.driver, a.tab);
  await a.driver.click({ tab_id: a.tab, target: current.ref('Route') });
  await waitEffects(1);
  assert.deepEqual(effects[0], { id: 'T-2043', action: 'route' });
  receipts.push('opaque session registry; recycled row refused, fresh original element action succeeds');

  await a.driver.invalidateReferences();
  await assert.rejects(a.driver.click({ tab_id: a.tab, target: current.ref('Route') }), /ref/u);
  let next = await read(a.driver, a.tab);
  await a.driver.navigate({ tab_id: a.tab, url: `${origin}/other` });
  await assert.rejects(a.driver.click({ tab_id: a.tab, target: next.ref('Route') }), /ref/u);
  next = await read(a.driver, a.tab);
  const extra = await a.driver.new_tab({ url: `${origin}/fixture` });
  await a.driver.switch_tab({ tab_id: a.tab });
  await assert.rejects(a.driver.click({ tab_id: a.tab, target: next.ref('Route') }), /ref/u);
  await a.driver.close_tab({ tab_id: extra });
  next = await read(a.driver, a.tab);
  await a.driver.click({ tab_id: a.tab, target: next.ref('Route') });
  await waitEffects(2);
  receipts.push('handoff, navigation, tab departure/return invalidation with fresh recovery');

  const confirm = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const tools = new BrowserToolset(b.driver, {
    confirm: async () => {
      reached.resolve();
      return await confirm.promise;
    },
    urlPolicy: (_, url) => urls.includes(url),
  });
  const observed = await read(b.driver, b.tab);
  const pending = tools.execute({
    type: 'function_call',
    status: 'completed',
    name: 'browser_click',
    call_id: 'gate',
    arguments: JSON.stringify({ tab_id: b.tab, target: observed.ref('Route') }),
  });
  await reached.promise;
  await b.page.evaluate(() => window.recycle());
  confirm.resolve(true);
  const result = await pending;
  assert.equal(JSON.parse(result.output[0].text).ok, false);
  assert.equal(effects.length, 2);
  receipts.push('row changed during actual toolset consent refuses before effect');

  // A normal Playwright click waits for a disabled row and then targets the
  // same handle after the row has been rebound. The oracle observes the ID.
  const naive = await session();
  const naiveHandle = await naive.page.locator('#route').elementHandle();
  assert.equal(await naiveHandle.evaluate((el) => el.closest('main').dataset.recordId), 'T-1042');
  await naive.page.evaluate(() => {
    document.querySelector('#route').disabled = true;
    setTimeout(() => {
      window.recycle();
      document.querySelector('#route').disabled = false;
    }, 120);
  });
  await naiveHandle.click();
  await waitEffects(3);
  assert.deepEqual(effects[2], { id: 'T-2043', action: 'route' });
  receipts.push('negative control: Playwright auto-wait after identity check targets rebound ID');
  await naive.context.close();

  const disabled = await session();
  const beforeDisable = await read(disabled.driver, disabled.tab);
  await disabled.page.evaluate(() => {
    document.querySelector('#route').disabled = true;
  });
  await assert.rejects(
    disabled.driver.click({ tab_id: disabled.tab, target: beforeDisable.ref('Route') }),
    /ref/u,
  );
  await disabled.page.evaluate(() => {
    window.recycle();
    document.querySelector('#route').disabled = false;
  });
  await assert.rejects(
    disabled.driver.click({ tab_id: disabled.tab, target: beforeDisable.ref('Route') }),
    /ref/u,
  );
  assert.equal(effects.length, 3);
  receipts.push('disabled then rebound: no wait and no effect through the saved ref');
  await disabled.context.close();

  const pointer = await session();
  const pointerHandle = await pointer.page.locator('#route').elementHandle();
  assert.equal(await pointerHandle.evaluate((el) => el.closest('main').dataset.recordId), 'T-1042');
  await pointer.page.evaluate(() => window.armInputTrap());
  await pointerHandle.click();
  await waitEffects(4);
  assert.deepEqual(effects[3], { id: 'T-2043', action: 'route' });
  const focus = await session();
  const inputHandle = await focus.page.locator('input[type=text]').elementHandle();
  assert.equal(await inputHandle.evaluate((el) => el.closest('main').dataset.recordId), 'T-1042');
  await focus.page.evaluate(() => window.armInputTrap());
  await inputHandle.fill('Avery');
  assert.equal(await focus.page.locator('main').getAttribute('data-record-id'), 'T-2043');
  receipts.push('negative controls: trusted pointer and focus rebind after precheck');
  await pointer.context.close();
  await focus.context.close();

  const atomic = await session();
  const atom = await read(atomic.driver, atomic.tab);
  await atomic.page.evaluate(() => {
    window.armInputTrap();
    document.querySelector('input').addEventListener('invalid', window.recycle);
  });
  await assert.rejects(atomic.driver.click({ tab_id: atomic.tab, target: atom.ref('Submit') }), /ref/u);
  assert.equal(await atomic.page.locator('main').getAttribute('data-record-id'), 'T-1042');
  await atomic.driver.type({ tab_id: atomic.tab, target: atom.ref('Guest'), text: 'Avery' });
  await atomic.driver.select_option({ tab_id: atomic.tab, target: atom.ref('Team'), values: ['Account'] });
  assert.equal(await atomic.page.locator('input[type=text]').inputValue(), 'Avery');
  assert.equal(await atomic.page.locator('select').inputValue(), 'Account');
  await atomic.driver.click({ tab_id: atomic.tab, target: atom.ref('Submit') });
  await waitEffects(5);
  assert.deepEqual(effects[4], { id: 'T-1042', action: 'submit' });
  assert.equal(await atomic.page.locator('main').getAttribute('data-record-id'), 'T-1042');
  receipts.push('owned DOM actions omit pointer/focus; invalid form refused before validation callbacks');
  await atomic.context.close();

  const framed = await session();
  await framed.page.evaluate((src) => {
    document.querySelector('main').replaceChildren();
    const frame = document.createElement('iframe');
    frame.src = src;
    document.querySelector('main').append(frame);
  }, `${origin}/frame`);
  await framed.page.frameLocator('iframe').locator('#route').waitFor();
  let frameRead = await read(framed.driver, framed.tab);
  await framed.driver.click({ tab_id: framed.tab, target: frameRead.ref('Route') });
  await waitEffects(6);
  assert.deepEqual(effects[5], { id: 'T-1042', action: 'route' });
  frameRead = await read(framed.driver, framed.tab);
  const held = frameRead.ref('Route');
  const navigated = framed.page.waitForEvent('framenavigated', (frame) => frame.url() === `${origin}/other`);
  await framed.page.evaluate((src) => {
    document.querySelector('iframe').src = src;
  }, `${origin}/other`);
  await navigated;
  await framed.page.frameLocator('iframe').locator('#route').waitFor();
  await assert.rejects(framed.driver.click({ tab_id: framed.tab, target: held }), /ref/u);
  frameRead = await read(framed.driver, framed.tab);
  await framed.page.evaluate(() => {
    document.querySelector('iframe').remove();
  });
  await assert.rejects(framed.driver.click({ tab_id: framed.tab, target: frameRead.ref('Route') }), /ref/u);
  receipts.push('exact owned frame: fresh effect succeeds; frame navigation and detach invalidate');
  await framed.context.close();

  const privacy = await session();
  const preserved = await privacy.driver.state();
  const refused = `${origin}/private-route?credential=PRIVATE_QUERY`;
  await assert.rejects(privacy.driver.navigate({ tab_id: privacy.tab, url: refused }), /outside/u);
  await privacy.page.evaluate(() => {
    // A real browser dialog proves that the driver reports kind, never text.
    // oxlint-disable-next-line no-alert
    alert('PRIVATE_DIALOG');
  });
  await privacy.page.evaluate(() => {
    document.title = '🪴'.repeat(300);
  });
  for (let index = 0; index < 36; index += 1) {
    // Exercise real owned navigation and non-consuming ring reads.
    // oxlint-disable-next-line no-await-in-loop
    await privacy.driver.navigate({ tab_id: privacy.tab, url: origin + (index % 2 ? '/fixture' : '/other') });
  }
  await privacy.page.evaluate(() => {
    document.title = '🪴'.repeat(300);
  });
  const bounded = await privacy.driver.state();
  assert.equal(bounded.observation.changes.length, 32);
  assert.ok(bounded.observation.dropped_changes >= 6);
  assert.equal(bounded.observation.title_truncated, true);
  assert.equal(Buffer.byteLength(bounded.tabs[0].title), 1024);
  assert.deepEqual(await privacy.driver.state(), bounded);
  assert.ok(preserved.observation.sequence < bounded.observation.sequence);
  assert.doesNotMatch(
    JSON.stringify({ preserved, bounded }),
    /PRIVATE_QUERY|PRIVATE_DIALOG|\/fixture|\/other/u,
  );
  receipts.push(
    '32 retained non-consuming event snapshots; overflow, bounded UTF8 title and origin-only display',
  );
  await privacy.context.close();

  const events = await session();
  const consent = [];
  const requestedURLs = [];
  const policy = {
    confirm(context) {
      consent.push(structuredClone(context));
      return true;
    },
    urlPolicy(context, url) {
      requestedURLs.push(url);
      assert.equal(context.arguments.url, url);
      assert.doesNotMatch(JSON.stringify(context.state), /PRIVATE_/u);
      return true;
    },
  };
  const toolset = new BrowserToolset(events.driver, policy);
  const beforeTabs = await events.driver.state();
  const opened = await execute(toolset, 'new_tab', { url: `${origin}/other` });
  assert.equal(opened.ok, true);
  const second = opened.state.tabs.find((tab) => tab.id !== events.tab).id;
  assert.deepEqual(changesOf(opened.state, 'tab_opened').at(-1), {
    type: 'tab_opened',
    sequence: changesOf(opened.state, 'tab_opened').at(-1).sequence,
    tab_id: second,
  });
  assert.deepEqual(
    opened.state.tabs.filter((tab) => tab.active).map((tab) => tab.id),
    [second],
  );
  const switched = await execute(toolset, 'switch_tab', { tab_id: events.tab });
  assert.equal(switched.ok, true);
  assert.equal(changesOf(switched.state, 'tab_switched').at(-1).tab_id, events.tab);
  const closed = await execute(toolset, 'close_tab', { tab_id: second });
  assert.equal(closed.ok, true);
  assert.equal(changesOf(closed.state, 'tab_closed').at(-1).tab_id, second);
  assert.deepEqual(
    closed.state.tabs.filter((tab) => tab.active).map((tab) => tab.id),
    [events.tab],
  );
  const listed = await execute(toolset, 'list_tabs', {});
  assert.deepEqual(listed.state, closed.state);
  assert.deepEqual(listed.result, closed.state);
  assert.ok(beforeTabs.observation.sequence < listed.state.observation.sequence);

  // Hold the actual Chromium dismissal. State can block at page.title while
  // the modal is open, but it must never claim dismissal before the reply.
  const dismissReached = Promise.withResolvers();
  const allowDismiss = Promise.withResolvers();
  const holdDialog = (dialog) => {
    const dismiss = dialog.dismiss.bind(dialog);
    dialog.dismiss = async () => {
      dismissReached.resolve();
      await allowDismiss.promise;
      await dismiss();
    };
  };
  events.page.prependListener('dialog', holdDialog);
  const priorDialog = await events.driver.state();
  const modal = events.page.evaluate(() => {
    // oxlint-disable-next-line no-alert
    window.alert('PRIVATE_PENDING_DIALOG');
  });
  try {
    await dismissReached.promise;
    const pendingRead = events.driver.state();
    const early = await Promise.race([pendingRead, delay(80, null)]);
    if (early !== null) {
      assert.deepEqual(changesOf(early, 'dialog_dismissed'), changesOf(priorDialog, 'dialog_dismissed'));
    }
    allowDismiss.resolve();
    await modal;
    await pendingRead;
    const dismissed = await waitChange(events.driver, 'dialog_dismissed', priorDialog.observation.sequence);
    assert.equal(changesOf(dismissed, 'dialog_dismissed').at(-1).kind, 'alert');
    assert.doesNotMatch(JSON.stringify(dismissed), /PRIVATE_/u);
  } finally {
    allowDismiss.resolve();
    events.page.removeListener('dialog', holdDialog);
  }
  for (const [kind, expected] of [
    ['alert', null],
    ['confirm', false],
    ['prompt', null],
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    const before = await events.driver.state();
    // oxlint-disable-next-line no-await-in-loop
    const dialogResult = await events.page.evaluate((dialogKind) => {
      if (dialogKind === 'alert') {
        // The test must show a real browser dialog.
        // oxlint-disable-next-line no-alert
        window.alert('PRIVATE_DIALOG');
        return null;
      }
      return window[dialogKind]('PRIVATE_DIALOG');
    }, kind);
    assert.equal(dialogResult, expected);
    // oxlint-disable-next-line no-await-in-loop
    const reported = await waitChange(events.driver, 'dialog_dismissed', before.observation.sequence);
    assert.deepEqual(changesOf(reported, 'dialog_dismissed').at(-1), {
      type: 'dialog_dismissed',
      tab_id: events.tab,
      sequence: reported.observation.sequence,
      kind,
    });
    assert.doesNotMatch(JSON.stringify(reported), /PRIVATE_/u);
  }
  const beforeDownload = await events.driver.state();
  const downloaded = events.page.waitForEvent('download');
  await events.page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/attachment';
    document.body.append(link);
    link.click();
    link.remove();
  });
  const download = await downloaded;
  const blocked = await waitChange(events.driver, 'download', beforeDownload.observation.sequence);
  assert.equal(changesOf(blocked, 'download').at(-1).status, 'blocked');
  assert.ok(await download.failure(), 'Disabled downloads must report failure; no file path or export');
  assert.doesNotMatch(JSON.stringify(blocked), /PRIVATE_/u);

  await events.page.evaluate(() => {
    const loaded = Promise.withResolvers();
    const frame = document.createElement('iframe');
    frame.addEventListener('load', loaded.resolve, { once: true });
    frame.src = '/redirect';
    document.body.append(frame);
    return loaded.promise;
  });
  const redirect = await events.driver.state();
  assert.equal(
    changesOf(redirect, 'navigation_refused').length,
    changesOf(blocked, 'navigation_refused').length,
  );
  assert.ok(requests.includes('/redirect'));
  assert.equal(requests.filter((url) => url.includes('PRIVATE_')).length, 0);
  const unrelated = await execute(toolset, 'switch_tab', { tab_id: events.tab });
  assert.equal(unrelated.ok, true);
  assert.doesNotMatch(JSON.stringify({ unrelated, context: consent.at(-1) }), /PRIVATE_/u);
  const refusals = changesOf(unrelated.state, 'navigation_refused').length;
  await events.page.evaluate(() => {
    const loaded = Promise.withResolvers();
    const frame = document.createElement('iframe');
    frame.addEventListener('load', loaded.resolve, { once: true });
    frame.src = '/failed';
    document.body.append(frame);
    return loaded.promise;
  });
  const networkFailure = await events.driver.state();
  assert.ok(requests.includes('/failed'));
  assert.equal(changesOf(networkFailure, 'navigation_refused').length, refusals);

  for (const member of ['navigate', 'new_tab']) {
    const url = `${origin}/PRIVATE_DENIED?token=PRIVATE_ARGUMENT`;
    const args = member === 'navigate' ? { tab_id: events.tab, url } : { url };
    // oxlint-disable-next-line no-await-in-loop
    const before = await events.driver.state();
    // oxlint-disable-next-line no-await-in-loop
    const denied = await execute(toolset, member, args);
    assert.equal(denied.ok, false);
    assert.equal(requestedURLs.at(-1), url);
    assert.equal(
      consent.at(-1).arguments.url,
      url,
      'Approved action args deliberately keep the requested URL',
    );
    assert.doesNotMatch(JSON.stringify({ state: consent.at(-1).state, denied }), /PRIVATE_/u);
    assert.equal(denied.state.observation.sequence, before.observation.sequence + 1);
    assert.equal(changesOf(denied.state, 'navigation_refused').at(-1).reason, 'policy');
    const approved = consent.length;
    policy.urlPolicy = (_, requested) => {
      assert.equal(requested, url);
      return false;
    };
    // oxlint-disable-next-line no-await-in-loop
    const sdkDenied = await execute(toolset, member, args);
    assert.equal(sdkDenied.ok, false);
    assert.deepEqual(sdkDenied.state, denied.state);
    assert.equal(consent.length, approved);
    policy.urlPolicy = (context, requested) => {
      requestedURLs.push(requested);
      assert.equal(context.arguments.url, requested);
      return true;
    };
  }
  assert.equal(requests.filter((url) => url.includes('PRIVATE_')).length, 0);
  const preservedEvents = await events.driver.state();
  for (let index = 0; index < 36; index += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const visited = await execute(toolset, 'navigate', {
      tab_id: events.tab,
      url: origin + (index % 2 ? '/fixture' : '/other'),
    });
    assert.equal(visited.ok, true);
  }
  const ring = await events.driver.state();
  assert.equal(ring.observation.changes.length, 32);
  assert.deepEqual(
    ring.observation.changes.map((change) => change.sequence),
    Array.from({ length: 32 }, (_, index) => ring.observation.dropped_changes + index + 1),
  );
  assert.equal(ring.observation.sequence, ring.observation.dropped_changes + 32);
  assert.ok(preservedEvents.observation.sequence < ring.observation.sequence);
  assert.deepEqual(await events.driver.state(), ring);
  const afterOverflow = await read(events.driver, events.tab);
  const ref = afterOverflow.ref('Route');
  policy.confirm = () => false;
  const refusedClick = await execute(toolset, 'click', { tab_id: events.tab, target: ref });
  assert.equal(refusedClick.ok, false);
  assert.deepEqual(refusedClick.state, ring);
  const realState = events.driver.state;
  events.driver.state = async () => {
    await realState();
    throw new Error('PRIVATE_STATE_FAILURE');
  };
  await assert.rejects(execute(toolset, 'list_tabs', {}), (error) => {
    assert.doesNotMatch(String(error), /PRIVATE_/u);
    return true;
  });
  events.driver.state = realState;
  const afterFailure = await execute(toolset, 'list_tabs', {});
  assert.deepEqual(afterFailure.state, ring);
  policy.confirm = () => true;
  const freshRead = await read(events.driver, events.tab);
  const freshRef = freshRead.ref('Route');
  const effectBeforeRecovery = effects.length;
  const recovered = await execute(toolset, 'click', { tab_id: events.tab, target: freshRef });
  assert.equal(recovered.ok, true);
  await waitEffects(effectBeforeRecovery + 1);
  receipts.push(
    'real tab/dialog/download/redirect/failure events survive SDK refusal and failed read; fresh action recovers',
  );
  await events.context.close();

  // Drop only an actual action evaluation reply AFTER the server saw its
  // effect. Hold, then fail context.close to prove retirement does not depend
  // on closing succeeding. No production test hooks.
  const lost = await session();
  const effectsBeforeLoss = effects.length;
  const issued = await read(lost.driver, lost.tab);
  const sample = await lost.page.locator('#route').elementHandle();
  const prototype = Object.getPrototypeOf(sample);
  const originalEvaluate = prototype.evaluate;
  const hadOwnEvaluate = Object.hasOwn(prototype, 'evaluate');
  const originalClose = lost.context.close.bind(lost.context);
  const closing = Promise.withResolvers();
  const releaseClose = Promise.withResolvers();
  lost.context.close = async () => {
    closing.resolve();
    await releaseClose.promise;
    throw new Error('close failed');
  };
  prototype.evaluate = async function evaluate(fn, arg) {
    const evaluated = await originalEvaluate.call(this, fn, arg);
    if (fn.name === 'ownedElement' && arg?.action === 'click') {
      await waitEffects(effectsBeforeLoss + 1);
      throw new Error('action reply lost');
    }
    return evaluated;
  };
  try {
    const loss = assert.rejects(
      lost.driver.click({ tab_id: lost.tab, target: issued.ref('Route') }),
      /unknown/u,
    );
    await closing.promise;
    assert.deepEqual(effects[effectsBeforeLoss], { id: 'T-1042', action: 'route' });
    await assert.rejects(lost.driver.state(), /retired/u);
    await assert.rejects(lost.driver.read_page({ tab_id: lost.tab, filter: 'interactive' }), /retired/u);
    await assert.rejects(lost.driver.invalidateReferences(), /retired/u);
    await assert.rejects(lost.driver.new_tab({ url: `${origin}/fixture` }), /retired/u);
    const lateErrors = [];
    const onLateError = (error) => lateErrors.push(error);
    process.on('unhandledRejection', onLateError);
    try {
      const latePage = await lost.context.newPage();
      await delay(0);
      await latePage.close();
      assert.deepEqual(lateErrors, [], 'A late page during retirement must not reject outside the action.');
      await assert.rejects(lost.driver.state(), /retired/u);
    } finally {
      process.off('unhandledRejection', onLateError);
    }
    // Even with a new successful approval, the installed SDK cannot reach a
    // second effect while the owned context is still closing.
    const after = new BrowserToolset(lost.driver, {
      confirm: () => true,
      urlPolicy: (_, url) => urls.includes(url),
    });
    await assert.rejects(
      after.execute({
        type: 'function_call',
        status: 'completed',
        name: 'browser_click',
        call_id: 'after-loss',
        arguments: JSON.stringify({ tab_id: lost.tab, target: issued.ref('Route') }),
      }),
      /state report failed/u,
    );
    releaseClose.resolve();
    await loss;
    await assert.rejects(lost.driver.state(), /retired/u);
    await assert.rejects(lost.driver.click({ tab_id: lost.tab, target: issued.ref('Route') }), /retired/u);
    assert.equal(effects.length, effectsBeforeLoss + 1);
    receipts.push(
      'effect then lost reply: retirement before deferred/failed close blocks state, read, new tab and next approved SDK action',
    );
  } finally {
    if (hadOwnEvaluate) {
      prototype.evaluate = originalEvaluate;
    } else {
      delete prototype.evaluate;
    }
    releaseClose.resolve();
    await originalClose();
  }

  // Keep both independent regressions visible in one frozen-driver run.
  const failures = [];
  const hidden = await session();
  try {
    const initial = await read(hidden.driver, hidden.tab);
    const expectedEffects = effects.length + 1;
    await hidden.page.evaluate(() => {
      const child = document.createElement('span');
      child.hidden = true;
      child.textContent = 'PRIVATE_HIDDEN_VALUE';
      document.querySelector('#route').append(child);
    });
    // A change to hidden data must not change visible action identity.
    await hidden.driver.click({ tab_id: hidden.tab, target: initial.ref('Route') });
    await waitEffects(expectedEffects);
    assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
    const visibleLabel = await read(hidden.driver, hidden.tab);
    assert.doesNotMatch(JSON.stringify(visibleLabel), /PRIVATE_HIDDEN_VALUE/u);
    assert.ok(visibleLabel.ref('Route'));
    await hidden.page.evaluate(() => {
      document.querySelector('#route').firstChild.data = 'Reassign';
    });
    await assert.rejects(
      hidden.driver.click({ tab_id: hidden.tab, target: visibleLabel.ref('Route') }),
      /ref/u,
    );
    assert.equal(effects.length, expectedEffects);
    receipts.push('hidden child text is absent from observations and cannot change visible action identity');
  } catch (error) {
    failures.push(new Error('NREF-1: rendered action label', { cause: error }));
  } finally {
    await hidden.context.close();
  }

  const covered = await session();
  try {
    await covered.page.evaluate((src) => {
      const main = document.querySelector('main');
      main.replaceChildren();
      const iframe = document.createElement('iframe');
      iframe.src = src;
      main.append(iframe);
    }, `${origin}/frame`);
    await covered.page.frameLocator('iframe').locator('#route').waitFor();
    const child = covered.page.frames().find((frame) => frame.url() === `${origin}/frame`);
    await child.evaluate((src) => {
      const main = document.querySelector('main');
      main.replaceChildren();
      const nested = document.createElement('iframe');
      nested.src = src;
      main.append(nested);
    }, `${origin}/other`);
    await covered.page.frameLocator('iframe').frameLocator('iframe').locator('#route').waitFor();
    const exposed = await read(covered.driver, covered.tab);
    await covered.page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'cover';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '100',
        backgroundColor: 'white',
      });
      document.body.append(overlay);
    });
    const before = effects.length;
    await assert.rejects(covered.driver.click({ tab_id: covered.tab, target: exposed.ref('Route') }), /ref/u);
    const underCover = await read(covered.driver, covered.tab);
    assert.equal(underCover.elements.length, 0, 'Covered child refs must not be issued');
    assert.ok(underCover.omitted.includes('unsupported_root'));
    assert.equal(effects.length, before);
    await covered.page.evaluate(() => {
      document.querySelector('#cover').remove();
    });
    const revealed = await read(covered.driver, covered.tab);
    await covered.driver.click({ tab_id: covered.tab, target: revealed.ref('Route') });
    await waitEffects(before + 1);
    assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
    // A transform on an ancestor of the outer frame is unsupported even
    // when its visually translated child center would otherwise be clickable.
    await covered.page.evaluate(() => {
      document.querySelector('main').style.transform = 'translate(2px, 2px)';
    });
    await assert.rejects(
      covered.driver.click({ tab_id: covered.tab, target: revealed.ref('Route') }),
      /ref/u,
    );
    const transformed = await read(covered.driver, covered.tab);
    assert.equal(transformed.elements.length, 0);
    assert.equal(effects.length, before + 1);
    receipts.push(
      'top overlay across two ancestors prevents issuance/action; revealed ref succeeds; transformed ancestor refuses',
    );
    await covered.page.evaluate((src) => {
      const main = document.querySelector('main');
      main.style.transform = 'none';
      document.querySelector('iframe').src = src;
    }, `${otherOrigin}/frame`);
    await covered.page.frameLocator('iframe').locator('#route').waitFor();
    const crossOrigin = await read(covered.driver, covered.tab);
    assert.equal(crossOrigin.elements.length, 0, 'An inaccessible parent cannot be proved visible');
    assert.ok(crossOrigin.omitted.includes('remote_action'));
    assert.match(crossOrigin.text, /Read only: remote frame button Route/u);
    assert.equal(effects.length, before + 1);
    receipts.push('exact installed cross-origin child gives read-only summary and no action refs');
  } catch (error) {
    failures.push(new Error('NREF-2: covered parent frame', { cause: error }));
  } finally {
    await covered.context.close();
  }
  for (const selector of ['#route', 'main']) {
    // Each case owns a separate page; its visible ref precedes the CSS change.
    // oxlint-disable-next-line no-await-in-loop
    const transparent = await session();
    try {
      // oxlint-disable-next-line no-await-in-loop
      const wasVisible = await read(transparent.driver, transparent.tab);
      // oxlint-disable-next-line no-await-in-loop
      await transparent.page.locator(selector).evaluate((element) => {
        element.style.opacity = '0';
      });
      const before = effects.length;
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(
        transparent.driver.click({ tab_id: transparent.tab, target: wasVisible.ref('Route') }),
        /ref/u,
      );
      // oxlint-disable-next-line no-await-in-loop
      const invisible = await read(transparent.driver, transparent.tab);
      assert.ok(invisible.elements.every((element) => element.label !== 'Route'));
      assert.equal(effects.length, before);
      // oxlint-disable-next-line no-await-in-loop
      await transparent.page.locator(selector).evaluate((element) => {
        element.style.opacity = '1';
      });
      // oxlint-disable-next-line no-await-in-loop
      const revealed = await read(transparent.driver, transparent.tab);
      // oxlint-disable-next-line no-await-in-loop
      await transparent.driver.click({ tab_id: transparent.tab, target: revealed.ref('Route') });
      // oxlint-disable-next-line no-await-in-loop
      await waitEffects(before + 1);
      assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
      receipts.push(`opacity zero on ${selector}: no issuance/action; revealed ref succeeds`);
    } catch (error) {
      failures.push(new Error(`NREF-3: transparent ${selector}`, { cause: error }));
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await transparent.context.close();
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Owned reference regressions failed.');
  }

  // Create both tabs before reading. Only switch_tab may invalidate this ref.
  const tabsOnly = await session();
  const tabB = await tabsOnly.driver.new_tab({ url: `${origin}/other` });
  await tabsOnly.driver.switch_tab({ tab_id: tabsOnly.tab });
  const beforeSwitch = await read(tabsOnly.driver, tabsOnly.tab);
  const sameButton = await tabsOnly.page.locator('#route').elementHandle();
  const tabsOracle = effects.length;
  const tabsToolset = new BrowserToolset(tabsOnly.driver, {
    confirm: () => true,
    urlPolicy: (_, url) => urls.includes(url),
  });
  await tabsOnly.driver.switch_tab({ tab_id: tabB });
  await tabsOnly.driver.switch_tab({ tab_id: tabsOnly.tab });
  assert.equal(await sameButton.evaluate((el) => el === document.querySelector('#route')), true);
  const oldTabRef = await execute(tabsToolset, 'click', {
    tab_id: tabsOnly.tab,
    target: beforeSwitch.ref('Route'),
  });
  assert.equal(oldTabRef.ok, false);
  assert.equal(effects.length, tabsOracle, 'Existing-tab switches cannot act through the earlier ref');
  const freshOnA = await read(tabsOnly.driver, tabsOnly.tab);
  const freshTabAction = await execute(tabsToolset, 'click', {
    tab_id: tabsOnly.tab,
    target: freshOnA.ref('Route'),
  });
  assert.equal(freshTabAction.ok, true);
  await waitEffects(tabsOracle + 1);
  assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
  receipts.push('already-open A to B to A: old explicit A ref refuses; same element fresh A ref acts once');
  await tabsOnly.context.close();

  const history = await session();
  const historyToolset = new BrowserToolset(history.driver, {
    confirm: () => true,
    urlPolicy: (_, url) => urls.includes(url),
  });
  // Read on B after navigating, so forward navigation cannot mask a broken back transition.
  await history.driver.navigate({ tab_id: history.tab, url: `${origin}/other` });
  const onOther = await read(history.driver, history.tab);
  const historyOracle = effects.length;
  await history.page.goBack({ waitUntil: 'domcontentloaded' });
  assert.equal(history.page.url(), `${origin}/fixture`);
  const oldDocument = await execute(historyToolset, 'click', {
    tab_id: history.tab,
    target: onOther.ref('Route'),
  });
  assert.equal(oldDocument.ok, false);
  assert.equal(effects.length, historyOracle);
  const afterBack = await read(history.driver, history.tab);
  const freshHistoryAction = await execute(historyToolset, 'click', {
    tab_id: history.tab,
    target: afterBack.ref('Route'),
  });
  assert.equal(freshHistoryAction.ok, true);
  await waitEffects(historyOracle + 1);
  assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
  receipts.push(
    'ordinary browser history back invalidates a ref issued after forward navigation; fresh original ref acts once',
  );
  await history.context.close();

  const sameDocument = await session();
  const sameDocTools = new BrowserToolset(sameDocument.driver, {
    confirm: () => true,
    urlPolicy: (_, url) => urls.includes(url),
  });
  const beforeHistory = await read(sameDocument.driver, sameDocument.tab);
  const retained = await sameDocument.page.locator('#route').elementHandle();
  const sameDocOracle = effects.length;
  await sameDocument.page.evaluate(() => window.history.pushState({}, '', '#owned-roundtrip'));
  assert.equal(sameDocument.page.url(), `${origin}/fixture#owned-roundtrip`);
  await sameDocument.page.goBack({ waitUntil: 'domcontentloaded' });
  assert.equal(sameDocument.page.url(), `${origin}/fixture`);
  assert.equal(
    await retained.evaluate((el) => el.isConnected && el === document.querySelector('#route')),
    true,
  );
  const fromOldObservation = await execute(sameDocTools, 'click', {
    tab_id: sameDocument.tab,
    target: beforeHistory.ref('Route'),
  });
  assert.equal(fromOldObservation.ok, false);
  assert.equal(effects.length, sameDocOracle);
  const nowObserved = await read(sameDocument.driver, sameDocument.tab);
  const freshSameDocAction = await execute(sameDocTools, 'click', {
    tab_id: sameDocument.tab,
    target: nowObserved.ref('Route'),
  });
  assert.equal(freshSameDocAction.ok, true);
  await waitEffects(sameDocOracle + 1);
  assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
  receipts.push(
    'same-document installed URL roundtrip preserves original element; stale ref fails and freshly approved ref acts once',
  );
  await sameDocument.context.close();

  const declarations = [[`${origin}/fixture`, 'T-1042', 'guest']];
  const values = await session(declarations);
  declarations[0][2] = 'team';
  declarations.push([`${origin}/fixture`, 'T-1042', 'secret']);
  await values.page.evaluate(() => {
    document.querySelector('input[type=text]').value = 'Public Avery';
    document.querySelector('select').value = 'Account';
    const privateInput = document.querySelector('input[type=password]');
    privateInput.dataset.browserField = 'guest';
    const spoofedInput = document.createElement('input');
    spoofedInput.dataset.browserField = 'secret';
    spoofedInput.setAttribute('aria-label', 'Spoofed public');
    spoofedInput.value = 'PRIVATE_FORGED_VALUE';
    document.querySelector('form').prepend(spoofedInput);
    document.querySelector('#route').innerHTML = 'Route<span data-browser-private>PRIVATE_IN_LABEL</span>';
  });
  const valueTools = new BrowserToolset(values.driver, {
    confirm: (context) => {
      assert.doesNotMatch(JSON.stringify(context.state), /PRIVATE_/u);
      return true;
    },
    urlPolicy: (_, url) => urls.includes(url),
  });
  const publicRead = await execute(valueTools, 'read_page', { tab_id: values.tab, filter: 'all' });
  assert.equal(publicRead.ok, true);
  assert.equal(publicRead.result.elements.find((item) => item.label === 'Guest').value, 'Public Avery');
  assert.equal('value' in publicRead.result.elements.find((item) => item.label === 'Team'), false);
  assert.equal('value' in publicRead.result.elements.find((item) => item.label === 'Spoofed public'), false);
  assert.doesNotMatch(JSON.stringify(publicRead), /PRIVATE_|data-record|data-browser-field/u);
  await values.page.evaluate(() => {
    document.querySelector('input[type=text][data-browser-field=guest]').dataset.browserPrivate = '';
  });
  const deniedPrivate = await values.driver.read_page({ tab_id: values.tab, filter: 'all' });
  assert.doesNotMatch(JSON.stringify(deniedPrivate), /Public Avery|PRIVATE_/u);
  await values.driver.navigate({ tab_id: values.tab, url: `${origin}/other` });
  await values.page.locator('input[type=text]').fill('PRIVATE_WRONG_DOCUMENT');
  const wrongDocument = await values.driver.read_page({ tab_id: values.tab, filter: 'all' });
  assert.doesNotMatch(JSON.stringify(wrongDocument), /PRIVATE_/u);
  assert.ok(wrongDocument.omitted.includes('value'));
  assert.throws(
    () =>
      createBrowserDriver(values.context, {
        ownedFixture: { urls, publicValues: [[`${origin}/uninstalled`, 'T-1042', 'guest']] },
      }),
    /publicValues/u,
  );
  const selectedPrivate = await session([[`${origin}/fixture`, 'T-1042', 'team']]);
  await selectedPrivate.page.evaluate(() => {
    const selected = document.querySelector('select option');
    selected.value = 'PRIVATE_SELECTED_OPTION';
    selected.textContent = 'PRIVATE_OPTION_LABEL';
    selected.dataset.browserPrivate = '';
    document.querySelector('select').selectedIndex = 0;
  });
  const secretOption = await selectedPrivate.driver.read_page({
    tab_id: selectedPrivate.tab,
    filter: 'interactive',
  });
  assert.doesNotMatch(JSON.stringify(secretOption), /PRIVATE_/u);
  assert.ok(secretOption.omitted.includes('private'));
  assert.deepEqual(secretOption.elements.find((item) => item.label === 'Team').options, [
    { label: 'Account', value: 'Account' },
  ]);
  await selectedPrivate.context.close();
  receipts.push(
    'immutable public tuples, cross-document and forged field denial, private/password/hidden overrides in SDK output',
  );
  await values.context.close();

  const names = await session();
  const nameBefore = effects.length;
  await names.page.evaluate(() => {
    const label = document.createElement('span');
    label.id = 'case-name';
    label.textContent = 'Visible Business 8731';
    const hiddenLabel = document.createElement('span');
    hiddenLabel.id = 'hidden-name';
    hiddenLabel.hidden = true;
    hiddenLabel.textContent = 'PRIVATE_LABELLED_BY';
    document.querySelector('main').prepend(label, hiddenLabel);
    document.querySelector('main').dataset.recordId = 'PRIVATE_ROW_KEY';
    document.querySelector('#route').setAttribute('aria-labelledby', 'hidden-name case-name');
  });
  const privateFind = await names.driver.find({ tab_id: names.tab, query: 'PRIVATE_ROW_KEY' });
  assert.equal(privateFind.elements.length, 0);
  const visibleFind = await names.driver.find({ tab_id: names.tab, query: 'business 8731' });
  assert.deepEqual(
    visibleFind.elements.map(({ role, label }) => ({ role, label })),
    [{ role: 'button', label: 'Visible Business 8731' }],
  );
  assert.doesNotMatch(JSON.stringify(visibleFind), /PRIVATE_/u);
  await names.driver.click({ tab_id: names.tab, target: visibleFind.elements[0].ref });
  await waitEffects(nameBefore + 1);
  assert.deepEqual(effects.at(-1), { id: 'T-1042', action: 'route' });
  const retainedRead = await read(names.driver, names.tab);
  const textRead = await names.driver.get_page_text({ tab_id: names.tab });
  assert.deepEqual(textRead.elements, []);
  assert.doesNotMatch(JSON.stringify(textRead), /PRIVATE_/u);
  await names.driver.click({ tab_id: names.tab, target: retainedRead.ref('Visible Business 8731') });
  await waitEffects(nameBefore + 2);
  const noMatch = await names.driver.find({ tab_id: names.tab, query: 'missing' });
  assert.equal(noMatch.elements.length, 0);
  await assert.rejects(
    names.driver.click({ tab_id: names.tab, target: retainedRead.ref('Visible Business 8731') }),
    /ref/u,
  );
  receipts.push(
    'visible normalized accessible name search never searches private row IDs; text read retains ref, unmatched find invalidates it',
  );
  await names.context.close();

  const virtual = await session();
  const virtualBefore = effects.length;
  await virtual.page.evaluate(() => {
    const main = document.querySelector('main');
    main.replaceChildren();
    main.dataset.recordId = 'V-1';
    const host = document.createElement('div');
    main.append(host);
    const outer = host.attachShadow({ mode: 'open' });
    const nestedHost = document.createElement('div');
    outer.append(nestedHost);
    const inner = nestedHost.attachShadow({ mode: 'open' });
    inner.innerHTML = '<slot name="row"></slot>';
    const button = document.createElement('button');
    button.slot = 'row';
    button.textContent = 'Route mounted row';
    nestedHost.append(button);
    let bound;
    window.bindMounted = (id) => {
      if (bound) {
        button.removeEventListener('click', bound);
      }
      main.dataset.recordId = id;
      bound = () => fetch('/effect', { method: 'POST', body: JSON.stringify({ id, action: 'mounted' }) });
      button.addEventListener('click', bound);
    };
    window.bindMounted('V-1');
    const closedHost = document.createElement('div');
    main.append(closedHost);
    closedHost.attachShadow({ mode: 'closed' }).innerHTML = '<button>PRIVATE_CLOSED_ROOT</button>';
  });
  const mounted = await virtual.driver.find({ tab_id: virtual.tab, query: 'mounted' });
  assert.equal(mounted.elements.length, 1);
  assert.ok(mounted.omitted.includes('unsupported_root'));
  assert.doesNotMatch(JSON.stringify(mounted), /PRIVATE_/u);
  await virtual.page.evaluate(() => window.bindMounted('V-2'));
  await assert.rejects(
    virtual.driver.click({ tab_id: virtual.tab, target: mounted.elements[0].ref }),
    /ref/u,
  );
  assert.equal(effects.length, virtualBefore);
  const freshMounted = await virtual.driver.find({ tab_id: virtual.tab, query: 'mounted' });
  await virtual.driver.click({ tab_id: virtual.tab, target: freshMounted.elements[0].ref });
  await waitEffects(virtualBefore + 1);
  assert.deepEqual(effects.at(-1), { id: 'V-2', action: 'mounted' });
  const beforeRole = await virtual.driver.find({ tab_id: virtual.tab, query: 'mounted' });
  await virtual.page.locator('button').evaluate((button) => button.setAttribute('role', 'link'));
  await assert.rejects(
    virtual.driver.click({ tab_id: virtual.tab, target: beforeRole.elements[0].ref }),
    /ref/u,
  );
  assert.equal(effects.length, virtualBefore + 1);
  receipts.push(
    'nested open shadow and assigned slot mounted ref; closed coverage warning and same-label recycled row zero effects',
  );
  await virtual.context.close();

  const remote = await session([[`${otherOrigin}/rich-child`, 'INTERNAL_ROW_1207', 'queue']]);
  const remoteBefore = effects.length;
  await remote.page.evaluate((src) => {
    const main = document.querySelector('main');
    main.replaceChildren();
    const frame = document.createElement('iframe');
    frame.src = src;
    main.append(frame);
  }, `${otherOrigin}/rich-child`);
  await remote.page.frameLocator('iframe').locator('#dispatch').waitFor();
  const remoteFound = await remote.driver.find({ tab_id: remote.tab, query: 'BP-1207' });
  assert.equal(remoteFound.elements.length, 0);
  assert.match(remoteFound.text, /Read only: remote frame button Dispatch BP-1207/u);
  assert.ok(remoteFound.omitted.includes('remote_action'));
  const remoteQueue = await remote.driver.find({ tab_id: remote.tab, query: 'Queue' });
  assert.match(remoteQueue.text, /combobox Queue triage Triage Resolved/u);
  assert.doesNotMatch(JSON.stringify({ remoteFound, remoteQueue }), /PRIVATE_|INTERNAL_ROW/u);
  const remoteMiss = await remote.driver.find({ tab_id: remote.tab, query: 'INTERNAL_ROW' });
  assert.equal(remoteMiss.text, '');
  await assert.rejects(remote.driver.click({ tab_id: remote.tab, target: 'Dispatch BP-1207' }), /ref/u);
  assert.equal(effects.length, remoteBefore);
  await remote.page.evaluate(() => {
    const cover = document.createElement('div');
    cover.id = 'rich-cover';
    Object.assign(cover.style, { position: 'fixed', inset: '0', backgroundColor: 'white', zIndex: '100' });
    document.body.append(cover);
  });
  const coveredRemote = await remote.driver.find({ tab_id: remote.tab, query: 'BP-1207' });
  assert.equal(coveredRemote.text, '');
  assert.equal(coveredRemote.elements.length, 0);
  await remote.page.evaluate(() => document.querySelector('#rich-cover').remove());
  const revealedRemote = await remote.driver.find({ tab_id: remote.tab, query: 'BP-1207' });
  assert.match(revealedRemote.text, /Dispatch BP-1207/u);
  const replacedRemote = remote.page.waitForEvent(
    'framenavigated',
    (frame) => frame.url() === `${origin}/rich-child`,
  );
  await remote.page.evaluate((src) => {
    document.querySelector('iframe').src = src;
  }, `${origin}/rich-child`);
  await replacedRemote;
  await remote.page.frameLocator('iframe').locator('#dispatch').waitFor();
  const localFound = await remote.driver.find({ tab_id: remote.tab, query: 'BP-1207' });
  assert.equal(localFound.elements.length, 1);
  await remote.driver.click({ tab_id: remote.tab, target: localFound.elements[0].ref });
  await waitEffects(remoteBefore + 1);
  assert.deepEqual(effects.at(-1), { id: 'INTERNAL_ROW_1207', action: 'dispatch' });
  receipts.push(
    'exact remote child text/queue only, covered parent omits, reveal recovers, replacement same-origin supports one approved ref',
  );
  await remote.context.close();

  const limits = await session();
  await limits.page.evaluate(() => {
    const main = document.querySelector('main');
    main.replaceChildren();
    main.style.padding = '0';
    main.style.display = 'grid';
    main.style.gridTemplateColumns = 'repeat(12, 78px)';
    for (let index = 0; index < 106; index += 1) {
      const button = document.createElement('button');
      Object.assign(button.style, { padding: '2px', margin: '1px', fontSize: '9px', height: '27px' });
      button.textContent = index === 105 ? 'Unique after cap' : 'Noise';
      button.setAttribute('aria-label', button.textContent);
      main.append(button);
    }
  });
  const allLimited = await limits.driver.read_page({ tab_id: limits.tab, filter: 'interactive' });
  assert.equal(allLimited.elements.length, 100);
  assert.ok(allLimited.omitted.includes('target_limit'));
  const lateFound = await limits.driver.find({ tab_id: limits.tab, query: 'Unique after cap' });
  assert.equal(lateFound.elements.length, 1);
  await limits.page.evaluate(() => {
    const main = document.querySelector('main');
    for (let index = 0; index < 2100; index += 1) {
      const hiddenSibling = document.createElement('span');
      hiddenSibling.hidden = true;
      hiddenSibling.textContent = 'PRIVATE_MANY_HIDDEN';
      main.prepend(hiddenSibling);
    }
  });
  const pastWorkLimit = await limits.driver.find({ tab_id: limits.tab, query: 'Unique after cap' });
  assert.equal(pastWorkLimit.elements.length, 0);
  assert.ok(pastWorkLimit.omitted.includes('work_limit'));
  assert.doesNotMatch(JSON.stringify(pastWorkLimit), /PRIVATE_/u);
  await limits.page.evaluate(() => {
    document.querySelector('main').replaceChildren(document.createTextNode('🪴'.repeat(9000)));
  });
  const textLimit = await limits.driver.get_page_text({ tab_id: limits.tab });
  assert.ok(textLimit.omitted.includes('text_limit'));
  assert.ok(Buffer.byteLength(textLimit.text) <= 16_384);
  assert.ok(textLimit.text.isWellFormed());
  receipts.push(
    'find filters before 100 visible target cap; 2100 hidden siblings consume work; UTF8 text remains scalar and bounded',
  );
  await limits.context.close();

  const manyValues = Array.from({ length: 60 }, (_, index) => [
    `${origin}/fixture`,
    'T-1042',
    `field${index}`,
  ]);
  const aggregate = await session(manyValues);
  await aggregate.page.evaluate(() => {
    const main = document.querySelector('main');
    main.replaceChildren();
    Object.assign(main.style, { padding: '0', display: 'grid', gridTemplateColumns: 'repeat(10, 98px)' });
    for (let index = 0; index < 60; index += 1) {
      const select = document.createElement('select');
      Object.assign(select.style, { padding: '1px', margin: '1px', width: '95px', height: '34px' });
      select.dataset.browserField = `field${index}`;
      select.setAttribute('aria-label', `Choice ${index}`);
      for (let item = 0; item < 32; item += 1) {
        const option = document.createElement('option');
        option.value = 'x'.repeat(500) + item;
        option.textContent = 'Visible name '.repeat(19) + item;
        select.append(option);
      }
      main.append(select);
    }
  });
  const aggregateToolset = new BrowserToolset(aggregate.driver, {
    confirm: () => true,
    urlPolicy: () => true,
  });
  const many = await execute(aggregateToolset, 'read_page', { tab_id: aggregate.tab, filter: 'interactive' });
  assert.equal(many.ok, true);
  assert.ok(many.result.elements.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(many.result)) <= 65_536);
  assert.equal(many.result.omitted.filter((code) => code === 'report_limit').length, 1);
  receipts.push(
    'many independently legal options reach aggregate budget; SDK accepts <=64KiB projection and reports one limit',
  );
  await aggregate.context.close();

  const heldRemote = await session();
  await heldRemote.page.evaluate((src) => {
    document.querySelector('main').innerHTML = '<iframe></iframe>';
    document.querySelector('iframe').src = src;
  }, `${otherOrigin}/rich-child`);
  await heldRemote.page.frameLocator('iframe').locator('#dispatch').waitFor();
  const sampleFrame = await heldRemote.page.locator('iframe').elementHandle();
  const frameProto = Object.getPrototypeOf(sampleFrame);
  const ownEvaluate = Object.hasOwn(frameProto, 'evaluate');
  const frameEvaluate = frameProto.evaluate;
  const parentChecked = Promise.withResolvers();
  const releaseParent = Promise.withResolvers();
  let heldOnce = false;
  frameProto.evaluate = async function evaluate(fn, argument) {
    const answer = await frameEvaluate.call(this, fn, argument);
    if (!heldOnce && argument && typeof argument.x === 'number' && typeof argument.y === 'number') {
      heldOnce = true;
      parentChecked.resolve();
      await releaseParent.promise;
    }
    return answer;
  };
  const heldEffects = effects.length;
  try {
    const reading = heldRemote.driver.find({ tab_id: heldRemote.tab, query: 'BP-1207' });
    await parentChecked.promise;
    await heldRemote.page.evaluate(() => {
      const blocker = document.createElement('div');
      Object.assign(blocker.style, {
        position: 'fixed',
        inset: '0',
        backgroundColor: 'white',
        zIndex: '1000',
      });
      document.body.append(blocker);
    });
    releaseParent.resolve();
    const afterCover = await reading;
    assert.equal(afterCover.elements.length, 0);
    assert.ok(afterCover.omitted.includes('remote_action'));
    const gated = new BrowserToolset(heldRemote.driver, { confirm: () => true, urlPolicy: () => true });
    const forged = await execute(gated, 'click', { tab_id: heldRemote.tab, target: 'Dispatch BP-1207' });
    assert.equal(forged.ok, false);
    assert.equal(effects.length, heldEffects);
    receipts.push(
      'held remote parent check then CSS cover: explicitly read-only partial result; approved forged remote click causes zero effects',
    );
  } finally {
    releaseParent.resolve();
    if (ownEvaluate) {
      frameProto.evaluate = frameEvaluate;
    } else {
      delete frameProto.evaluate;
    }
    await sampleFrame.dispose();
    await heldRemote.context.close();
  }

  const boundedRoots = await session();
  await boundedRoots.page.evaluate(async () => {
    const main = document.querySelector('main');
    main.replaceChildren();
    const loads = [];
    for (let index = 0; index < 17; index += 1) {
      const frame = document.createElement('iframe');
      const loaded = Promise.withResolvers();
      frame.addEventListener('load', loaded.resolve, { once: true });
      loads.push(loaded.promise);
      main.append(frame);
    }
    await Promise.all(loads);
  });
  const manyFrames = await boundedRoots.driver.get_page_text({ tab_id: boundedRoots.tab });
  assert.ok(manyFrames.omitted.includes('frame_limit'));
  assert.ok(manyFrames.omitted.includes('unsupported_root'));
  await boundedRoots.page.evaluate(() => {
    const main = document.querySelector('main');
    main.replaceChildren();
    let parent = main;
    for (let index = 0; index < 9; index += 1) {
      const host = document.createElement('div');
      parent.append(host);
      parent = host.attachShadow({ mode: 'open' });
    }
    const beyond = document.createElement('button');
    beyond.textContent = 'Outside proved depth';
    parent.append(beyond);
  });
  const tooDeep = await boundedRoots.driver.find({ tab_id: boundedRoots.tab, query: 'Outside proved depth' });
  assert.equal(tooDeep.elements.length, 0);
  assert.ok(tooDeep.omitted.includes('frame_limit'));
  const rootEffects = effects.length;
  await assert.rejects(
    boundedRoots.driver.click({ tab_id: boundedRoots.tab, target: 'Outside proved depth' }),
    /ref/u,
  );
  assert.equal(effects.length, rootEffects);
  receipts.push(
    '17 frames and nine nested open shadow levels disclose frame limits, no unobserved target can act',
  );
  await boundedRoots.context.close();

  // Independent review regressions share the real owned fixture and installed helper.
  const reviewFailures = [];
  const guardedText = await session();
  try {
    const guardedTools = new BrowserToolset(guardedText.driver, {
      confirm: () => true,
      urlPolicy: () => true,
    });
    await guardedText.page.evaluate((src) => {
      const frame = document.createElement('iframe');
      frame.id = 'private-read-child';
      Object.assign(frame.style, {
        position: 'fixed',
        left: '150px',
        top: '10px',
        width: '720px',
        height: '580px',
        zIndex: '10',
      });
      const loaded = Promise.withResolvers();
      frame.addEventListener('load', loaded.resolve, { once: true });
      frame.src = src;
      document.body.append(frame);
      return loaded.promise;
    }, `${origin}/rich-child`);
    const released = [];
    for (const privateFrame of [false, true, false]) {
      // Real private ancestor mutations do not navigate or change the event sequence.
      // oxlint-disable-next-line no-await-in-loop
      await guardedText.page.locator('#private-read-child').evaluate((frame, conceal) => {
        if (conceal) {
          frame.dataset.browserPrivate = '';
        } else {
          delete frame.dataset.browserPrivate;
        }
      }, privateFrame);
      // oxlint-disable-next-line no-await-in-loop
      const full = await execute(guardedTools, 'read_page', { tab_id: guardedText.tab, filter: 'all' });
      // oxlint-disable-next-line no-await-in-loop
      const text = await execute(guardedTools, 'get_page_text', { tab_id: guardedText.tab });
      assert.equal(full.ok, true);
      assert.equal(text.ok, true);
      released.push({
        privateFrame,
        inFull: full.result.text.includes('Dispatch BP-1207'),
        inText: text.result.text.includes('Dispatch BP-1207'),
        issued: full.result.elements.some((element) => element.label === 'Dispatch BP-1207'),
      });
    }
    assert.deepEqual(released, [
      { privateFrame: false, inFull: true, inText: true, issued: true },
      { privateFrame: true, inFull: false, inText: false, issued: false },
      { privateFrame: false, inFull: true, inText: true, issued: true },
    ]);
    receipts.push(
      'N-RICH-1: both SDK reads hide private same-origin iframe text and refs, both return after reveal',
    );
  } catch (error) {
    reviewFailures.push(new Error('N-RICH-1 same-origin private frame text', { cause: error }));
  } finally {
    await guardedText.context.close();
  }

  const disabledGroup = await session();
  try {
    const disabledTools = new BrowserToolset(disabledGroup.driver, {
      confirm: () => true,
      urlPolicy: () => true,
    });
    const beforeGroup = await read(disabledGroup.driver, disabledGroup.tab);
    await disabledGroup.page.evaluate(() => {
      const input = document.querySelector('input[type=text]');
      const fieldset = document.createElement('fieldset');
      input.replaceWith(fieldset);
      fieldset.append(input);
      fieldset.disabled = true;
    });
    const initial = await disabledGroup.page.locator('input[type=text]').evaluate((input) => ({
      effective: input.matches(':disabled'),
      property: input.disabled,
      value: input.value,
    }));
    assert.deepEqual(initial, { effective: true, property: false, value: '' });
    const groupRefused = await execute(disabledTools, 'type', {
      tab_id: disabledGroup.tab,
      target: beforeGroup.ref('Guest'),
      text: 'Must be groupRefused',
    });
    assert.equal(groupRefused.ok, false);
    assert.equal(await disabledGroup.page.locator('input[type=text]').inputValue(), '');
    const unavailable = await read(disabledGroup.driver, disabledGroup.tab);
    assert.ok(unavailable.elements.every((element) => element.label !== 'Guest'));
    await disabledGroup.page.locator('fieldset').evaluate((fieldset) => {
      fieldset.disabled = false;
    });
    const enabled = await read(disabledGroup.driver, disabledGroup.tab);
    const typed = await execute(disabledTools, 'type', {
      tab_id: disabledGroup.tab,
      target: enabled.ref('Guest'),
      text: 'Allowed when enabled',
    });
    assert.equal(typed.ok, true);
    assert.equal(await disabledGroup.page.locator('input[type=text]').inputValue(), 'Allowed when enabled');
    receipts.push(
      'N-RICH-2: effective disabled fieldset blocks already-issued ref and new issuance; enable then fresh ref works',
    );
  } catch (error) {
    reviewFailures.push(new Error('N-RICH-2 inherited disabled fieldset', { cause: error }));
  } finally {
    await disabledGroup.context.close();
  }

  const normalizedQuery = await session();
  try {
    await normalizedQuery.driver.navigate({ tab_id: normalizedQuery.tab, url: `${origin}/rich-child` });
    const canonical = await normalizedQuery.driver.find({
      tab_id: normalizedQuery.tab,
      query: 'dispatch BP-1207',
    });
    assert.equal(canonical.elements.length, 1);
    const equivalent = await normalizedQuery.driver.find({
      tab_id: normalizedQuery.tab,
      query: '  dispatch\n  BP-1207  ',
    });
    assert.deepEqual(
      equivalent.elements.map(({ role, label }) => ({ role, label })),
      canonical.elements.map(({ role, label }) => ({ role, label })),
    );
    const previous = effects.length;
    await assert.rejects(
      normalizedQuery.driver.click({ tab_id: normalizedQuery.tab, target: canonical.elements[0].ref }),
      /ref/u,
    );
    assert.equal(effects.length, previous);
    await normalizedQuery.driver.click({ tab_id: normalizedQuery.tab, target: equivalent.elements[0].ref });
    await waitEffects(previous + 1);
    assert.deepEqual(effects.at(-1), { id: 'INTERNAL_ROW_1207', action: 'dispatch' });
    receipts.push(
      'N-RICH-3: whitespace-normalized queries match same visible label, invalidate prior ref and preserve fresh action',
    );
  } catch (error) {
    reviewFailures.push(new Error('N-RICH-3 normalized find query', { cause: error }));
  } finally {
    await normalizedQuery.context.close();
  }
  if (reviewFailures.length) {
    throw new AggregateError(reviewFailures, 'Independent rich-read regressions failed');
  }
  await a.context.close();
  await b.context.close();
  console.log(JSON.stringify({ success: true, kind: 'local Chromium; no APIs', receipts }));
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
