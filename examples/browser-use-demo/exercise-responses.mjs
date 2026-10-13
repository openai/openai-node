import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoSession } from './runner.mjs';
import { createDemoServer } from './server.mjs';

// This exercise has no credential input. Its caller supplies a synthetic ID solely to satisfy
// the demo's configured-model check. Outbound requests are intercepted; this is never a live API run.
const model = process.env['OPENAI_MODEL'];
assert.ok(model, 'Set OPENAI_MODEL to a synthetic test ID before running this mock exercise.');
const app = await createDemoServer({
  port: 0,
  apiKey: 'synthetic-test-key',
  models: { responses: model },
});
const originalFetch = globalThis.fetch;
let scenario = 'stream_open';
let requests = 0;
const results = [];
let heldStream;

function toolResponse(name, args, id) {
  const completed = {
    id: `resp_${id}`,
    object: 'response',
    status: 'completed',
    model,
    output: [
      {
        type: 'function_call',
        status: 'completed',
        id: `fc_${id}`,
        call_id: `call_${id}`,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
  const [item] = completed.output;
  const events = [
    {
      type: 'response.created',
      sequence_number: 0,
      response: { ...completed, status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { ...item, status: 'in_progress' },
    },
    { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
  ];
  const encoder = new TextEncoder();
  const encode = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encode(event));
        }
        const finish = () => {
          if (scenario === 'broken_error') {
            controller.error(new Error('Synthetic provider dropped SSE body'));
            heldStream = undefined;
            return;
          }
          if (scenario === 'broken_malformed') {
            controller.enqueue(new TextEncoder().encode('data: {"type":\n\n'));
          }
          if (scenario.startsWith('broken_')) {
            controller.close();
            heldStream = undefined;
            return;
          }
          controller.enqueue(encode({ type: 'response.completed', sequence_number: 3, response: completed }));
          controller.close();
          heldStream = undefined;
        };
        if (scenario === 'stream_open' || scenario.startsWith('broken_')) {
          heldStream = { finish };
        } else {
          finish();
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

try {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const taskId of ['support', 'invoices', 'reservation']) {
      const run = { taskId, owner: 'agent', ownerVersion: 1, controller: new AbortController() };
      // Each session has its own launcher declarations and disposable context.
      // oxlint-disable-next-line no-await-in-loop
      const session = await createDemoSession({
        browser,
        origin: app.origin,
        run,
        onClose: () => run.controller.abort(),
      });
      try {
        // The page cannot grant itself reservation-field disclosure by copying markers.
        // oxlint-disable-next-line no-await-in-loop
        await session.taskPage.evaluate((kind) => {
          if (kind === 'reservation') {
            document.querySelector('[data-browser-field="guest_name"]').value = 'Ada';
            return;
          }
          const section = document.createElement('section');
          section.dataset.recordId = 'TABLE-204';
          section.style.cssText = 'position:fixed;left:700px;top:250px;background:white';
          const input = document.createElement('input');
          input.dataset.browserField = 'guest_name';
          input.setAttribute('aria-label', 'Copied guest field');
          input.value = 'COPIED_PRIVATE_VALUE';
          const select = document.createElement('select');
          select.dataset.browserField = 'time';
          select.setAttribute('aria-label', 'Copied time field');
          select.add(new Option('COPIED_PRIVATE_OPTION', 'private'));
          section.append(input, select);
          document.body.append(section);
        }, taskId);
        // Read through the real owned driver rather than checking only configuration.
        // oxlint-disable-next-line no-await-in-loop
        const read = await session.base.read_page({ tab_id: null, filter: 'all' });
        const guest = read.elements.find(
          (item) => item.label === (taskId === 'reservation' ? 'Guest name' : 'Copied guest field'),
        );
        const time = read.elements.find(
          (item) => item.label === (taskId === 'reservation' ? 'Time' : 'Copied time field'),
        );
        assert.ok(guest);
        assert.ok(time);
        if (taskId === 'reservation') {
          assert.equal(guest.value, 'Ada');
          assert.ok(time.options.some((option) => option.label === '18:00'));
        } else {
          assert.equal(guest.value, undefined);
          assert.equal(time.options, undefined);
        }
      } finally {
        // Finish one context before admitting the next.
        // oxlint-disable-next-line no-await-in-loop
        await session.close();
      }
    }
    results.push({ scenario: 'Reservation-only field values; copied support/invoice markers stay private' });
  } finally {
    await browser.close();
  }
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === app.origin) {
      return originalFetch(request);
    }
    // No fallback: even an unexpected external destination must never reach the real network.
    if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/responses') {
      throw new Error('Unexpected outbound destination in mock Responses exercise.');
    }
    requests += 1;
    assert.equal(request.method, 'POST');
    if (scenario === 'http_error') {
      return Response.json(
        { error: { code: `denied-${model}`, message: `synthetic-test-key ${model} sk-FIXTUREONLY` } },
        {
          status: 422,
          headers: { 'X-Request-Id': `request-${model}`, 'X-Unrelated-Secret': 'PRIVATE_HEADER' },
        },
      );
    }
    if (scenario === 'abort') {
      // The dashboard stop must cancel this actual SDK request, not a timer in the exercise.
      await delay(30_000, undefined, { signal: request.signal });
      throw new Error('The mock fetch should have been cancelled.');
    }
    const body = await request.json();
    assert.ok(body.tools.some((tool) => tool.name === 'browser_read_page'));
    if (scenario === 'stream_open' || scenario.startsWith('broken_')) {
      const initial = body.input[0].content.find(
        (block) => block.type === 'input_text' && block.text.startsWith('{'),
      );
      const approve = JSON.parse(initial.text).elements.find((element) => element.label === 'Approve');
      assert.ok(approve);
      return toolResponse('browser_click', { tab_id: null, target: approve.ref }, 'held-approve');
    }
    if (requests === 1) {
      return toolResponse('browser_read_page', { tab_id: null, filter: 'interactive' }, 'read');
    }
    assert.equal(requests, 2, 'Refusal must prevent a third API request.');
    const output = body.input.find(
      (item) => item.type === 'function_call_output' && item.call_id === 'call_read',
    );
    assert.ok(output, 'The SDK must continue with the real read_page result.');
    const block = output.output.find((part) => part.type === 'input_text');
    assert.ok(block);
    const read = JSON.parse(block.text);
    assert.equal(read.ok, true);
    const observed = read.result;
    assert.equal(observed.version, 1, 'The SDK must return a validated structured read.');
    assert.ok(observed.elements.every((element) => !Object.hasOwn(element, 'record')));
    const approve = observed.elements.find((element) => element.label === 'Approve');
    assert.ok(approve, 'Approve must be an actually observed browser ref.');
    assert.equal(approve.role, 'button');
    return toolResponse('browser_click', { tab_id: null, target: approve.ref }, 'click');
  };

  const dashboardResponse = await fetch(app.origin);
  const dashboard = await dashboardResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!dashboard.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (path, body) => {
    const response = await fetch(`${app.origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  const waitFor = async (condition, timeout = 20_000) => {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      // State depends on the preceding browser step; do not poll concurrently.
      // oxlint-disable-next-line no-await-in-loop
      const { value } = await call('/api/state');
      if (condition(value.run)) {
        return value.run;
      }
      // Pace the bounded loop on the local server.
      // oxlint-disable-next-line no-await-in-loop
      await delay(30);
    }
    throw new Error('The mock Responses run did not reach the expected state.');
  };

  const held = await call('/api/start', { taskId: 'invoices', api: 'responses', mode: 'live' });
  assert.equal(held.status, 200);
  const receiving = await waitFor(
    (state) => state.events.some((event) => event.text === 'Responses stream receiving'),
    1800,
  );
  assert.ok(heldStream, 'Progress must be visible while EOF and response.completed are still held');
  assert.equal(receiving.requests, 1);
  assert.deepEqual(receiving.fixture.results, []);
  assert.equal(
    Boolean(receiving.approval),
    false,
    'A completed item in an open response cannot request consent',
  );
  heldStream.finish();
  const freshApproval = await waitFor((state) => Boolean(state.approval));
  await call('/api/approval', {
    runId: freshApproval.id,
    ownerVersion: freshApproval.ownerVersion,
    tabId: freshApproval.browser?.tabId ?? null,
    sequence: freshApproval.browser?.sequence ?? null,
    approvalId: freshApproval.approval.id,
    approved: false,
  });
  await waitFor((state) => state.owner === 'stopped' && !state.closing);
  results.push({ scenario: 'SSE progress before completion; no early effect or approval', requests });

  for (const failure of ['broken_missing', 'broken_malformed', 'broken_error']) {
    scenario = failure;
    requests = 0;
    // Each broken response starts in a new isolated task context.
    // oxlint-disable-next-line no-await-in-loop
    await call('/api/start', { taskId: 'invoices', api: 'responses', mode: 'live' });
    // oxlint-disable-next-line no-await-in-loop
    const partial = await waitFor((state) =>
      state.events.some((event) => event.text === 'Responses stream receiving'),
    );
    assert.equal(Boolean(partial.approval), false);
    assert.deepEqual(partial.fixture.results, []);
    assert.ok(Number.isSafeInteger(partial.requestHeadersMs));
    heldStream.finish();
    // oxlint-disable-next-line no-await-in-loop
    const failed = await waitFor((state) => state.owner === 'stopped' && !state.closing);
    assert.equal(failed.result, 'unverified');
    assert.deepEqual(failed.fixture.results, []);
    assert.equal(failed.requests, 1);
    assert.equal(failed.requestHeadersMs, partial.requestHeadersMs, 'SSE body wait is not time to headers');
    assert.equal(requests, 1, 'No retry after an incomplete or invalid response');
    results.push({ scenario: failure, requests, noEarlyEffect: true, headerTimingFrozen: true });
  }
  scenario = 'http_error';
  requests = 0;
  await call('/api/start', { taskId: 'invoices', api: 'responses', mode: 'live' });
  const denied = await waitFor((state) => state.owner === 'stopped' && !state.closing);
  assert.equal(denied.apiFailure.status, 422);
  assert.equal(denied.requests, 1);
  assert.deepEqual(denied.fixture.results, []);
  const published = JSON.stringify(denied);
  assert.ok(!published.includes(model));
  assert.doesNotMatch(published, /synthetic-test-key|sk-FIXTUREONLY|PRIVATE_HEADER/u);
  results.push({
    scenario: 'HTTP error status retained; bounded fields sanitized; unrelated headers absent',
    requests,
  });

  scenario = 'refuse';
  requests = 0;
  const first = await call('/api/start', { taskId: 'invoices', api: 'responses', mode: 'live' });
  assert.equal(first.status, 200);
  const pending = await waitFor((state) => state.approval || state.status !== 'running');
  assert.ok(pending.approval, 'The real Approve action should wait for operator consent.');
  assert.equal(requests, 2);
  const decline = await call('/api/approval', {
    runId: pending.id,
    ownerVersion: pending.ownerVersion,
    tabId: pending.browser?.tabId ?? null,
    sequence: pending.browser?.sequence ?? null,
    approvalId: pending.approval.id,
    approved: false,
  });
  assert.equal(decline.status, 200);
  const refused = await waitFor((state) => state.status !== 'running');
  assert.equal(refused.status, 'refused');
  assert.equal(refused.result, 'unverified');
  assert.equal(requests, 2, 'No further request may follow explicit operator refusal.');
  assert.equal(refused.requests, 2);
  assert.deepEqual(refused.fixture.results, []);
  assert.equal(refused.fixture.verified, false);
  results.push({ scenario: 'mock Responses refusal', requests, outcome: refused.status, fixtureEmpty: true });

  scenario = 'abort';
  requests = 0;
  await waitFor((state) => !state.closing);
  const second = await call('/api/start', { taskId: 'invoices', api: 'responses', mode: 'live' });
  assert.equal(second.status, 200);
  const fetching = await waitFor((state) => state.requests > 0 || state.status !== 'running');
  assert.equal(fetching.status, 'running');
  assert.equal(requests, 1);
  // Give an in-flight request measurable time before exercising cancellation.
  await delay(40);
  const stop = await call('/api/stop', { runId: fetching.id });
  assert.equal(stop.status, 200);
  const stopped = await waitFor((state) => state.status !== 'running' && !state.closing);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.result, 'unverified');
  assert.equal(requests, 1, 'SDK retries must stop when the operator cancels.');
  assert.equal(stopped.requests, 1);
  assert.equal(stopped.requestHeadersMs, 0, 'A cancelled pre-header fetch never received headers.');
  const exportReply = await call(`/api/export?run=${stopped.id}`);
  assert.equal(exportReply.status, 200);
  const cancelled = exportReply.value.events.find(
    (event) => event.kind === 'request' && event.phase === 'cancelled',
  );
  assert.ok(cancelled, 'The completed receipt must preserve the cancelled attempt.');
  assert.equal(cancelled.headersMs, null);
  assert.ok(cancelled.durationMs > 0, 'Time spent in a failed pre-header fetch must be retained.');
  assert.deepEqual(stopped.fixture.results, []);
  assert.equal(stopped.fixture.verified, false);
  results.push({
    scenario: 'mock Responses aborted fetch',
    requests,
    outcome: stopped.status,
    requestHeadersMs: stopped.requestHeadersMs,
    fixtureEmpty: true,
  });
  console.log(
    JSON.stringify({ kind: 'mock Responses, real Chromium; not live API', success: true, results }, null, 2),
  );
} finally {
  try {
    heldStream?.finish();
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
