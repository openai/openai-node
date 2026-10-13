import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { createDemoSession } from './runner.mjs';

const model = process.env['OPENAI_MODEL'];
assert.ok(model, 'Set OPENAI_MODEL to a synthetic test ID; this exercise blocks all external requests.');
const { launch: savedLaunch } = chromium;
let browser;
chromium.launch = async function launch(...args) {
  browser = await savedLaunch.apply(this, args);
  return browser;
};
const app = await createDemoServer({ port: 0, apiKey: 'synthetic-test-key', models: { responses: model } });
const originalFetch = globalThis.fetch;
const checks = [];
let requests = 0;
let nextRead = false;
let submitted = false;
let desiredNote = 'Inspect drifting sensor';

function streamed(output) {
  const response = {
    id: `resp_${requests}`,
    object: 'response',
    status: 'completed',
    model,
    output,
    output_text: submitted ? 'Service request processed.' : '',
  };
  const events = [
    {
      type: 'response.created',
      sequence_number: 0,
      response: { ...response, status: 'in_progress', output: [] },
    },
  ];
  if (output.length) {
    const [item] = output;
    events.push(
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: { ...item, status: 'in_progress' },
      },
      { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
    );
  }
  events.push({ type: 'response.completed', sequence_number: events.length, response });
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
function tool(name, args) {
  return streamed([
    {
      type: 'function_call',
      id: `fc_${requests}`,
      call_id: `call_${requests}`,
      status: 'completed',
      name,
      arguments: JSON.stringify(args),
    },
  ]);
}
function empty(run) {
  assert.equal(run.fixture.revision, 0);
  assert.deepEqual(run.fixture.results, []);
  assert.equal(run.fixture.verified, false);
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === app.origin) {
    return originalFetch(request);
  }
  // No API or other external network fallback exists.
  assert.equal(url.origin, 'https://api.openai.com');
  assert.equal(url.pathname, '/v1/responses');
  requests += 1;
  assert.ok(requests <= 12, 'The scripted service task exceeded its request budget.');
  const body = await request.json();
  if (submitted) {
    return streamed([
      {
        id: `msg_${requests}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Service request processed.', annotations: [], logprobs: [] }],
      },
    ]);
  }
  if (nextRead) {
    nextRead = false;
    return tool('browser_read_page', { tab_id: null, filter: 'all' });
  }
  const output = body.input.findLast(
    (item) =>
      item.type === 'function_call_output' &&
      Array.isArray(item.output) &&
      item.output.some((part) => part.type === 'input_text' && JSON.parse(part.text).result?.elements),
  );
  const raw = output
    ? JSON.parse(output.output.find((part) => part.type === 'input_text').text).result
    : JSON.parse(
        body.input[0].content.find((part) => part.type === 'input_text' && part.text.startsWith('{')).text,
      );
  const fields = [
    ['Visit date', '2026-11-12'],
    ['Technician', 'Sensor specialist'],
    ['Service note', desiredNote],
  ];
  for (const [label, value] of fields) {
    const element = raw.elements.find((entry) => entry.label === label);
    assert.ok(element, `Missing visible form field: ${label}`);
    assert.equal(typeof element.value, 'string', `Field must be explicitly permitted: ${label}`);
    if (element.value !== value) {
      nextRead = true;
      return element.role === 'combobox'
        ? tool('browser_select_option', { tab_id: null, target: element.ref, values: [value] })
        : tool('browser_type', { tab_id: null, target: element.ref, text: value });
    }
  }
  const submit = raw.elements.find((element) => element.label === 'Schedule SERVICE-401');
  assert.ok(submit);
  submitted = true;
  return tool('browser_click', { tab_id: null, target: submit.ref });
};

try {
  const dashboardResponse = await fetch(app.origin);
  const dashboard = await dashboardResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!dashboard.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (route, body, expectedStatus = 200) => {
    const response = await fetch(app.origin + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expectedStatus, route);
    return { status: response.status, value: await response.json() };
  };
  const state = async () => {
    const response = await call('/api/state');
    return response.value.run;
  };
  const until = async (condition) => {
    const deadline = performance.now() + 18_000;
    let run;
    while (performance.now() < deadline) {
      // Polling depends on the preceding state.
      // oxlint-disable-next-line no-await-in-loop
      run = await state();
      if (condition(run)) {
        return run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(20);
    }
    throw new Error(`Service run did not settle: ${JSON.stringify(run)}`);
  };
  const start = async (note = 'Inspect drifting sensor', api = 'responses') => {
    await until((run) => !run || (run.owner === 'stopped' && !run.closing));
    requests = 0;
    nextRead = false;
    submitted = false;
    desiredNote = note;
    const reply = await call('/api/start', {
      taskId: 'service',
      api,
      mode: api === 'responses' ? 'live' : 'rehearsal',
    });
    assert.equal(reply.status, 200);
    const run = await until((current) => current.approval || current.owner === 'stopped');
    assert.ok(run.approval, JSON.stringify(run));
    return run;
  };
  const approve = (run, approved) =>
    call('/api/approval', {
      runId: run.id,
      ownerVersion: run.ownerVersion,
      tabId: run.browser.tabId,
      sequence: run.browser.sequence,
      approvalId: run.approval.id,
      approved,
    });
  const page = () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === `${app.origin}/fixture/service`);
  const finish = () => until((run) => run.owner === 'stopped' && !run.closing);
  const wanted = {
    operation: 'schedule',
    job: 'SERVICE-401',
    date: '2026-11-12',
    technician: 'Sensor specialist',
    note: 'Inspect drifting sensor',
  };
  const post = (run, value, status) => call(`/fixture/service/effect?run=${run.id}`, value, status);

  const good = await start();
  assert.equal(
    good.approval.label,
    'Schedule SERVICE-401 · 2026-11-12 · Sensor specialist · Inspect drifting sensor',
  );
  empty(good);
  await approve(good, true);
  const complete = await finish();
  assert.equal(complete.result, 'verified', JSON.stringify(complete));
  assert.deepEqual(complete.fixture.results, [wanted]);
  const interrupted = await start();
  const taskPage = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url() === `${app.origin}/fixture/service`);
  assert.ok(taskPage);
  let observedCommit = false;
  taskPage.waitForFunction = async (_expression, revision) => {
    assert.equal(revision, 1);
    observedCommit = true;
    await taskPage.close();
    throw new Error('Controlled DOM acknowledgement failure after the host committed');
  };
  await approve(interrupted, true);
  const interruptedResult = await finish();
  assert.equal(observedCommit, true);
  assert.deepEqual(interruptedResult.fixture.results, [wanted]);
  assert.equal(interruptedResult.fixture.verified, true);
  assert.equal(interruptedResult.result, 'verified');
  assert.equal(interruptedResult.status, 'browser_closed');
  checks.push(
    { check: 'Committed exact business result survives browser loss during DOM acknowledgement' },
    {
      check: 'Real Responses SSE with permitted native date, text, select and exact approved host record',
      requests,
    },
  );

  const wrong = await start('Inspect wrong component');
  assert.match(wrong.approval.label, /Inspect wrong component/u);
  await approve(wrong, true);
  const imperfect = await finish();
  assert.equal(imperfect.result, 'unverified');
  assert.equal(imperfect.fixture.finished, true);
  assert.deepEqual(imperfect.fixture.results, [{ ...wanted, note: 'Inspect wrong component' }]);
  checks.push({ check: 'An approved wrong value remains one real unverified write' });

  const local = await start(undefined, 'decisions');
  assert.match(local.approval.label, /Inspect drifting sensor/u);
  await approve(local, true);
  const rehearsed = await finish();
  assert.equal(rehearsed.result, 'verified');
  assert.equal(rehearsed.requests, 0);
  checks.push({
    check: 'Decisions rehearsal fills the observed native fields and verifies, zero API requests',
  });

  const attack = await start();
  await page().evaluate(() => {
    document.body.dataset.finished = 'true';
    document.body.dataset.revision = '44';
    document.body.dataset.results = JSON.stringify([{ job: 'SERVICE-401', note: 'done' }]);
  });
  empty(await state());
  await post(attack, { ...wanted, job: 'SERVICE-402' }, 403);
  await post(attack, { ...wanted, note: 'Unapproved' }, 403);
  await page().locator('[data-browser-field=note]').fill('Unapproved');
  await approve(attack, true);
  const rejected = await finish();
  empty(rejected);
  assert.equal(rejected.result, 'unverified');
  checks.push({
    check: 'Forged page success, wrong job and changed field body cannot change the approved saved value',
  });

  const refusal = await start();
  await approve(refusal, false);
  const refused = await finish();
  empty(refused);
  assert.equal(refused.status, 'refused');
  checks.push({ check: 'Refusing the service submission leaves no saved visit' });

  const stopping = await start();
  await call('/api/stop', { runId: stopping.id });
  empty(await finish());
  checks.push({ check: 'Stop while service approval is held leaves no saved visit' });

  const held = await start();
  const stockPage = page();
  const sample = await stockPage.locator('body').elementHandle();
  const prototype = Object.getPrototypeOf(sample);
  const savedEvaluate = prototype.evaluate;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let heldClick = false;
  prototype.evaluate = async function evaluate(fn, args) {
    if (!heldClick && typeof fn === 'function' && fn.name === 'ownedElement' && args?.action === 'click') {
      heldClick = true;
      entered.resolve();
      await release.promise;
    }
    return savedEvaluate.call(this, fn, args);
  };
  try {
    await approve(held, true);
    assert.equal(await Promise.race([entered.promise.then(() => true), delay(5000, false)]), true);
    const staged = post(held, wanted, 403);
    await post(held, { ...wanted, job: 'SERVICE-402' }, 403);
    await post(held, { ...wanted, note: 'Unapproved' }, 403);
    empty(await state());
    await stockPage.evaluate(() => {
      const card = document.querySelector('[data-record-id]');
      card.replaceWith(card.cloneNode(true));
    });
    release.resolve();
    await staged;
    const ended = await finish();
    empty(ended);
    assert.equal(ended.result, 'unverified');
    checks.push({
      check:
        'Matching staged request plus wrong-job and wrong-value attempts cannot survive native card replacement',
    });
  } finally {
    release.resolve();
    prototype.evaluate = savedEvaluate;
    await sample.dispose().catch(() => {
      // The failed native ref can close the page before the test disposes its handle.
    });
  }

  // Check the same declarations against actual permitted values from the driver,
  // never just the configuration itself. No new public oracle/debug route.
  const run = { taskId: 'support', owner: 'agent', ownerVersion: 1, controller: new AbortController() };
  const session = await createDemoSession({
    browser,
    origin: app.origin,
    run,
    onClose: () => run.controller.abort(),
  });
  try {
    await session.taskPage.evaluate(() => {
      const section = document.createElement('section');
      section.dataset.recordId = 'SERVICE-401';
      section.style.cssText = 'position:fixed;top:260px;left:610px;background:white';
      const input = document.createElement('input');
      input.dataset.browserField = 'note';
      input.setAttribute('aria-label', 'Copied service note');
      input.value = 'COPIED_PRIVATE_SERVICE';
      section.append(input);
      document.body.append(section);
    });
    const read = await session.base.read_page({ tab_id: null, filter: 'all' });
    const copied = read.elements.find((element) => element.label === 'Copied service note');
    assert.ok(copied);
    assert.equal(Object.hasOwn(copied, 'value'), false);
    assert.ok(!JSON.stringify(read).includes('COPIED_PRIVATE_SERVICE'));
    checks.push({
      check: 'Copying service identity and field markers into support cannot disclose service values',
    });
  } finally {
    await session.close();
  }

  const activeService = await start();
  const activeContext = browser
    .contexts()
    .find((context) =>
      context.pages().some((candidate) => candidate.url() === `${app.origin}/fixture/service`),
    );
  assert.ok(activeContext);
  const cookies = await activeContext.cookies(`${app.origin}/fixture/service`);
  const workspace = cookies.find((cookie) => cookie.name === 'fieldwork_workspace');
  assert.ok(workspace);
  const serviceRun = {
    taskId: 'service',
    business: {},
    workspaceToken: workspace.value,
    owner: 'agent',
    ownerVersion: 1,
    controller: new AbortController(),
  };
  const serviceSession = await createDemoSession({
    browser,
    origin: app.origin,
    run: serviceRun,
    onClose: () => serviceRun.controller.abort(),
  });
  try {
    const current = await serviceSession.base.read_page({ tab_id: null, filter: 'all' });
    const granted = current.elements.find((element) => element.label === 'Service note');
    assert.equal(typeof granted?.value, 'string', 'the service Task page has the exact permitted value');
    await serviceSession.base.new_tab({ url: `${serviceSession.notesURL}brief` });
    const notePage = serviceSession.page;
    await notePage.evaluate(() => {
      const section = document.createElement('section');
      section.dataset.recordId = 'SERVICE-401';
      section.style.cssText = 'position:fixed;top:260px;left:610px;background:white';
      const input = document.createElement('input');
      input.dataset.browserField = 'note';
      input.setAttribute('aria-label', 'Copied service note');
      input.value = 'COPIED_NOTES_SERVICE';
      section.append(input);
      document.body.append(section);
    });
    const notes = await serviceSession.base.read_page({ tab_id: null, filter: 'all' });
    const copied = notes.elements.find((element) => element.label === 'Copied service note');
    assert.ok(copied);
    assert.equal(Object.hasOwn(copied, 'value'), false);
    assert.ok(!JSON.stringify(notes).includes('COPIED_NOTES_SERVICE'));
    checks.push({
      check: 'Exact Task value permission does not follow a copied record into the service Notes tab',
    });
  } finally {
    await serviceSession.close();
    await approve(activeService, false);
    empty(await finish());
  }
  console.log(
    JSON.stringify({
      scope: 'Scripted SDK Responses and Decisions with real local Chromium; API/network calls zero',
      checks,
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  try {
    await app.close();
  } finally {
    chromium.launch = savedLaunch;
  }
}
