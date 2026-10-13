// Launcher-owned forms, actual Chromium, and independent native/event oracles. No API access.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createBrowserDriver } from './driver.mjs';

const fixture = `<!doctype html><title>Local forms</title>
<style>body{font:16px sans-serif}label{display:inline-block;margin:9px}
select[multiple]{height:95px;width:120px}input,textarea{min-height:24px}output{display:block}</style>
<section data-record-id="A"><form id="order">
<label>Name<input data-browser-field="name" name="name" aria-label="Name"></label>
<label>Notes<textarea data-browser-field="notes" name="notes" aria-label="Notes"></textarea></label>
<label>Date<input data-browser-field="date" type="date" name="date" aria-label="Date"
  min="2026-01-01" max="2026-12-31"></label>
<label>Level<input data-browser-field="level" type="range" name="level" aria-label="Level"
  min="10" max="50" step="2" value="20"></label><br>
<label>Consent<input data-browser-field="consent" type="checkbox" name="consent" aria-label="Consent"></label>
<label>Fast<input data-browser-field="speed" type="radio" name="speed" value="fast" aria-label="Fast" checked></label>
<label>Slow<input data-browser-field="speed" type="radio" name="speed" value="slow" aria-label="Slow"></label>
<label>Independent<input type="radio" aria-label="Independent" checked></label>
<label>Another<input type="radio" aria-label="Another"></label><br>
<label>Seat<select name="seat" data-browser-field="seat" aria-label="Seat">
  <option value="inside">Inside</option><option value="patio">Patio</option>
  <optgroup label="Closed" disabled><option value="closed">Closed</option></optgroup></select></label>
<label>Teams<select multiple name="teams" data-browser-field="teams" aria-label="Teams">
  <option value="red" selected>Red</option><option value="green">Green</option><option value="blue">Blue</option>
  <optgroup label="Closed" disabled><option value="closed">Closed</option></optgroup></select></label>
</form>
<label>Outside<input form="order" data-browser-field="speed" type="radio" name="speed" value="outside"
  aria-label="Outside"></label>
<fieldset disabled><label>Disabled<input name="disabled" aria-label="Disabled"></label></fieldset>
<input readonly aria-label="Readonly"><input hidden aria-label="Hidden">
<input type="password" aria-label="Password" value="PRIVATE_PASSWORD">
<div role="checkbox" aria-label="Custom checkbox">Custom</div>
<div contenteditable="true" aria-label="Custom editor">Custom editor</div>
</section>
<section id="other" data-record-id="B"></section><output id="receipt"></output>
<script>
window.observed = [];
for (const kind of ['input', 'change']) document.addEventListener(kind, event => {
  if (event.target.matches('input,textarea,select')) {
    observed.push({ kind, field:event.target.getAttribute('aria-label'), trusted:event.isTrusted });
    receipt.textContent = 'Updated ' + event.target.getAttribute('aria-label') + ': ' + kind;
  }
});
</script>`;
const frameFixture = `<!doctype html><title>Installed child</title>
<section data-record-id="A"><label>Frame consent
<input aria-label="Frame consent" type="checkbox" data-browser-field="consent">
</label><output></output></section>
<script>document.addEventListener('change', event => {
  document.querySelector('output').textContent = event.target.checked ? 'Acknowledged' : 'Pending';
});</script>`;
const server = createServer((request, response) => {
  response
    .writeHead(200, { 'content-type': 'text/html' })
    .end(request.url === '/frame' ? frameFixture : fixture);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const urls = ['/forms', '/other', '/frame'].map((path) => origin + path);
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
    viewport: { width: 1200, height: 950 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const driver = createBrowserDriver(context, { ownedFixture: { urls, publicValues } });
  const tab = await driver.new_tab({ url: urls[0] });
  const policy = { confirm: () => true, urlPolicy: () => true };
  const tools = new BrowserToolset(driver, policy);
  return { context, driver, tab, tools, policy, page: context.pages()[0] };
}
async function execute(view, name, args) {
  const output = await view.tools.execute({
    type: 'function_call',
    status: 'completed',
    name: `browser_${name}`,
    arguments: JSON.stringify({ tab_id: view.tab, ...args }),
    call_id: 'owned-forms',
  });
  return JSON.parse(output.output[0].text);
}
async function read(view) {
  const result = await execute(view, 'read_page', { filter: 'interactive' });
  assert.equal(result.ok, true);
  return result.result;
}
function ref(report, label) {
  const item = report.elements.find((element) => element.label === label);
  assert.ok(item, `No issued ref for ${label}: ${JSON.stringify(report)}`);
  return item.ref;
}
async function oracle(view) {
  return view.page.evaluate(() => ({
    values: [...new FormData(document.querySelector('#order'))],
    checked: [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].map((node) => ({
      label: node.getAttribute('aria-label'),
      checked: node.checked,
    })),
    selected: [...document.querySelectorAll('select')].map((node) =>
      [...node.selectedOptions].map((item) => item.value),
    ),
    events: structuredClone(window.observed),
    receipt: document.querySelector('#receipt').textContent,
  }));
}
async function action(view, label, member, args) {
  const report = await read(view);
  const before = await oracle(view);
  const response = await execute(view, member, { target: ref(report, label), ...args });
  return { before, after: await oracle(view), response };
}
async function rejected(view, label, member, args) {
  const result = await action(view, label, member, args);
  assert.equal(result.response.ok, false, `Expected refusal for ${label}`);
  assert.deepEqual(result.after, result.before, `Refusal changed form or event state: ${label}`);
  assert.equal(view.driver.hasUncertainEffects(), false);
}
function events(result, label, kinds) {
  assert.equal(result.response.ok, true);
  assert.deepEqual(
    result.after.events.slice(result.before.events.length).map((event) => [event.field, event.kind]),
    kinds.map((kind) => [label, kind]),
  );
  assert.equal(result.after.receipt, `Updated ${label}: ${kinds.at(-1)}`);
}
const grants = ['name', 'notes', 'date', 'level', 'consent', 'speed', 'seat', 'teams'].map((field) => [
  urls[0],
  'A',
  field,
]);
try {
  const main = await session(grants);
  try {
    const original = await read(main);
    assert.equal(original.elements.find((el) => el.label === 'Consent').checked, false);
    assert.equal(original.elements.find((el) => el.label === 'Teams').role, 'listbox');
    assert.deepEqual(
      original.elements.find((el) => el.label === 'Teams').options.map((el) => el.selected),
      [true, false, false, false],
    );
    for (const label of ['Disabled', 'Readonly', 'Hidden', 'Password', 'Custom checkbox', 'Custom editor']) {
      assert.equal(
        original.elements.some((el) => el.label === label),
        false,
      );
    }
    assert.ok(original.omitted.includes('unsupported_control'));
    assert.ok(original.omitted.includes('private'));
    const text = await action(main, 'Name', 'type', { text: 'Ada' });
    events(text, 'Name', ['input']);
    assert.deepEqual(
      text.after.values.find(([key]) => key === 'name'),
      ['name', 'Ada'],
    );
    const notes = await action(main, 'Notes', 'type', { text: 'Line 1\nLine 2' });
    events(notes, 'Notes', ['input']);
    assert.deepEqual(
      notes.after.values.find(([key]) => key === 'notes'),
      ['notes', 'Line 1\nLine 2'],
    );
    const date = await action(main, 'Date', 'type', { text: '2026-10-10' });
    events(date, 'Date', ['input', 'change']);
    assert.deepEqual(
      date.after.values.find(([key]) => key === 'date'),
      ['date', '2026-10-10'],
    );
    const clear = await action(main, 'Date', 'type', { text: '' });
    events(clear, 'Date', ['input', 'change']);
    assert.deepEqual(
      clear.after.values.find(([key]) => key === 'date'),
      ['date', ''],
    );
    const range = await action(main, 'Level', 'type', { text: '42' });
    events(range, 'Level', ['input', 'change']);
    assert.deepEqual(
      range.after.values.find(([key]) => key === 'level'),
      ['level', '42'],
    );
    for (const [label, textValue] of [
      ['Date', '10/10/2026'],
      ['Date', '2027-01-01'],
      ['Date', '2026-02-30'],
      ['Level', '51'],
      ['Level', '41'],
      ['Level', 'number'],
    ]) {
      // A later refusal observes the form left by the preceding check.
      // oxlint-disable-next-line no-await-in-loop
      await rejected(main, label, 'type', { text: textValue });
    }
    await main.page.locator('[name=date]').evaluate((node) => {
      node.required = true;
    });
    await rejected(main, 'Date', 'type', { text: '' });
    await main.page.locator('[name=date]').evaluate((node) => {
      node.required = false;
    });
    // Without min, the native step base comes from the value content attribute,
    // independent of the mutable current value property and read grants.
    await main.page.locator('[name=date]').evaluate((node) => {
      node.removeAttribute('min');
      node.removeAttribute('max');
      node.setAttribute('step', '2');
      node.setAttribute('value', '1970-01-02');
    });
    await main.page.locator('[name=level]').evaluate((node) => {
      node.removeAttribute('min');
      node.removeAttribute('max');
      node.setAttribute('step', '2');
      node.setAttribute('value', '1');
    });
    await rejected(main, 'Date', 'type', { text: '1970-01-03' });
    await rejected(main, 'Level', 'type', { text: '2' });
    const steppedDate = await action(main, 'Date', 'type', { text: '1970-01-04' });
    events(steppedDate, 'Date', ['input', 'change']);
    assert.deepEqual(
      steppedDate.after.values.find(([key]) => key === 'date'),
      ['date', '1970-01-04'],
    );
    const steppedRange = await action(main, 'Level', 'type', { text: '3' });
    events(steppedRange, 'Level', ['input', 'change']);
    assert.deepEqual(
      steppedRange.after.values.find(([key]) => key === 'level'),
      ['level', '3'],
    );
    receipts.push(
      'text/textarea literal input; exact date/range input+change; invalid values cause no mutation or event',
    );

    const single = await action(main, 'Seat', 'select_option', { values: ['patio'] });
    events(single, 'Seat', ['input', 'change']);
    assert.deepEqual(
      single.after.values.find(([key]) => key === 'seat'),
      ['seat', 'patio'],
    );
    for (const values of [[], ['blue'], ['green', 'blue']]) {
      // Multiselect complete replacement is checked after each independent action.
      // oxlint-disable-next-line no-await-in-loop
      const result = await action(main, 'Teams', 'select_option', { values });
      events(result, 'Teams', ['input', 'change']);
      assert.deepEqual(
        result.after.values.filter(([key]) => key === 'teams').map(([, value]) => value),
        values,
      );
    }
    for (const values of [
      ['red', 'not-present'],
      ['red', 'red'],
      ['red', 'closed'],
    ]) {
      // Validate the entire set before accepting any requested option.
      // oxlint-disable-next-line no-await-in-loop
      await rejected(main, 'Teams', 'select_option', { values });
    }
    await rejected(main, 'Seat', 'select_option', { values: [] });
    await main.page.locator('[value=green]').evaluate((option) => {
      option.dataset.browserPrivate = '';
    });
    await rejected(main, 'Teams', 'select_option', { values: ['red'] });
    await main.page.locator('[value=green]').evaluate((option) => {
      delete option.dataset.browserPrivate;
    });
    await main.page.locator('select[name=teams]').evaluate((node) => {
      const duplicate = document.createElement('option');
      duplicate.value = 'red';
      duplicate.textContent = 'Second red';
      node.append(duplicate);
    });
    await rejected(main, 'Teams', 'select_option', { values: ['red'] });
    receipts.push(
      'single/multiselect native state and input+change; empty sets; atomic invalid/disabled/private/ambiguous rejection',
    );

    const check = await action(main, 'Consent', 'click', {});
    events(check, 'Consent', ['input', 'change']);
    assert.equal(check.after.checked.find((field) => field.label === 'Consent').checked, true);
    const radio = await action(main, 'Outside', 'click', {});
    events(radio, 'Outside', ['input', 'change']);
    assert.deepEqual(
      radio.after.values.find(([key]) => key === 'speed'),
      ['speed', 'outside'],
    );
    const already = await action(main, 'Outside', 'click', {});
    assert.equal(already.response.ok, true);
    assert.deepEqual(already.after.events, already.before.events);
    const unnamed = await action(main, 'Another', 'click', {});
    events(unnamed, 'Another', ['input', 'change']);
    assert.equal(unnamed.after.checked.find((field) => field.label === 'Independent').checked, true);
    receipts.push(
      'native checkbox toggle, named external radio peer and unnamed independent radio; checked no-op emits no new events',
    );

    const privateText = await execute(main, 'get_page_text', {});
    assert.equal(privateText.ok, true);
    assert.deepEqual(privateText.result.elements, []);
    assert.doesNotMatch(JSON.stringify(privateText.result), /Line 1|2026-10-10|PRIVATE_PASSWORD/u);
    await main.driver.navigate({ tab_id: main.tab, url: urls[1] });
    const copied = await read(main);
    for (const item of copied.elements) {
      assert.equal(
        Object.hasOwn(item, 'value') || Object.hasOwn(item, 'options') || Object.hasOwn(item, 'checked'),
        false,
      );
    }
    assert.ok(copied.omitted.includes('value'));
    receipts.push(
      'only exact document/record/field grants release values; text-only and copied document reveal no form values',
    );
  } finally {
    await main.context.close();
  }

  const held = await session(grants);
  try {
    for (const [label, change] of [
      ['Consent', 'toggle'],
      ['Fast', 'peer'],
      ['Slow', 'retype'],
      ['Outside', 'off-record'],
      ['Fast', 'replace-peer'],
    ]) {
      // Each held approval has its own fresh fixture and a current issued ref.
      // oxlint-disable-next-line no-await-in-loop
      await held.driver.navigate({ tab_id: held.tab, url: 'reload' });
      // oxlint-disable-next-line no-await-in-loop
      const report = await read(held);
      let atApproval;
      held.policy.confirm = async () => {
        await held.page.evaluate((kind) => {
          if (kind === 'toggle') {
            document.querySelector('[name=consent]').checked = true;
          }
          if (kind === 'peer') {
            document.querySelector('[value=outside]').checked = true;
          }
          if (kind === 'retype') {
            document.querySelector('[value=slow]').type = 'text';
          }
          if (kind === 'off-record') {
            document.querySelector('#other').append(document.querySelector('[value=outside]'));
          }
          if (kind === 'replace-peer') {
            const peer = document.querySelector('[value=slow]');
            peer.replaceWith(peer.cloneNode(true));
          }
        }, change);
        atApproval = await oracle(held);
        return true;
      };
      // oxlint-disable-next-line no-await-in-loop
      const response = await execute(held, 'click', { target: ref(report, label) });
      assert.equal(response.ok, false, `Held ${change} ref should be refused`);
      // oxlint-disable-next-line no-await-in-loop
      assert.deepEqual(await oracle(held), atApproval);
      assert.equal(held.driver.hasUncertainEffects(), false);
      held.policy.confirm = () => true;
    }
    receipts.push(
      'held checkbox/radio approvals refuse changed values, group selection/record/type or replaced peers',
    );
  } finally {
    await held.context.close();
  }

  const covered = await session();
  try {
    const report = await read(covered);
    await covered.page.locator('[name=notes]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      const cover = document.createElement('div');
      Object.assign(cover.style, {
        position: 'fixed',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        zIndex: '2000',
        background: 'white',
      });
      document.body.append(cover);
    });
    const before = await oracle(covered);
    const blocked = await execute(covered, 'type', { target: ref(report, 'Notes'), text: 'Blocked' });
    assert.equal(blocked.ok, false);
    assert.deepEqual(await oracle(covered), before);
    const unbound = await execute(covered, 'type', { target: null, text: 'No focus fallback' });
    assert.equal(unbound.ok, false);
    assert.deepEqual(await oracle(covered), before);
    receipts.push('covered textarea and unbound type refuse without effects; no owned key member');
    assert.equal(
      covered.tools.tools().some((tool) => tool.name === 'browser_key'),
      false,
    );
  } finally {
    await covered.context.close();
  }

  const mounted = await session([
    [urls[2], 'A', 'consent'],
    [urls[0], 'A', 'shadowNotes'],
  ]);
  try {
    // Small installed fixture with two mounted roots. Effect oracles read the
    // actual textarea/child checkbox and each fixture's event-driven receipt.
    await mounted.page.evaluate((frameURL) => {
      document.body.innerHTML =
        '<section data-record-id="A"><div id="host"></div></section><iframe id="child" title="Installed child"></iframe>';
      const shadow = document.querySelector('#host').attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<label>Shadow notes<textarea aria-label="Shadow notes" data-browser-field="shadowNotes"></textarea></label><output></output>';
      shadow.addEventListener('input', () => {
        shadow.querySelector('output').textContent = 'Notes updated';
      });
      const frame = document.querySelector('#child');
      Object.assign(frame.style, { width: '500px', height: '200px' });
      frame.src = frameURL;
    }, urls[2]);
    await mounted.page.frameLocator('#child').getByLabel('Frame consent').waitFor();
    const roots = () =>
      mounted.page.evaluate(() => {
        const shadow = document.querySelector('#host').shadowRoot;
        const child = document.querySelector('#child').contentDocument;
        return {
          notes: shadow.querySelector('textarea').value,
          noteReceipt: shadow.querySelector('output').textContent,
          checked: child.querySelector('input').checked,
          frameReceipt: child.querySelector('output').textContent,
        };
      });
    let report = await read(mounted);
    assert.equal(report.elements.find((item) => item.label === 'Frame consent').checked, false);
    const noted = await execute(mounted, 'type', { target: ref(report, 'Shadow notes'), text: 'Mounted' });
    assert.equal(noted.ok, true);
    assert.deepEqual(await roots(), {
      notes: 'Mounted',
      noteReceipt: 'Notes updated',
      checked: false,
      frameReceipt: '',
    });
    report = await read(mounted);
    const clicked = await execute(mounted, 'click', { target: ref(report, 'Frame consent') });
    assert.equal(clicked.ok, true);
    assert.deepEqual(await roots(), {
      notes: 'Mounted',
      noteReceipt: 'Notes updated',
      checked: true,
      frameReceipt: 'Acknowledged',
    });
    report = await read(mounted);
    await mounted.page.locator('#child').evaluate((frame) => {
      const bounds = frame.getBoundingClientRect();
      const cover = document.createElement('div');
      Object.assign(cover.style, {
        position: 'fixed',
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        zIndex: '2000',
        background: 'white',
      });
      document.body.append(cover);
    });
    const before = await roots();
    const obscured = await execute(mounted, 'click', { target: ref(report, 'Frame consent') });
    assert.equal(obscured.ok, false);
    assert.deepEqual(await roots(), before);
    receipts.push(
      'open-shadow textarea and installed same-origin frame checkbox native values/events; held ref covered ancestor refuses',
    );
  } finally {
    await mounted.context.close();
  }

  const submission = await session();
  try {
    for (const [length, required, permitted] of [
      [3, false, true],
      [2400, false, false],
      [3, true, false],
      [3, false, true],
    ]) {
      // Each native form replaces the previous form; a fresh SDK read must
      // validate the newly issued ref against that form before clicking.
      // oxlint-disable-next-line no-await-in-loop
      await submission.page.evaluate(
        ({ count, needsInput }) => {
          document.body.innerHTML =
            '<section data-record-id="A"><form id="order"><button aria-label="Send">Send</button><div id="fields"></div></form><output id="receipt"></output></section>';
          const form = document.querySelector('#order');
          const fields = form.querySelector('#fields');
          for (let index = 0; index < count; index += 1) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = `fixture${index}`;
            input.value = '0';
            fields.append(input);
          }
          if (needsInput) {
            const input = document.createElement('input');
            input.setAttribute('aria-label', 'Required field');
            input.required = true;
            fields.append(input);
          }
          window.submission = { clicks: 0, invalid: 0, sent: 0 };
          form.addEventListener('click', () => {
            window.submission.clicks += 1;
          });
          form.addEventListener(
            'invalid',
            () => {
              window.submission.invalid += 1;
            },
            true,
          );
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            window.submission.sent += 1;
            document.querySelector('#receipt').textContent = 'Sent';
          });
        },
        { count: length, needsInput: required },
      );
      // oxlint-disable-next-line no-await-in-loop
      const report = await read(submission);
      if (length > 2000) {
        assert.ok(report.omitted.includes('work_limit'));
      }
      // oxlint-disable-next-line no-await-in-loop
      const result = await execute(submission, 'click', { target: ref(report, 'Send') });
      assert.equal(
        result.ok,
        permitted,
        `Unexpected submit result: controls=${length}, required=${required}`,
      );
      // Independent native events and fixture outcome: refused forms must not
      // even click or cause native invalid events before submission.
      // oxlint-disable-next-line no-await-in-loop
      const actual = await submission.page.evaluate(() => ({
        ...window.submission,
        receipt: document.querySelector('#receipt').textContent,
        controls: document.querySelector('#order').elements.length,
      }));
      assert.deepEqual(actual, {
        clicks: permitted ? 1 : 0,
        invalid: 0,
        sent: permitted ? 1 : 0,
        receipt: permitted ? 'Sent' : '',
        controls: length + 1 + Number(required),
      });
      assert.equal(submission.driver.hasUncertainEffects(), false);
    }
    receipts.push(
      'submit validation shares the action work limit: early ref on oversized form refuses before click; invalid small form emits no invalid or click; fresh small valid form submits',
    );
  } finally {
    await submission.context.close();
  }

  const recycled = await session(grants);
  try {
    const report = await read(recycled);
    const changes = [];
    await recycled.page.exposeFunction('changedRecord', (id) => changes.push(id));
    await recycled.page.locator('select[name=seat]').evaluate((node) => {
      node.addEventListener(
        'input',
        () => {
          node.closest('[data-record-id]').dataset.recordId = 'RECYCLED';
        },
        { once: true },
      );
      node.addEventListener('change', () => {
        void window.changedRecord(node.closest('[data-record-id]').dataset.recordId);
      });
    });
    await assert.rejects(
      execute(recycled, 'select_option', { target: ref(report, 'Seat'), values: ['patio'] }),
      /state report failed|retired/u,
    );
    assert.equal(recycled.driver.hasUncertainEffects(), true);
    assert.deepEqual(changes, []);
    await assert.rejects(
      recycled.driver.read_page({ tab_id: recycled.tab, filter: 'interactive' }),
      /retired/u,
    );
    receipts.push(
      'input recycled record before change: no change dispatched to new record, owned context retired',
    );
  } finally {
    await recycled.context.close();
  }
  for (const event of ['input', 'change']) {
    // oxlint-disable-next-line no-await-in-loop
    const restored = await session(grants);
    try {
      // oxlint-disable-next-line no-await-in-loop
      const report = await read(restored);
      // oxlint-disable-next-line no-await-in-loop
      await restored.page.locator('select[name=seat]').evaluate((node, kind) => {
        node.addEventListener(
          kind,
          () => {
            node.value = 'inside';
          },
          { once: true },
        );
      }, event);
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(
        execute(restored, 'select_option', {
          target: ref(report, 'Seat'),
          values: ['patio'],
        }),
        /state report failed|retired/u,
      );
      assert.equal(restored.driver.hasUncertainEffects(), true);
      receipts.push(`select restored during ${event}: unknown result, retired before retry`);
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await restored.context.close();
    }
  }
  for (const [label, selector, event, text] of [
    ['Name', 'input[name=name]', 'input', 'Local note'],
    ['Notes', 'textarea', 'input', 'Local note'],
    ['Date', 'input[name=date]', 'change', '2026-10-10'],
    ['Level', 'input[name=level]', 'change', '42'],
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    const restored = await session(grants);
    try {
      // oxlint-disable-next-line no-await-in-loop
      const report = await read(restored);
      // oxlint-disable-next-line no-await-in-loop
      await restored.page.locator(selector).evaluate((node, kind) => {
        node.addEventListener(
          kind,
          () => {
            node.value = '';
          },
          { once: true },
        );
      }, event);
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(
        execute(restored, 'type', { target: ref(report, label), text }),
        /state report failed|retired/u,
      );
      assert.equal(restored.driver.hasUncertainEffects(), true);
      receipts.push(`type ${label} reverted on ${event}: unknown and retired`);
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await restored.context.close();
    }
  }
  for (const [member, label, args] of [
    ['click', 'Consent', {}],
    ['type', 'Name', { text: 'Local note' }],
    ['select_option', 'Seat', { values: ['patio'] }],
    ['set_checked', 'Consent', { checked: true }],
    ['scroll_to', 'Name', {}],
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    const stopped = await session(grants);
    let prototype;
    let original;
    try {
      // oxlint-disable-next-line no-await-in-loop
      const report = await read(stopped);
      const actionArgs = { tab_id: stopped.tab, target: ref(report, label), ...args };
      // Already-cancelled work has not dispatched; the same ref remains usable.
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(stopped.driver[member](actionArgs, { signal: AbortSignal.abort() }));
      assert.equal(stopped.driver.hasUncertainEffects(), false);
      // A local transport holds the acknowledgement after applying the real DOM input.
      // oxlint-disable-next-line no-await-in-loop
      const handle = await stopped.page.$('#order');
      prototype = Object.getPrototypeOf(handle);
      original = prototype.evaluate;
      const applied = Promise.withResolvers();
      const release = Promise.withResolvers();
      prototype.evaluate = async function evaluate(expression, data) {
        const result = await original.call(this, expression, data);
        if (data?.action === member) {
          applied.resolve();
          await release.promise;
        }
        return result;
      };
      const signal = new AbortController();
      const work = stopped.driver[member](actionArgs, { signal: signal.signal });
      const failed = assert.rejects(work, /retired/u);
      // oxlint-disable-next-line no-await-in-loop
      await applied.promise;
      signal.abort();
      release.resolve();
      // oxlint-disable-next-line no-await-in-loop
      await failed;
      assert.equal(stopped.driver.hasUncertainEffects(), true);
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(stopped.driver[member](actionArgs), /retired/u);
      receipts.push(`${member}: cancelled before dispatch is reusable; cancellation after dispatch retires`);
    } finally {
      if (prototype && original) {
        prototype.evaluate = original;
      }
      // oxlint-disable-next-line no-await-in-loop
      await stopped.context.close();
    }
  }
  console.log(JSON.stringify({ success: true, kind: 'local Chromium forms, no APIs', receipts }));
} finally {
  await browser.close();
  await promisify(server.close.bind(server))();
}
