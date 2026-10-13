import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { BrowserToolset } from 'openai/helpers/browser';

let sequence = 0;
export async function inspectCall(helper, member, args, options) {
  sequence += 1;
  const result = await helper.execute(
    {
      type: 'function_call',
      id: `inspector-${sequence}`,
      call_id: `local-${sequence}`,
      status: 'completed',
      name: `browser_${member}`,
      arguments: JSON.stringify(args),
    },
    options,
  );
  return JSON.parse(result.output[0].text);
}

// Runs on any isolated partial driver implementing state and read_page.
// The launcher, not the driver, chooses whether the private read is approved.
export async function checkPartialDriver(driver) {
  let approved = false;
  const helper = new BrowserToolset(driver, {
    members: ['list_tabs', 'read_page'],
    confirmReads: ['read_page'],
    confirm: () => approved,
  });
  const state = await inspectCall(helper, 'list_tabs', {});
  assert.equal(state.ok, true, 'state must pass SDK validation');
  const denied = await inspectCall(helper, 'read_page', { tab_id: null, filter: 'all' });
  assert.equal(denied.ok, false, 'private read needs consent');
  assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_INSPECTOR_SENTINEL/u);
  approved = true;
  const read = await inspectCall(helper, 'read_page', { tab_id: null, filter: 'all' });
  assert.equal(read.ok, true, 'approved read must return a supported result');
  await assert.rejects(
    inspectCall(helper, 'click', { tab_id: null, target: 'never-advertised' }),
    /registered/iu,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectCall(helper, 'read_page', { tab_id: null, filter: 'all' }, { signal: controller.signal }),
  );
  helper.close();
  await assert.rejects(inspectCall(helper, 'list_tabs', {}));
  return { state: true, privateRead: true, approvedRead: true, disabled: true, stop: true, close: true };
}

export function memoryDriver() {
  return {
    async state() {
      return { tabs: [{ id: 'local', title: 'Read only list', url: 'about:blank', active: true }] };
    },
    async read_page() {
      return { version: 1, text: 'Locally supplied rows: Amber, Birch.', elements: [], omitted: [] };
    },
  };
}

export async function openInspector(run) {
  const { chromium } = await import('playwright');
  const { createBrowserDriver, exampleBrowserChannel } = await import('./driver.mjs');
  const channel = exampleBrowserChannel();
  const server = createServer(async (request, response) => {
    if (request.url !== '/form' && request.url !== '/canvas') {
      response.writeHead(404).end();
      return;
    }
    const file = request.url === '/form' ? 'inspector-form.html' : 'inspector-canvas.html';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await readFile(new URL(file, import.meta.url)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel,
      chromiumSandbox: true,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
      },
    });
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const base = createBrowserDriver(context, {
      ownedFixture: {
        urls: [`${origin}/form`, `${origin}/canvas`],
        publicValues: [[`${origin}/form`, 'fixture', 'ready']],
        publicViewports: [`${origin}/canvas`],
      },
    });
    await base.new_tab({ url: `${origin}/form` });
    await run({ browser, context, base, origin, page: context.pages()[0] });
  } finally {
    await browser?.close();
    await promisify(server.close.bind(server))();
  }
}

async function exercise({ base, page }) {
  const checks = {
    memory: await checkPartialDriver(memoryDriver()),
    playwright: await checkPartialDriver(base),
  };
  await assert.rejects(
    checkPartialDriver({
      ...memoryDriver(),
      async state() {
        return { tabs: [{ id: 'broken', active: true }] };
      },
    }),
    /state|report|invalid/iu,
  );
  checks.invalidState = true;
  let decision = true;
  const helper = new BrowserToolset(base, { members: ['read_page', 'set_checked'], confirm: () => decision });
  const find = async () => {
    const read = await inspectCall(helper, 'read_page', { tab_id: null, filter: 'interactive' });
    assert.equal(read.ok, true);
    assert.doesNotMatch(JSON.stringify(read), /PRIVATE_INSPECTOR_SENTINEL/u);
    assert.equal(
      read.result.elements.some((element) => ['Unavailable', 'Private'].includes(element.label)),
      false,
    );
    return read.result.elements.find((element) => element.label === 'Ready').ref;
  };
  let ref = await find();
  for (const checked of [true, true, false, false]) {
    // oxlint-disable-next-line no-await-in-loop
    const result = await inspectCall(helper, 'set_checked', { tab_id: null, target: ref, checked });
    assert.equal(result.ok, true);
    // oxlint-disable-next-line no-await-in-loop
    assert.equal(await page.locator('input[type=checkbox]').isChecked(), checked);
    // A real loop observes the current page before its next choice.
    // oxlint-disable-next-line no-await-in-loop
    ref = await find();
  }
  assert.equal(await page.evaluate(() => window.effectCount), 2);
  decision = false;
  const refused = await inspectCall(helper, 'set_checked', { tab_id: null, target: ref, checked: true });
  assert.equal(refused.ok, false);
  assert.equal(await page.evaluate(() => window.effectCount), 2);
  decision = true;
  await page.locator('input[type=checkbox]').evaluate((node) => node.replaceWith(node.cloneNode(true)));
  const replaced = await inspectCall(helper, 'set_checked', { tab_id: null, target: ref, checked: true });
  assert.equal(replaced.ok, false);
  assert.equal(await page.evaluate(() => window.effectCount), 2);
  checks.form = { idempotent: true, refusals: true, originalReference: true, changes: 2 };
  ref = await find();
  await page.locator('input[type=checkbox]').evaluate((node) => {
    node.addEventListener('click', (event) => event.preventDefault(), { once: true });
  });
  await assert.rejects(
    inspectCall(helper, 'set_checked', { tab_id: null, target: ref, checked: true }),
    /state report failed/u,
  );
  assert.equal(base.hasUncertainEffects(), true);
  await assert.rejects(base.read_page({ tab_id: null, filter: 'interactive' }), /retired/u);
  checks.form.cancelledClickRetires = true;
  return checks;
}

async function main() {
  const { values } = parseArgs({
    options: {
      driver: { type: 'string', default: 'playwright' },
      exercise: { type: 'boolean' },
      member: { type: 'string' },
      args: { type: 'string', default: '{}' },
      'ref-label': { type: 'string' },
      approve: { type: 'boolean' },
      stop: { type: 'boolean' },
    },
  });
  if (!['playwright', 'memory'].includes(values.driver)) {
    throw new Error('Choose --driver playwright or memory.');
  }
  const inspect = async (driver, memory) => {
    const helper = new BrowserToolset(driver, {
      members: memory ? ['list_tabs', 'read_page'] : ['list_tabs', 'read_page', 'set_checked'],
      confirmReads: ['read_page'],
      confirm: () => values.approve === true,
    });
    if (!values.member) {
      console.log(JSON.stringify(helper.tools(), null, 2));
      return;
    }
    const controller = new AbortController();
    if (values.stop) {
      controller.abort();
    }
    const args = JSON.parse(values.args);
    if (values['ref-label']) {
      const read = await inspectCall(
        helper,
        'read_page',
        { tab_id: null, filter: 'interactive' },
        { signal: controller.signal },
      );
      if (!read.ok) {
        console.log(JSON.stringify(read, null, 2));
        return;
      }
      const matching = read.result.elements.filter((item) => item.label === values['ref-label']);
      if (matching.length !== 1) {
        throw new Error('Choose exactly one label from an approved interactive read.');
      }
      args.target = matching[0].ref;
    }
    console.log(
      JSON.stringify(await inspectCall(helper, values.member, args, { signal: controller.signal }), null, 2),
    );
  };
  if (values.driver === 'memory' && !values.exercise) {
    await inspect(memoryDriver(), true);
    return;
  }
  await openInspector(async (session) => {
    if (values.exercise) {
      console.log(JSON.stringify(await exercise(session), null, 2));
      return;
    }
    await inspect(session.base, false);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
