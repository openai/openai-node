import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

// Every API reply is synthetic. The browser, input, context cleanup and SDK loops are real.
const model = process.env['OPENAI_MODEL'];
assert.ok(model, 'Supply a synthetic test ID; this exercise does not use an API credential.');
const originalLaunch = chromium.launch.bind(chromium);
const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const originalDateNow = Date.now;
const results = [];
let initializationGate;
let pageSetupGate;
let screenshotGate;
let fetchGate;
let streamGate;
let browser;
let currentPage;
let expire;
let fixedNow;
let staleRef;
let foreignTargets;
let failProviderBody = false;
let requestSequence = 0;

Date.now = () => fixedNow ?? originalDateNow();

function gate() {
  return { started: Promise.withResolvers(), release: Promise.withResolvers() };
}

chromium.launch = async (options) => {
  browser = await originalLaunch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (contextOptions) => {
    const pending = initializationGate;
    if (pending) {
      initializationGate = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    const context = await newContext(contextOptions);
    if (pending) {
      const routeWebSocket = context.routeWebSocket.bind(context);
      pending.guardRegistrations = 0;
      context.routeWebSocket = (...args) => {
        pending.guardRegistrations += 1;
        return routeWebSocket(...args);
      };
    }
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const setup = pageSetupGate;
      if (setup) {
        pageSetupGate = null;
        setup.started.resolve();
        await setup.release.promise;
      }
      const page = await newPage();
      currentPage = page;
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (screenshotOptions) => {
        const held = screenshotGate;
        if (held) {
          screenshotGate = null;
          held.started.resolve();
          await held.release.promise;
        }
        return screenshot(screenshotOptions);
      };
      return page;
    };
    return context;
  };
  return browser;
};

globalThis.setTimeout = (callback, ms, ...args) => {
  if (ms === 300_000) {
    expire = callback;
  }
  return originalTimeout(callback, ms, ...args);
};

const app = await createDemoServer({
  port: 0,
  apiKey: 'synthetic-unused',
  models: { decisions: model, responses: model },
});

const control = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
async function expectStatus(pending, expected) {
  const reply = await pending;
  assert.equal(reply.status, expected, JSON.stringify(reply.value));
}

function response(output, signal) {
  requestSequence += 1;
  const completed = {
    id: `resp_${requestSequence}`,
    object: 'response',
    status: 'completed',
    model,
    output,
  };
  const events = [
    {
      type: 'response.created',
      sequence_number: 0,
      response: { ...completed, status: 'in_progress', output: [] },
    },
  ];
  for (const [index, item] of output.entries()) {
    events.push(
      {
        type: 'response.output_item.added',
        output_index: index,
        item: { ...item, status: 'in_progress' },
        sequence_number: events.length,
      },
      {
        type: 'response.output_item.done',
        output_index: index,
        item,
        sequence_number: events.length + 1,
      },
    );
  }
  const encoder = new TextEncoder();
  const encode = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const held = streamGate;
  streamGate = undefined;
  let settled = false;
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const event of events) {
          const bytes = encode(event);
          // Split every SSE frame across transport chunks, including its "data:" prefix.
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
        }
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          controller.enqueue(
            encode({ type: 'response.completed', sequence_number: events.length, response: completed }),
          );
          controller.close();
        };
        if (held) {
          held.started.resolve({ signal });
          if (held.cooperative) {
            signal.addEventListener(
              'abort',
              () => {
                if (settled) {
                  return;
                }
                settled = true;
                controller.error(new Error('Synthetic stream acknowledged abort'));
              },
              { once: true },
            );
          }
          await held.release.promise;
        }
        finish();
      },
      cancel() {
        settled = true;
        if (held) {
          held.cancelled = true;
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function tool(name, args, signal) {
  return response(
    [
      {
        id: `fc_${requestSequence}`,
        call_id: `call_${requestSequence}`,
        type: 'function_call',
        status: 'completed',
        name,
        arguments: JSON.stringify(args),
      },
    ],
    signal,
  );
}

function observation(body) {
  const initialBlock = body.input
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .find((block) => block.type === 'input_text' && block.text.startsWith('{'));
  const initial = initialBlock ? JSON.parse(initialBlock.text) : null;
  for (const item of body.input.toReversed()) {
    const blocks = item.type === 'function_call_output' ? item.output : item.content;
    if (!Array.isArray(blocks)) {
      continue;
    }
    for (const block of blocks) {
      if (block.type !== 'input_text' || !block.text.startsWith('{')) {
        continue;
      }
      const value = JSON.parse(block.text);
      const read = value.result ?? value;
      if (Array.isArray(read.elements)) {
        if (value.state?.tabs) {
          // Keep the application's initial tab roles while using current SDK tab state.
          const tabs = value.state.tabs.map((tab) => ({
            ...tab,
            role: initial?.tabs?.find((known) => known.id === tab.id)?.role,
          }));
          return { ...read, tabs, active_tab_id: tabs.find((tab) => tab.active)?.id };
        }
        return read;
      }
    }
  }
  throw new Error('The synthetic model needs an actual browser observation.');
}

function nextChoice(read) {
  if (read.text.includes('T-1042 · 1 of 3')) {
    return 'Billing';
  }
  if (read.text.includes('T-1043 · 2 of 3')) {
    return 'Technical';
  }
  return 'Account';
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === app.origin) {
    return originalFetch(request);
  }
  assert.equal(
    url.origin,
    'https://api.openai.com',
    'No other outbound destination may escape this exercise.',
  );
  assert.ok(['/v1/responses', '/v1/decisions'].includes(url.pathname));
  const body = await request.json();
  const held = fetchGate;
  if (held) {
    fetchGate = null;
    held.started.resolve({ request, body });
    // Deliberately ignore cancellation: human ownership must await this admitted operation.
    await held.release.promise;
  }
  if (failProviderBody) {
    failProviderBody = false;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"output":'));
          controller.error(new Error('Synthetic provider disconnected before body completed'));
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  const read = observation(body);
  const taskTab = read.tabs?.find((tab) => tab.role === 'Task');
  const onNotes = taskTab && read.active_tab_id !== taskTab.id;
  if (url.pathname === '/v1/decisions') {
    const choice = body.questions[0].choices.find(
      (candidate) =>
        candidate.description === (onNotes ? 'Switch to the Task tab' : `Click ${nextChoice(read)}`),
    );
    assert.ok(choice);
    return Response.json({
      object: 'decision',
      id: 'fixture',
      model,
      answers: [
        {
          name: 'next_action',
          type: 'choice',
          choice: choice.value,
          confidence: 1,
          probabilities: [{ value: choice.value, probability: 1 }],
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  }
  if (foreignTargets && onNotes) {
    const last = body.input.at(-1);
    if (last.type === 'function_call_output') {
      const payload = JSON.parse(last.output[0].text);
      assert.equal(payload.ok, false, 'Explicit Task reads/actions on Notes must be refused.');
      assert.equal(payload.result, undefined, 'No Task text or screenshot may be returned as Notes.');
      foreignTargets.denied += 1;
    }
    const next = foreignTargets.calls.shift();
    if (next) {
      return tool(next.name, next.args, request.signal);
    }
    assert.equal(foreignTargets.denied, 4);
    foreignTargets = null;
    return tool('browser_switch_tab', { tab_id: taskTab.id }, request.signal);
  }
  if (onNotes && body.input.at(-1)?.type !== 'function_call_output') {
    return tool('browser_switch_tab', { tab_id: taskTab.id }, request.signal);
  }
  const last = body.input.at(-1);
  if (last.type === 'function_call_output') {
    const payload = JSON.parse(last.output[0].text);
    if (!Array.isArray(payload.result?.elements)) {
      return tool('browser_read_page', { tab_id: null, filter: 'all' }, request.signal);
    }
  }
  if (staleRef) {
    const target = staleRef;
    staleRef = undefined;
    return tool('browser_click', { tab_id: null, target }, request.signal);
  }
  if (read.elements.length === 0) {
    return response(
      [
        {
          id: 'msg_done',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Fixture complete.', annotations: [] }],
        },
      ],
      request.signal,
    );
  }
  const target = read.elements.find((element) => element.label === nextChoice(read));
  assert.ok(target);
  return tool('browser_click', { tab_id: null, target: target.ref }, request.signal);
};

try {
  const dashboard = await fetch(app.origin);
  const html = await dashboard.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (path, body, headers = {}) => {
    const reply = await fetch(`${app.origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: app.origin,
        'X-Demo-Token': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: reply.status, value: await reply.json() };
  };
  const state = async () => {
    const reply = await call('/api/state');
    return reply.value.run;
  };
  const waitFor = async (condition) => {
    const end = performance.now() + 20_000;
    while (performance.now() < end) {
      // Ownership and cleanup depend on the preceding operation.
      // oxlint-disable-next-line no-await-in-loop
      const run = await state();
      if (condition(run)) {
        return run;
      }
      // Pace this serial, bounded local-state check.
      // oxlint-disable-next-line no-await-in-loop
      await delay(20);
    }
    throw new Error('The handoff exercise did not reach its expected state.');
  };
  const start = async (api, taskId = 'support', mode = 'live') => {
    await waitFor((run) => !run || (run.owner === 'stopped' && !run.closing));
    const reply = await call('/api/start', { taskId, api, mode });
    assert.equal(reply.status, 200);
    return reply.value;
  };
  const input = (run, action) => call('/api/input', { ...control(run), ...action });
  const clickBilling = async (run) => {
    const box = await currentPage.getByRole('button', { name: 'Billing', exact: true }).boundingBox();
    assert.ok(box);
    return input(run, { action: 'click', x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };

  initializationGate = gate();
  const delayedSetup = initializationGate;
  const starting = await start('responses');
  await delayedSetup.started.promise;
  await expectStatus(call('/api/take-control', control(starting)), 200);
  await expectStatus(call('/api/stop', { runId: starting.id }), 200);
  const stoppedPhase1 = await state();
  assert.equal(stoppedPhase1.owner, 'stopped');
  await expectStatus(input(starting, { action: 'click', x: 1, y: 1 }), 409);
  await expectStatus(call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' }), 409);
  delayedSetup.release.resolve();
  await waitFor((run) => !run.closing);
  assert.equal(browser.contexts().length, 0);
  results.push({ control: 'Stop during delayed initialization', noLateSession: true });

  initializationGate = gate();
  const takeOnlySetup = initializationGate;
  const takeOnly = await start('responses');
  await takeOnlySetup.started.promise;
  await expectStatus(call('/api/take-control', control(takeOnly)), 200);
  const takeOnlyDrain = await waitFor((run) => run.owner === 'draining-to-human');
  await expectStatus(input(takeOnlyDrain, { action: 'click', x: 1, y: 1 }), 409);
  await expectStatus(call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' }), 409);
  takeOnlySetup.release.resolve();
  const noAgentSetup = await waitFor((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(
    takeOnlySetup.guardRegistrations,
    0,
    'A setup that lost ownership cannot register owned guards',
  );
  assert.equal(noAgentSetup.requests, 0);
  assert.equal(browser.contexts().length, 0);
  await expectStatus(call('/api/return-control', control(noAgentSetup)), 409);
  results.push({
    control: 'Take without Stop during delayed context creation',
    noGuardRegistration: true,
    requests: 0,
    contexts: 0,
  });

  pageSetupGate = gate();
  const publishedSetup = pageSetupGate;
  const settingUp = await start('responses');
  await publishedSetup.started.promise;
  assert.equal(browser.contexts().length, 1);
  await expectStatus(call('/api/take-control', control(settingUp)), 200);
  await expectStatus(call('/api/stop', { runId: settingUp.id }), 200);
  try {
    const revoked = await waitFor(() => browser.contexts().length === 0);
    assert.equal(revoked.closing, true, 'Setup cleanup still blocks another run.');
    await expectStatus(call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' }), 409);
  } finally {
    publishedSetup.release.resolve();
  }
  const noLateSetup = await waitFor((run) => !run.closing);
  assert.equal(noLateSetup.owner, 'stopped');
  assert.equal(noLateSetup.requests, 0);
  assert.equal(noLateSetup.view.status, 'closed');
  results.push({
    control: 'Stop revokes the published context before stalled setup settles',
    noLateSession: true,
  });

  const humanPhase = async (api) => {
    fetchGate = gate();
    const held = fetchGate;
    await start(api);
    const admitted = await held.started.promise;
    const run = await state();
    await expectStatus(call('/api/take-control', control(run)), 200);
    const draining = await waitFor((value) => value.owner === 'draining-to-human');
    assert.equal(draining.requests, 1);
    await expectStatus(input(draining, { action: 'click', x: 1, y: 1 }), 409);
    assert.equal(admitted.request.signal.aborted, true);
    held.release.resolve();
    const human = await waitFor((value) => value.owner === 'human');
    assert.deepEqual(human.fixture.results, []);
    assert.equal(Boolean(human.approval), false);
    assert.equal(browser.contexts().length, 1);
    return { human, initialRead: observation(admitted.body), page: currentPage };
  };

  const stalledTakeover = async (api) => {
    fetchGate = gate();
    const stalled = fetchGate;
    await start(api);
    const admitted = await stalled.started.promise;
    try {
      await expectStatus(call('/api/take-control', control(await state())), 200);
      const draining = await waitFor((run) => run.owner === 'draining-to-human');
      assert.equal(admitted.request.signal.aborted, true);
      await expectStatus(input(draining, { action: 'click', x: 1, y: 1 }), 409);
      // Wait past the existing five-second desktop drain bound without releasing the admitted operation.
      await delay(5500);
      const unavailable = await state();
      assert.equal(unavailable.owner, 'stopped', 'An undrainable browser must reach handoff unavailable.');
      assert.equal(unavailable.status, 'handoff_unavailable');
      assert.equal(
        unavailable.closing,
        true,
        'The operation is still outstanding, even if the context closed.',
      );
      assert.equal(unavailable.sessionExpiresAt, null);
      assert.deepEqual(unavailable.fixture.results, []);
      await expectStatus(input(unavailable, { action: 'click', x: 1, y: 1 }), 409);
      await expectStatus(call('/api/return-control', control(unavailable)), 409);
      await expectStatus(call('/api/start', { taskId: 'support', api, mode: 'live' }), 409);
      await waitFor(() => browser.contexts().length === 0);
      results.push({ control: `${api} stalled browser drain becomes unavailable`, noResume: true });
    } finally {
      stalled.release.resolve();
      const current = await state();
      await expectStatus(call('/api/stop', { runId: current.id }), 200);
      await waitFor((run) => run.owner === 'stopped' && !run.closing);
    }
    const ended = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(ended.status, 'handoff_unavailable', 'Draining the request must retain the stop reason');
    assert.deepEqual(ended.fixture.results, []);
    assert.equal(browser.contexts().length, 0);
  };
  await stalledTakeover('responses');
  await stalledTakeover('decisions');

  const resume = async (api) => {
    fixedNow = originalDateNow();
    const { human, page, initialRead } = await humanPhase(api);
    const oldExpiry = expire;
    await expectStatus(
      input({ ...human, ownerVersion: human.ownerVersion - 1 }, { action: 'click', x: 1, y: 1 }),
      409,
    );
    await expectStatus(input(human, { action: 'click', x: 1024, y: 1 }), 400);
    await expectStatus(input(human, { action: 'key', key: 'ControlOrMeta+L' }), 400);
    await expectStatus(input(human, { action: 'type', text: 'x'.repeat(2001) }), 400);
    await expectStatus(input(human, { action: 'click', x: 1, y: 1, url: 'https://other.invalid' }), 400);
    await expectStatus(
      call('/api/input', { ...control(human), action: 'click', x: 1, y: 1 }, { 'X-Demo-Token': 'wrong' }),
      403,
    );
    await expectStatus(
      call(
        '/api/input',
        { ...control(human), action: 'click', x: 1, y: 1 },
        { Origin: 'https://other.invalid' },
      ),
      403,
    );
    await expectStatus(clickBilling(human), 200);
    const changed = await state();
    assert.deepEqual(changed.fixture.results, [{ id: 'T-1042', choice: 'Billing' }]);
    assert.equal(changed.owner, 'human');
    fetchGate = gate();
    const resumedFetch = fetchGate;
    await expectStatus(call('/api/return-control', control(changed)), 200);
    const fresh = await resumedFetch.started.promise;
    const freshRead = observation(fresh.body);
    const previousRefs = new Set(initialRead.elements.map((element) => element.ref));
    assert.ok(freshRead.elements.every((element) => !previousRefs.has(element.ref)));
    assert.ok(initialRead.text.includes('T-1042 · 1 of 3'));
    assert.ok(initialRead.elements.every((element) => !Object.hasOwn(element, 'record')));
    assert.ok(freshRead.elements.every((element) => !Object.hasOwn(element, 'record')));
    assert.ok(freshRead.text.includes('T-1043 · 2 of 3'));
    const agent = await state();
    await expectStatus(call('/api/take-control', control(agent)), 200);
    resumedFetch.release.resolve();
    const secondHuman = await waitFor((run) => run.owner === 'human');
    assert.ok(secondHuman.ownerVersion > human.ownerVersion);
    assert.equal(secondHuman.sessionExpiresAt, human.sessionExpiresAt);
    oldExpiry();
    const afterOldExpiry = await state();
    assert.equal(afterOldExpiry.owner, 'human', 'An old expiry cannot close a later ownership phase.');
    await expectStatus(input(human, { action: 'click', x: 1, y: 1 }), 409);
    if (api === 'responses') {
      staleRef = initialRead.elements[0].ref;
    }
    await expectStatus(call('/api/return-control', control(secondHuman)), 200);
    const finished = await waitFor((value) => value.owner === 'stopped' && !value.closing);
    assert.equal(finished.result, 'verified');
    assert.equal(finished.fixture.revision, 3);
    assert.equal(
      finished.uncertainEffects,
      false,
      'A rejected stale ref does not make a later effect uncertain.',
    );
    assert.equal(currentPage, page, 'Return must retain the actual page.');
    assert.equal(finished.requests, finished.turns);
    assert.ok(finished.requests > 1);
    assert.ok(finished.requests <= finished.stepLimit);
    assert.equal(browser.contexts().length, 0);
    assert.equal(staleRef, undefined);
    fixedNow = undefined;
    results.push({
      control: `${api} non-cooperative drain, human change and fresh resume`,
      noReplay: true,
      requests: finished.requests,
      verified: true,
    });
  };
  await resume('responses');
  await resume('decisions');

  const heldAction = async (api, where) => {
    fetchGate = gate();
    const initialFetch = fetchGate;
    await start(api);
    const first = await initialFetch.started.promise;
    const firstRead = observation(first.body);
    const sample = await currentPage.locator('body').elementHandle();
    const prototype = Object.getPrototypeOf(sample);
    const originalEvaluate = prototype.evaluate;
    const hadOwnEvaluate = Object.hasOwn(prototype, 'evaluate');
    let intercept = true;
    prototype.evaluate = async function evaluate(fn, args) {
      if (!intercept || typeof fn !== 'function' || fn.name !== 'ownedElement' || args?.action !== 'click') {
        return originalEvaluate.call(this, fn, args);
      }
      intercept = false;
      // Hold a real evaluation in Chromium, before dispatch or after its effect
      // but before the browser reply reaches the driver. The embedded checked
      // action itself still runs in one nonawaiting browser task.
      // Playwright calls functions, but treats strings as expressions. This
      // source is the fixed local owned guard, never an API or page value.
      // oxlint-disable-next-line no-new-func
      const hold = new Function(
        'element',
        'input',
        `return (async () => {
          const checked = input.where === 'before' ? undefined : (${fn.toString()})(element, input.args);
          await new Promise((resolve) => { window.__releaseHeldAction = resolve; });
          delete window.__releaseHeldAction;
          if (input.where === 'lost') throw new Error('Synthetic lost action reply');
          return input.where === 'before' ? (${fn.toString()})(element, input.args) : checked;
        })();`,
      );
      return originalEvaluate.call(this, hold, { args, where });
    };
    try {
      initialFetch.release.resolve();
      await currentPage.waitForFunction(() => typeof window.__releaseHeldAction === 'function');
      const oracle = () =>
        currentPage.locator('body').evaluate((body) => ({
          revision: Number(body.dataset.revision),
          results: JSON.parse(body.dataset.results),
        }));
      const entered = await oracle();
      assert.deepEqual(
        entered.results,
        where === 'before' ? [] : [{ id: 'T-1042', choice: 'Billing' }],
        'The independent live DOM oracle must distinguish before-effect and after-effect holds',
      );
      await expectStatus(call('/api/take-control', control(await state())), 200);
      const draining = await waitFor((value) => value.owner === 'draining-to-human');
      assert.equal(draining.requests, 1);
      await expectStatus(input(draining, { action: 'click', x: 1, y: 1 }), 409);
      await expectStatus(call('/api/return-control', control(draining)), 409);
      assert.deepEqual(await oracle(), entered, 'Denied human input cannot change the held browser');
      const stillDraining = await state();
      assert.equal(stillDraining.requests, 1, 'No next API request can pass the held operation');
      await currentPage.evaluate(() => window.__releaseHeldAction());
      if (where === 'lost') {
        const ended = await waitFor((value) => value.owner === 'stopped' && !value.closing);
        assert.equal(browser.contexts().length, 0);
        assert.equal(ended.result, 'unverified');
        assert.equal(ended.requests, 1);
        assert.equal(
          ended.uncertainEffects,
          true,
          'The driver lost the reply after an actual fixture effect.',
        );
        await expectStatus(input(ended, { action: 'click', x: 1, y: 1 }), 409);
        await expectStatus(call('/api/return-control', control(ended)), 409);
        const afterRejection = await state();
        assert.equal(
          afterRejection.uncertainEffects,
          true,
          'Rejected controls cannot clear known uncertainty.',
        );
        results.push({
          control: `${api} actual browser effect then lost reply`,
          noResume: true,
          effects: entered.results,
        });
        return;
      }
      const human = await waitFor((value) => value.owner === 'human');
      assert.equal(human.uncertainEffects, false, 'The drained evaluation returned a confirmed result.');
      assert.deepEqual(await oracle(), { revision: 1, results: [{ id: 'T-1042', choice: 'Billing' }] });
      assert.deepEqual(human.fixture.results, [{ id: 'T-1042', choice: 'Billing' }]);
      const technical = await currentPage
        .getByRole('button', { name: 'Technical', exact: true })
        .boundingBox();
      assert.ok(technical);
      await expectStatus(
        input(human, {
          action: 'click',
          x: technical.x + technical.width / 2,
          y: technical.y + technical.height / 2,
        }),
        200,
      );
      const humanResult = await oracle();
      assert.deepEqual(humanResult.results, [
        { id: 'T-1042', choice: 'Billing' },
        { id: 'T-1043', choice: 'Technical' },
      ]);
      fetchGate = gate();
      const returnFetch = fetchGate;
      await expectStatus(call('/api/return-control', control(human)), 200);
      const resumed = await returnFetch.started.promise;
      const nextRead = observation(resumed.body);
      assert.ok(nextRead.text.includes('T-1044 · 3 of 3'));
      const oldRefs = new Set(firstRead.elements.map((element) => element.ref));
      assert.ok(nextRead.elements.every((element) => !oldRefs.has(element.ref)));
      if (api === 'responses') {
        staleRef = firstRead.elements[0].ref;
      }
      returnFetch.release.resolve();
      const finished = await waitFor((value) => value.owner === 'stopped' && !value.closing);
      assert.equal(finished.result, 'verified');
      assert.equal(
        finished.uncertainEffects,
        false,
        'Confirmed drain and a rejected stale ref remain known.',
      );
      assert.deepEqual(finished.fixture.results, [
        { id: 'T-1042', choice: 'Billing' },
        { id: 'T-1043', choice: 'Technical' },
        { id: 'T-1044', choice: 'Account' },
      ]);
      assert.equal(staleRef, undefined);
      results.push({
        control: `${api} browser evaluation held ${where} effect`,
        effects: finished.fixture.results,
        noReplay: true,
      });
    } finally {
      if (hadOwnEvaluate) {
        prototype.evaluate = originalEvaluate;
      } else {
        delete prototype.evaluate;
      }
      if (!currentPage.isClosed()) {
        await currentPage.evaluate(() => window.__releaseHeldAction?.());
      }
    }
  };
  await heldAction('responses', 'before');
  await heldAction('responses', 'after');
  await heldAction('decisions', 'before');
  await heldAction('decisions', 'after');
  await heldAction('responses', 'lost');
  await heldAction('decisions', 'lost');

  const navigationAndDisconnect = async (api) => {
    fetchGate = gate();
    const beforeNavigation = fetchGate;
    await start(api);
    const admitted = await beforeNavigation.started.promise;
    const originalRefs = new Set(observation(admitted.body).elements.map((element) => element.ref));
    // The owner fixture URL is the only permitted page URL. A real document
    // replacement during a pending request must revoke its issued handles.
    await currentPage.reload();
    await expectStatus(call('/api/take-control', control(await state())), 200);
    const draining = await waitFor((value) => value.owner === 'draining-to-human');
    failProviderBody = true;
    await expectStatus(input(draining, { action: 'click', x: 1, y: 1 }), 409);
    beforeNavigation.release.resolve();
    const human = await waitFor((value) => value.owner === 'human');
    assert.deepEqual(human.fixture.results, []);
    assert.equal(human.requests, 1);
    assert.equal(Boolean(human.approval), false);
    await expectStatus(clickBilling(human), 200);
    fetchGate = gate();
    const returnFetch = fetchGate;
    await expectStatus(call('/api/return-control', control(human)), 200);
    const next = await returnFetch.started.promise;
    const fresh = observation(next.body);
    assert.ok(fresh.elements.every((element) => !originalRefs.has(element.ref)));
    assert.ok(fresh.text.includes('T-1043 · 2 of 3'));
    if (api === 'responses') {
      staleRef = observation(admitted.body).elements[0].ref;
    }
    returnFetch.release.resolve();
    const completed = await waitFor((value) => value.owner === 'stopped' && !value.closing);
    assert.equal(completed.result, 'verified');
    assert.deepEqual(completed.fixture.results, [
      { id: 'T-1042', choice: 'Billing' },
      { id: 'T-1043', choice: 'Technical' },
      { id: 'T-1044', choice: 'Account' },
    ]);
    assert.equal(staleRef, undefined);
    results.push({
      control: `${api} same-fixture navigation and provider disconnect during takeover`,
      verified: true,
      noReplay: true,
    });

    // A provider error without an admitted takeover ends the run.
    fetchGate = gate();
    const failedFetch = fetchGate;
    const failing = await start(api);
    await failedFetch.started.promise;
    failProviderBody = true;
    failedFetch.release.resolve();
    const ended = await waitFor((value) => value.owner === 'stopped' && !value.closing);
    assert.equal(ended.id, failing.id);
    assert.equal(ended.result, 'unverified');
    assert.equal(ended.requests, 1);
    assert.deepEqual(ended.fixture.results, []);
    await expectStatus(call('/api/take-control', control(ended)), 409);
    assert.equal(browser.contexts().length, 0);
    results.push({ control: `${api} provider body lost before takeover`, noResume: true, effects: [] });

    // A fresh return is a new admitted request, but it cannot resume again
    // automatically when its provider disconnects.
    const { human: afterInput } = await humanPhase(api);
    await expectStatus(clickBilling(afterInput), 200);
    fetchGate = gate();
    const nextFetch = fetchGate;
    await expectStatus(call('/api/return-control', control(afterInput)), 200);
    await nextFetch.started.promise;
    failProviderBody = true;
    nextFetch.release.resolve();
    const returnFailed = await waitFor((value) => value.owner === 'stopped' && !value.closing);
    assert.equal(returnFailed.result, 'unverified');
    assert.equal(returnFailed.requests, 2);
    assert.deepEqual(returnFailed.fixture.results, [{ id: 'T-1042', choice: 'Billing' }]);
    await expectStatus(call('/api/return-control', control(returnFailed)), 409);
    assert.equal(browser.contexts().length, 0);
    results.push({
      control: `${api} provider body lost after explicit return`,
      noResume: true,
      effects: returnFailed.fixture.results,
    });
  };
  await navigationAndDisconnect('responses');
  await navigationAndDisconnect('decisions');

  const openStream = async (cooperative) => {
    streamGate = gate();
    streamGate.cooperative = cooperative;
    const held = streamGate;
    await start('responses');
    const admitted = await held.started.promise;
    const receiving = await waitFor((run) =>
      run.events.some((event) => event.text === 'Responses stream receiving'),
    );
    assert.equal(receiving.requests, 1);
    assert.deepEqual(receiving.fixture.results, []);
    assert.equal(Boolean(receiving.approval), false);
    const oracle = async () => JSON.parse(await currentPage.locator('body').getAttribute('data-results'));
    assert.deepEqual(await oracle(), [], 'A complete tool item is still inert before response.completed');
    await expectStatus(call('/api/take-control', control(receiving)), 200);
    assert.equal(admitted.signal.aborted, true);
    if (!cooperative) {
      const draining = await waitFor((run) => run.owner === 'draining-to-human');
      await expectStatus(input(draining, { action: 'click', x: 1, y: 1 }), 409);
      await expectStatus(call('/api/return-control', control(draining)), 409);
      assert.deepEqual(await oracle(), []);
      const waitingState = await state();
      assert.equal(waitingState.requests, 1);
    }
    held.release.resolve();
    const human = await waitFor((run) => run.owner === 'human');
    await expectStatus(clickBilling(human), 200);
    const firstHumanResult = await oracle();
    assert.deepEqual(firstHumanResult, [{ id: 'T-1042', choice: 'Billing' }]);
    await expectStatus(call('/api/return-control', control(human)), 200);
    const finished = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(finished.result, 'verified');
    assert.deepEqual(finished.fixture.results, [
      { id: 'T-1042', choice: 'Billing' },
      { id: 'T-1043', choice: 'Technical' },
      { id: 'T-1044', choice: 'Account' },
    ]);
    results.push({
      control: `Responses open SSE takeover: ${cooperative ? 'abort acknowledged' : 'body ignores abort'}`,
      noEarlyEffect: true,
      verified: true,
    });
  };
  await openStream(true);
  await openStream(false);

  streamGate = gate();
  const stopStream = streamGate;
  const stopOpen = await start('responses');
  await stopStream.started.promise;
  await waitFor((run) => run.events.some((event) => event.text === 'Responses stream receiving'));
  await expectStatus(call('/api/stop', { runId: stopOpen.id }), 200);
  const revokedOpen = await waitFor(() => browser.contexts().length === 0);
  assert.equal(revokedOpen.owner, 'stopped');
  fetchGate = gate();
  const afterStream = fetchGate;
  // A state read can precede run-promise settlement by a microtask. The
  // start request may reach the server on either side of that boundary.
  const attemptedStart = await call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' });
  assert.ok([200, 409].includes(attemptedStart.status));
  stopStream.release.resolve();
  let freshRun;
  if (attemptedStart.status === 409) {
    const stoppedOpen = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(stoppedOpen.requests, 1);
    assert.deepEqual(stoppedOpen.fixture.results, []);
    await expectStatus(call('/api/return-control', control(stoppedOpen)), 409);
    freshRun = await start('responses');
  } else {
    freshRun = attemptedStart.value;
  }
  await afterStream.started.promise;
  const afterLate = await state();
  assert.equal(afterLate.id, freshRun.id);
  assert.equal(afterLate.requests, 1);
  assert.deepEqual(afterLate.fixture.results, []);
  await expectStatus(call('/api/stop', { runId: freshRun.id }), 200);
  afterStream.release.resolve();
  await waitFor((run) => run.owner === 'stopped' && !run.closing);
  results.push({
    control:
      'Stop revokes Chromium during open SSE; Start locked while draining; no late effect on fresh run',
    requests: 1,
    closingAtBrowserRevoke: revokedOpen.closing,
    startAtRevokeStatus: attemptedStart.status,
    bodyCancelled: Boolean(stopStream.cancelled),
  });

  await start('decisions', 'reservation', 'rehearsal');
  const pendingApproval = await waitFor((run) => Boolean(run.approval));
  const oldApproval = pendingApproval.approval.id;
  await expectStatus(call('/api/take-control', control(pendingApproval)), 200);
  const approvalHuman = await waitFor((run) => run.owner === 'human');
  assert.equal(Boolean(approvalHuman.approval), false);
  assert.deepEqual(approvalHuman.fixture.results, {});
  await expectStatus(
    call('/api/approval', { ...control(approvalHuman), approvalId: oldApproval, approved: true }),
    409,
  );
  const guest = currentPage.getByRole('textbox', { name: 'Guest name', exact: true });
  const guestBox = await guest.boundingBox();
  assert.ok(guestBox);
  await expectStatus(
    input(approvalHuman, {
      action: 'click',
      x: guestBox.x + guestBox.width / 2,
      y: guestBox.y + guestBox.height / 2,
    }),
    200,
  );
  await expectStatus(input(approvalHuman, { action: 'key', key: 'ControlOrMeta+A' }), 200);
  await expectStatus(input(approvalHuman, { action: 'type', text: 'Human guest' }), 200);
  assert.equal(await guest.inputValue(), 'Human guest');
  await expectStatus(input(approvalHuman, { action: 'key', key: 'ControlOrMeta+A' }), 200);
  await expectStatus(input(approvalHuman, { action: 'type', text: 'Ada' }), 200);
  await expectStatus(call('/api/return-control', control(approvalHuman)), 200);
  const newApproval = await waitFor((run) => Boolean(run.approval));
  assert.notEqual(newApproval.approval.id, oldApproval);
  await expectStatus(
    call('/api/approval', { ...control(newApproval), approvalId: oldApproval, approved: true }),
    409,
  );
  const beforeApproval = await state();
  assert.deepEqual(beforeApproval.fixture.results, {});
  await expectStatus(
    call('/api/approval', { ...control(newApproval), approvalId: newApproval.approval.id, approved: true }),
    200,
  );
  const approved = await waitFor((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(approved.result, 'verified');
  assert.equal(approved.requests, 0);
  results.push({
    control: 'handoff invalidates approvals; real text and key input; fresh consent',
    verified: true,
  });

  const requestCap = async (api) => {
    let { human } = await humanPhase(api);
    const cap = human.stepLimit;
    while (human.turns < cap) {
      fetchGate = gate();
      const held = fetchGate;
      // Each transfer must finish before admitting the next request.
      // oxlint-disable-next-line no-await-in-loop
      await expectStatus(call('/api/return-control', control(human)), 200);
      // oxlint-disable-next-line no-await-in-loop
      await held.started.promise;
      // oxlint-disable-next-line no-await-in-loop
      const agent = await state();
      // oxlint-disable-next-line no-await-in-loop
      await expectStatus(call('/api/take-control', control(agent)), 200);
      held.release.resolve();
      // oxlint-disable-next-line no-await-in-loop
      human = await waitFor((run) => run.owner === 'human');
    }
    await expectStatus(call('/api/return-control', control(human)), 200);
    const capped = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(capped.status, 'failed');
    assert.equal(capped.requests, cap);
    assert.deepEqual(capped.fixture.results, []);
    assert.equal(browser.contexts().length, 0);
    results.push({ control: `${api} whole-task request cap survives repeated handoffs`, requests: cap });
  };
  await requestCap('responses');
  await requestCap('decisions');

  const { human: busyHuman } = await humanPhase('responses');
  screenshotGate = gate();
  const busyCapture = screenshotGate;
  const busyReply = clickBilling(busyHuman);
  await busyCapture.started.promise;
  await expectStatus(input(busyHuman, { action: 'key', key: 'Tab' }), 409);
  await expectStatus(call('/api/return-control', control(busyHuman)), 409);
  const stillHuman = await state();
  assert.equal(stillHuman.owner, 'human');
  assert.equal(stillHuman.ownerVersion, busyHuman.ownerVersion);
  assert.ok(expire, 'The retained human deadline must exist while input is pending.');
  expire();
  const stoppedPhase2 = await state();
  assert.equal(stoppedPhase2.owner, 'stopped');
  busyCapture.release.resolve();
  await expectStatus(busyReply, 409);
  const expired = await waitFor((run) => !run.closing);
  assert.equal(expired.requests, 1, 'No agent request may follow expiry during human input.');
  assert.equal(expired.uncertainEffects, true);
  assert.equal(browser.contexts().length, 0);
  results.push({
    control: 'reject return during exclusive human input; honor human deadline',
    noResume: true,
  });

  const { human: refreshHuman } = await humanPhase('responses');
  screenshotGate = gate();
  const refreshCapture = screenshotGate;
  await expectStatus(call('/api/return-control', control(refreshHuman)), 200);
  await refreshCapture.started.promise;
  await expectStatus(call('/api/stop', { runId: refreshHuman.id }), 200);
  refreshCapture.release.resolve();
  const stopped = await waitFor((run) => run.owner === 'stopped' && !run.closing);
  assert.equal(stopped.requests, 1);
  assert.equal(browser.contexts().length, 0);
  results.push({ control: 'Stop during fresh return checkpoint', noLateAgent: true });
  const notesFlow = async (api) => {
    // Real page and tab changes through the same human-input arbiter as form edits.
    const { human, page: taskPage, initialRead } = await humanPhase(api);
    await expectStatus(input(human, { action: 'open_notes' }), 200);
    const notes = await waitFor((run) => run.browser?.role === 'Notes' && run.view.status === 'live');
    assert.equal(notes.browser.tabs.length, 2);
    assert.match(await currentPage.locator('body').textContent(), /Brief/u);
    const rules = await currentPage.getByRole('link', { name: 'Rules' }).boundingBox();
    const navigation = gate();
    const destination = new URL('rules', currentPage.url()).href;
    // An owned handler schedules navigation after the completed input. Normal
    // link navigation may block Playwright's screenshot until load settles.
    await currentPage.getByRole('link', { name: 'Rules' }).evaluate((link) => {
      link.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          window.__beginRules = () => {
            location.href = link.href;
          };
        },
        { once: true },
      );
    });
    // Hold only this installed local URL; all other requests retain the driver guards.
    await currentPage.route(
      destination,
      async (route) => {
        navigation.started.resolve();
        await navigation.release.promise;
        await route.continue();
      },
      { times: 1 },
    );
    const clicked = input(notes, {
      action: 'click',
      x: rules.x + rules.width / 2,
      y: rules.y + rules.height / 2,
    });
    try {
      await expectStatus(clicked, 200);
      // No second operator input: release the scheduled page handler itself.
      await currentPage.evaluate(() => window.__beginRules());
      await navigation.started.promise;
    } finally {
      navigation.release.resolve();
    }
    const afterRules = await waitFor(
      (run) => run.browser.sequence !== notes.browser.sequence && run.view.status === 'live',
    );
    // Old pair on the same still-active Notes tab cannot authorize input.
    await expectStatus(input(notes, { action: 'key', key: 'Tab' }), 409);
    await expectStatus(input(afterRules, { action: 'switch_tab', tab_id: human.browser.tabId }), 200);
    const back = await waitFor((run) => run.browser?.role === 'Task' && run.view.status === 'live');
    // Even the original Task ID matches again, but its sequence is stale.
    await expectStatus(input(human, { action: 'key', key: 'Tab' }), 409);
    assert.deepEqual(back.fixture.results, []);
    assert.equal(await taskPage.locator('body').getAttribute('data-results'), '[]');
    await expectStatus(input(back, { action: 'switch_tab', tab_id: notes.browser.tabId }), 200);
    const resumeNotes = await waitFor((run) => run.browser?.role === 'Notes' && run.view.status === 'live');
    // An inactive Task document event changes the shared sequence. No input
    // in Notes is needed to refresh the existing active page.
    await taskPage.reload();
    const afterInactive = await waitFor(
      (run) => run.browser?.sequence !== resumeNotes.browser.sequence && run.view.status === 'live',
    );
    assert.equal(afterInactive.browser.tabId, resumeNotes.browser.tabId);
    await expectStatus(input(resumeNotes, { action: 'key', key: 'Tab' }), 409);
    if (api === 'responses') {
      foreignTargets = {
        denied: 0,
        calls: [
          { name: 'browser_read_page', args: { tab_id: human.browser.tabId, filter: 'all' } },
          { name: 'browser_get_page_text', args: { tab_id: human.browser.tabId } },
          { name: 'browser_screenshot', args: { tab_id: human.browser.tabId } },
          {
            name: 'browser_click',
            args: { tab_id: human.browser.tabId, target: initialRead.elements[0].ref },
          },
        ],
      };
    }
    fetchGate = gate();
    const resumedRequest = fetchGate;
    await expectStatus(call('/api/return-control', control(afterInactive)), 200);
    const first = await resumedRequest.started.promise;
    assert.match(observation(first.body).text, /Rules/u);
    resumedRequest.release.resolve();
    const finished = await waitFor((run) => run.owner === 'stopped' && !run.closing);
    assert.equal(finished.result, 'verified', JSON.stringify(finished));
    assert.equal(finished.fixture.results.length, 3);
    results.push({
      control: `${api} actual Notes navigation, same-owner stale pair and fresh resume`,
      verified: true,
    });
  };
  await notesFlow('responses');
  await notesFlow('decisions');

  const heldAgentRead = async (api) => {
    const { human, page: taskPage } = await humanPhase(api);
    await expectStatus(input(human, { action: 'open_notes' }), 200);
    const notes = await waitFor((run) => run.browser?.role === 'Notes' && run.view.status === 'live');
    const notesPage = currentPage;
    const sample = await notesPage.evaluateHandle(() => null);
    const prototype = Object.getPrototypeOf(sample);
    await sample.dispose();
    // Hold the actual structured DOM scan after Chromium has produced its text.
    const readMethod = 'evaluate';
    const original = prototype[readMethod];
    const reading = gate();
    let reads = 0;
    prototype[readMethod] = async function heldText(...args) {
      const value = await original.apply(this, args);
      if (value?.report?.version !== 1 || !Array.isArray(value.report.elements)) {
        return value;
      }
      reads += 1;
      // Read 1 belongs to the ownership drain; read 2 supplies the new run's
      // initial observe. Hold after real Chromium produced Brief text.
      if (reads === 2) {
        reading.started.resolve(value.report.text);
        await reading.release.promise;
      }
      return value;
    };
    try {
      await expectStatus(call('/api/return-control', control(notes)), 200);
      const brief = await reading.started.promise;
      assert.match(brief, /Isolated task notes\s+Brief/u);
      const activeRead = await state();
      assert.equal(activeRead.owner, 'agent');
      assert.equal(activeRead.requests, notes.requests);
      // The owned page changes while the agent read awaits its Chromium reply.
      await notesPage.goto(new URL('rules', notesPage.url()).href);
      const changed = await waitFor(
        (run) => run.browser?.sequence !== notes.browser.sequence && run.view.status === 'live',
      );
      assert.equal(changed.browser.tabId, notes.browser.tabId);
      assert.deepEqual(JSON.parse(await taskPage.locator('body').getAttribute('data-results')), []);
      reading.release.resolve();
      const finished = await waitFor((run) => run.owner === 'stopped' && !run.closing);
      assert.equal(
        finished.requests,
        notes.requests,
        'No resumed HTTP request may contain Brief text with Rules pixels.',
      );
      assert.equal(finished.result, 'unverified');
      assert.equal(finished.uncertainEffects, false, 'A denied stale read did not attempt an effect.');
      results.push({
        control: `${api} held resumed read rejects document change before HTTP`,
        requests: finished.requests,
      });
    } finally {
      reading.release.resolve();
      prototype[readMethod] = original;
    }
  };
  await heldAgentRead('responses');
  await heldAgentRead('decisions');

  const stopDuringTabOperation = async (action) => {
    const { human, page: taskPage } = await humanPhase('responses');
    let run = human;
    if (action !== 'open_notes') {
      await expectStatus(input(run, { action: 'open_notes' }), 200);
      run = await waitFor((value) => value.browser?.role === 'Notes' && value.view.status === 'live');
    }
    const held = gate();
    let restore;
    if (action === 'open_notes') {
      pageSetupGate = held;
    } else {
      // Hold at the real Playwright method used by this admitted operation.
      const page = action === 'switch_tab' ? taskPage : currentPage;
      const method = action === 'switch_tab' ? 'bringToFront' : 'close';
      const original = page[method].bind(page);
      page[method] = async (...args) => {
        held.started.resolve();
        await held.release.promise;
        return original(...args);
      };
      restore = () => {
        page[method] = original;
      };
    }
    const pending = input(
      run,
      action === 'switch_tab' ? { action, tab_id: human.browser.tabId } : { action },
    );
    try {
      await held.started.promise;
      const busy = await state();
      assert.equal(busy.owner, 'human');
      assert.equal(busy.humanInputBusy, true);
      await expectStatus(input(busy, { action: 'key', key: 'Tab' }), 409);
      await expectStatus(call('/api/stop', { runId: run.id }), 200);
      const revoked = await waitFor(() => browser.contexts().length === 0);
      assert.equal(revoked.owner, 'stopped');
      assert.equal(revoked.view.status, 'closed');
      assert.equal(revoked.closing, true, 'The admitted browser operation has not settled yet.');
      await expectStatus(call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' }), 409);
      held.release.resolve();
      await expectStatus(pending, 409);
      const ended = await waitFor((value) => !value.closing);
      assert.equal(ended.owner, 'stopped');
      assert.equal(ended.view.status, 'closed');
      assert.equal(ended.browser, null);
      assert.equal(Boolean(ended.approval), false);
      assert.equal(ended.requests, 1);
      assert.equal(browser.contexts().length, 0);
      results.push({ control: `Stop drains held ${action} before allowing a new run`, noLateView: true });
    } finally {
      held.release.resolve();
      restore?.();
      pageSetupGate = null;
    }
  };
  await stopDuringTabOperation('open_notes');
  await stopDuringTabOperation('switch_tab');
  await stopDuringTabOperation('close_notes');

  // Keep an admitted reference disposal pending after Chromium has closed.
  const { human: transferHuman } = await humanPhase('responses');
  await expectStatus(
    call('/api/inspect', {
      ...control(transferHuman),
      consent: true,
      name: 'browser_read_page',
      args: { tab_id: null, filter: 'all' },
    }),
    200,
  );
  const sample = await currentPage.locator('body').elementHandle();
  const handlePrototype = Object.getPrototypeOf(sample);
  const originalDispose = handlePrototype.dispose;
  await sample.dispose();
  const disposal = gate();
  let holdDisposal = true;
  handlePrototype.dispose = async function dispose(...args) {
    if (holdDisposal) {
      holdDisposal = false;
      disposal.started.resolve();
      await disposal.release.promise;
    }
    return originalDispose.apply(this, args);
  };
  try {
    await expectStatus(call('/api/return-control', control(await state())), 200);
    await disposal.started.promise;
    await expectStatus(call('/api/stop', { runId: transferHuman.id }), 200);
    await waitFor(() => browser.contexts().length === 0);
    const receipt = await call(`/api/export?run=${transferHuman.id}`);
    assert.equal(receipt.value.cleanup, 'pending');
    const pendingState = await state();
    assert.equal(pendingState.closing, true);
    const closing = app.close();
    assert.equal(await Promise.race([Promise.allSettled([closing]), delay(20, 'pending')]), 'pending');
    disposal.release.resolve();
    await closing;
    results.push({
      control: 'Stop and shutdown drain control transfer after context closure',
      noLateAgent: true,
    });
  } finally {
    disposal.release.resolve();
    handlePrototype.dispose = originalDispose;
  }
  console.log(
    JSON.stringify(
      { kind: 'mock APIs and actual Chromium handoff; no live API requests', success: true, results },
      null,
      2,
    ),
  );
} finally {
  initializationGate?.release.resolve();
  pageSetupGate?.release.resolve();
  screenshotGate?.release.resolve();
  fetchGate?.release.resolve();
  streamGate?.release.resolve();
  await app.close();
  chromium.launch = originalLaunch;
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
  Date.now = originalDateNow;
}
