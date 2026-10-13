import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { exportRun, recordReceipt, recordRequest } from './run-receipt.mjs';

for (const outcome of ['complete', 'failed', 'cancelled', 'closed']) {
  const run = { mode: 'live', started: performance.now(), requests: 1, requestHeadersMs: 0 };
  const input = Promise.withResolvers();
  let readCount = 0;
  let closeCount = 0;
  const response = new Response(
    new ReadableStream(
      {
        async pull(controller) {
          readCount += 1;
          if (readCount === 1) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
          } else {
            await input.promise;
            if (outcome === 'failed') {
              throw new Error('Controlled body read failed');
            }
            controller.enqueue(new TextEncoder().encode('data: last\n\n'));
            controller.close();
          }
        },
        cancel() {
          closeCount += 1;
        },
      },
      { highWaterMark: 0 },
    ),
    {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'fixture' },
    },
  );
  Object.defineProperties(response, {
    url: { value: 'https://example.test/redirected' },
    type: { value: 'basic' },
    redirected: { value: true },
  });
  const controller = new AbortController();
  // Sequential bounded streams: one ordinary response owns each receipt.
  // oxlint-disable-next-line no-await-in-loop
  const received = await recordRequest(run, async () => response, controller.signal);
  const [receipt] = run.receipts;
  assert.equal(receipt.durationMs, null, outcome);
  assert.equal(receipt.phase, 'headers');
  assert.equal(received.response.status, 201);
  assert.equal(received.response.statusText, 'Created');
  assert.equal(received.response.headers.get('x-request-id'), 'fixture');
  assert.equal(received.response.url, response.url);
  assert.equal(received.response.type, response.type);
  assert.equal(received.response.redirected, response.redirected);
  assert.equal(readCount, 0, 'Receipt observation must not read the body in advance');
  const reader = received.response.body.getReader();
  // oxlint-disable-next-line no-await-in-loop
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'data: first\n\n');
  assert.equal(receipt.durationMs, null, 'First chunk cannot finalize a still-open response');
  if (outcome === 'closed' || outcome === 'cancelled') {
    if (outcome === 'cancelled') {
      controller.abort();
    }
    // oxlint-disable-next-line no-await-in-loop
    await reader.cancel();
    assert.equal(closeCount, 1);
    assert.equal(receipt.phase, 'cancelled');
  } else {
    const last = reader.read();
    assert.equal(receipt.durationMs, null);
    input.resolve();
    if (outcome === 'failed') {
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(last, /Controlled body read failed/u);
      assert.equal(receipt.phase, 'failed');
    } else {
      // oxlint-disable-next-line no-await-in-loop
      const next = await last;
      assert.equal(new TextDecoder().decode(next.value), 'data: last\n\n');
      // oxlint-disable-next-line no-await-in-loop
      const eof = await reader.read();
      assert.equal(eof.done, true);
      assert.equal(receipt.phase, 'headers');
    }
  }
  assert.ok(receipt.durationMs >= receipt.headersMs);
  const duration = receipt.durationMs;
  input.resolve();
  // oxlint-disable-next-line no-await-in-loop
  await delay(3);
  // Failed streams keep their original error when subsequently cancelled.
  // oxlint-disable-next-line no-await-in-loop
  await reader.cancel().catch((error) => {
    assert.equal(outcome, 'failed');
    assert.match(error.message, /Controlled body read failed/u);
  });
  assert.equal(receipt.durationMs, duration, 'A later close must not change finalized duration');
  assert.equal(response.body.locked, false, 'The source reader must release ownership');
  console.log('PASS streaming request duration', outcome);
}
{
  const run = { mode: 'live', started: performance.now(), requests: 1, requestHeadersMs: 0 };
  const readStarted = Promise.withResolvers();
  const releaseRead = Promise.withResolvers();
  const cancelStarted = Promise.withResolvers();
  const releaseCancel = Promise.withResolvers();
  let reads = 0;
  let cancels = 0;
  const original = new Response(
    new ReadableStream(
      {
        async pull() {
          reads += 1;
          readStarted.resolve();
          await releaseRead.promise;
        },
        async cancel() {
          cancels += 1;
          cancelStarted.resolve();
          await releaseCancel.promise;
        },
      },
      { highWaterMark: 0 },
    ),
  );
  const { response } = await recordRequest(run, async () => original);
  const reader = response.body.getReader();
  const reading = reader.read();
  await readStarted.promise;
  const cancelling = reader.cancel('controlled stop');
  await cancelStarted.promise;
  const stopped = await reading;
  assert.equal(stopped.done, true);
  // Source cancellation resolves the in-flight read as EOF even though cleanup has not yet finished.
  assert.equal(
    run.receipts[0].durationMs,
    null,
    'Pending cancellation must own timing until cleanup settles',
  );
  releaseCancel.resolve();
  await cancelling;
  assert.equal(run.receipts[0].phase, 'cancelled');
  const duration = run.receipts[0].durationMs;
  assert.ok(duration >= run.receipts[0].headersMs);
  assert.equal(original.body.locked, false);
  releaseRead.resolve();
  await delay(3);
  assert.deepEqual(
    { reads, cancels, duration: run.receipts[0].durationMs },
    { reads: 1, cancels: 1, duration },
  );
  console.log('PASS pending read cancellation owns final timing and releases exactly once');
}
{
  const run = { mode: 'live', started: performance.now(), requests: 1, requestHeadersMs: 0 };
  const empty = await recordRequest(run, async () => new Response(null, { status: 204 }));
  assert.equal(empty.response.body, null);
  assert.ok(run.receipts[0].durationMs >= run.receipts[0].headersMs);
  const failure = await recordRequest(run, async () =>
    Response.json({ error: { code: 'fixture' } }, { status: 403 }),
  );
  const cloned = failure.response.clone();
  assert.equal(cloned.status, 403);
  assert.equal(cloned.headers.get('content-type'), 'application/json');
  assert.deepEqual(await cloned.json(), { error: { code: 'fixture' } });
  assert.deepEqual(await failure.response.json(), { error: { code: 'fixture' } });
  assert.ok(run.receipts[1].durationMs >= run.receipts[1].headersMs);
}

const marker = 'PRIVATE_EXPORT_MARKER_53b2';
const model = 'synthetic-export-check';
const originalFetch = globalThis.fetch;
let calls = 0;
let scenario = 'text';
let app;
let browser;
try {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === '127.0.0.1') {
      return originalFetch(request);
    }
    assert.equal(url.origin, 'https://api.openai.com');
    assert.equal(url.pathname, '/v1/responses');
    calls += 1;
    if (scenario === 'http_error') {
      return Response.json({ error: { code: marker, message: marker } }, { status: 403 });
    }
    if (scenario === 'no_headers') {
      throw new Error(marker);
    }
    if (scenario === 'cancel') {
      const pending = Promise.withResolvers();
      request.signal.addEventListener('abort', () => pending.reject(new Error(marker)), { once: true });
      if (request.signal.aborted) {
        pending.reject(new Error(marker));
      }
      return pending.promise;
    }
    const response = {
      id: 'resp_export',
      object: 'response',
      status: 'completed',
      model,
      output: [
        {
          id: 'msg_export',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: marker, annotations: [] }],
        },
      ],
    };
    const events = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: { ...response, status: 'in_progress', output: [] },
      },
      { type: 'response.completed', sequence_number: 1, response },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  app = await createDemoServer({ port: 0, apiKey: 'synthetic-export-key', models: { responses: model } });
  const pageResponse = await originalFetch(app.origin);
  const html = await pageResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (path, body) => {
    const result = await originalFetch(`${app.origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  const until = async (predicate) => {
    const end = performance.now() + 20_000;
    while (performance.now() < end) {
      // Poll until this exact run reaches the boundary asserted by the caller.
      // oxlint-disable-next-line no-await-in-loop
      const value = await call('/api/state');
      if (predicate(value.run)) {
        return value.run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(25);
    }
    throw new Error('Export exercise did not reach its expected state.');
  };
  await call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' });
  const end = performance.now() + 20_000;
  let state;
  while (performance.now() < end) {
    // The export is checked only after this real local run finishes.
    // oxlint-disable-next-line no-await-in-loop
    state = await call('/api/state');
    if (state.run.status !== 'running') {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(25);
  }
  assert.equal(calls, 1);
  assert.equal(state.run.finalText, marker, 'The fake API must actually reach the displayed run.');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage();
  await page.goto(app.launchUrl);
  await page.locator('#export').waitFor({ state: 'visible' });
  const downloaded = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await downloaded;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  assert.equal(text.includes(marker), false, 'The actual UI export must omit private model text.');
  const exported = JSON.parse(text);
  assert.equal(exported.requests, 1);
  assert.equal(exported.result, 'unverified');
  console.log('PASS actual dashboard export omits private model text and preserves request/result facts');

  for (const next of ['http_error', 'no_headers', 'cancel']) {
    // Independent failed runs exercise the actual request recorder and authenticated export endpoint.
    // oxlint-disable-next-line no-await-in-loop
    await until((run) => run.owner === 'stopped' && !run.closing);
    scenario = next;
    // oxlint-disable-next-line no-await-in-loop
    const started = await call('/api/start', { taskId: 'support', api: 'responses', mode: 'live' });
    if (next === 'cancel') {
      // oxlint-disable-next-line no-await-in-loop
      await until((run) => run.requests === 1);
      // oxlint-disable-next-line no-await-in-loop
      await call('/api/stop', { runId: started.id });
    }
    // oxlint-disable-next-line no-await-in-loop
    await until((run) => run.owner === 'stopped' && !run.closing);
    // oxlint-disable-next-line no-await-in-loop
    const receipt = await call(`/api/export?run=${started.id}`);
    assert.equal(JSON.stringify(receipt).includes(marker), false);
    assert.equal(receipt.requests, 1);
    const attempt = receipt.events.find((event) => event.kind === 'request');
    assert.equal(attempt.phase, { http_error: 'headers', cancel: 'cancelled', no_headers: 'failed' }[next]);
    assert.equal(attempt.status, next === 'http_error' ? 403 : null);
    assert.ok(Number.isInteger(attempt.durationMs));
    if (next !== 'http_error') {
      assert.equal(attempt.headersMs, null);
      assert.equal(receipt.requestHeadersMs, 0);
    }
  }
  console.log('PASS HTTP error, no headers and cancellation retain request facts without error text');

  const approvalRun = await call('/api/start', {
    taskId: 'reservation',
    api: 'decisions',
    mode: 'rehearsal',
  });
  const pending = await until((run) => Boolean(run.approval));
  await call('/api/approval', {
    runId: pending.id,
    ownerVersion: pending.ownerVersion,
    tabId: pending.browser.tabId,
    sequence: pending.browser.sequence,
    approvalId: pending.approval.id,
    approved: false,
  });
  await until((run) => run.owner === 'stopped' && !run.closing);
  const refused = await call(`/api/export?run=${approvalRun.id}`);
  assert.deepEqual(
    refused.events.filter((event) => event.kind === 'approval').map((event) => event.outcome),
    ['offered', 'refused'],
  );
  assert.equal(refused.cleanup, 'completed');
  assert.equal(refused.requests, 0);
  assert.equal(Object.hasOwn(refused, 'fixture'), false);
  assert.equal(Object.hasOwn(refused, 'history'), false);
  assert.equal(Object.hasOwn(refused, 'finalText'), false);
  console.log('PASS actual approval refusal and cleanup export without task text or image history');

  const bounded = { started: performance.now(), owner: 'stopped', taskId: 'support', private: marker };
  for (let index = 0; index < 300; index += 1) {
    recordReceipt(bounded, { kind: 'control', owner: 'agent', text: marker });
  }
  const safe = exportRun(bounded);
  assert.equal(safe.events.length, 256);
  assert.equal(safe.droppedEvents, 44);
  assert.equal(JSON.stringify(safe).includes(marker), false);
  console.log('PASS export retains at most 256 allowlisted events and reports omitted count');
} finally {
  try {
    await app?.close();
  } finally {
    globalThis.fetch = originalFetch;
    await browser?.close();
  }
}
