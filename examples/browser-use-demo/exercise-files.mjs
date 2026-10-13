import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';
import { intakeNote } from './business-state.mjs';

const model = process.env['OPENAI_MODEL'];
assert.ok(model, 'Set OPENAI_MODEL to a synthetic test ID. No external request is sent.');
const { launch: savedLaunch } = chromium;
let browser;
chromium.launch = async function launch(...args) {
  browser = await savedLaunch.apply(this, args);
  return browser;
};
let app;
try {
  app = await createDemoServer({ port: 0, apiKey: 'synthetic-test-key', models: { responses: model } });
} catch (error) {
  chromium.launch = savedLaunch;
  throw error;
}
const originalFetch = globalThis.fetch;
const checks = [];
let requests = 0;
let modelRequests = [];
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === app.origin) {
    return originalFetch(request);
  }
  // Block every external connection. This supplies SDK events, never an API response.
  assert.equal(url.origin, 'https://api.openai.com');
  assert.equal(url.pathname, '/v1/responses');
  requests += 1;
  assert.ok(requests <= 2, 'No silent retry or second file grant');
  modelRequests.push(await request.json());
  const item =
    requests === 1
      ? {
          type: 'function_call',
          id: 'fc_attach',
          call_id: 'call_attach',
          name: 'attach_intake_note',
          status: 'completed',
          arguments: '{}',
        }
      : {
          type: 'message',
          id: 'msg_fixture',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Document processed.', annotations: [], logprobs: [] }],
        };
  const response = { id: 'resp_fixture', object: 'response', status: 'completed', model, output: [item] };
  const events = [
    {
      type: 'response.created',
      sequence_number: 0,
      response: { ...response, status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { ...item, status: 'in_progress' },
    },
    { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
    { type: 'response.completed', sequence_number: 3, response },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

function empty(run) {
  assert.deepEqual(run.fixture.results, []);
  assert.equal(run.fixture.revision, 0);
  assert.equal(run.fixture.verified, false);
}
function privateValuesAbsent(value) {
  assert.doesNotMatch(JSON.stringify(value), /SYNTHETIC_PRIVATE|private-[\w-]+|sha256|uploadRoot|grant_id/iu);
}
async function privateDirectories() {
  const names = await readdir(tmpdir());
  return names.filter((name) => name.startsWith('openai-file-upload-')).toSorted();
}
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
    return response.json();
  };
  const state = async () => {
    const result = await call('/api/state');
    return result.run;
  };
  const until = async (condition) => {
    const deadline = performance.now() + 14_000;
    let run;
    while (performance.now() < deadline) {
      // Poll until the preceding run state actually reaches the requested boundary.
      // oxlint-disable-next-line no-await-in-loop
      run = await state();
      if (condition(run)) {
        return run;
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(20);
    }
    throw new Error(`File fixture did not settle: ${JSON.stringify(run)}`);
  };
  const settled = () => until((run) => !run || (run.owner === 'stopped' && !run.closing));
  const page = () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === `${app.origin}/fixture/files`);
  const approve = (run, approved) =>
    call('/api/approval', {
      runId: run.id,
      ownerVersion: run.ownerVersion,
      tabId: run.browser.tabId,
      sequence: run.browser.sequence,
      approvalId: run.approval.id,
      approved,
    });
  const post = async (run, text, suffix = 'case=INTAKE-501', expectedStatus = 403) => {
    const response = await fetch(`${app.origin}/fixture/files/effect?run=${run.id}&${suffix}`, {
      method: 'POST',
      headers: { Origin: app.origin, 'Content-Type': 'application/octet-stream' },
      body: text,
    });
    assert.equal(response.status, expectedStatus);
    return response.json();
  };
  const start = async (api = 'responses') => {
    await settled();
    requests = 0;
    modelRequests = [];
    await call('/api/start', {
      taskId: 'files',
      api,
      mode: api === 'responses' ? 'live' : 'rehearsal',
      allowFileUpload: true,
    });
    const run = await until((current) => current.approval || current.owner === 'stopped');
    assert.ok(run.approval, JSON.stringify(run));
    assert.match(run.approval.label, /Approved fixture document.*INTAKE-501/u);
    assert.ok(run.approval.expiresAt > Date.now() && run.approval.expiresAt <= Date.now() + 30_000);
    empty(run);
    privateValuesAbsent(run);
    return run;
  };

  const noOptIn = await call('/api/start', { taskId: 'files', api: 'responses', mode: 'live' }, 400);
  assert.match(noOptIn.error, /Opt in.*before starting/iu);
  assert.equal(await state(), null);
  checks.push('No staging or model request without explicit strict opt-in');

  const good = await start();
  await call(
    '/api/take-control',
    {
      runId: good.id,
      ownerVersion: good.ownerVersion,
      tabId: good.browser.tabId,
      sequence: good.browser.sequence,
    },
    403,
  );
  await approve(good, true);
  const verified = await settled();
  assert.equal(verified.result, 'verified', JSON.stringify(verified));
  assert.deepEqual(verified.fixture.results, [{ operation: 'attach', job: 'INTAKE-501' }]);
  assert.equal(verified.fixture.file.current.status, 'completed');
  assert.equal(verified.fixture.file.cleanup, 'completed');
  assert.equal(requests, 2);
  privateValuesAbsent(verified);
  privateValuesAbsent(modelRequests);
  checks.push(
    'Actual Responses SSE: checked native file and one real loopback byte receipt; file handoff refused; no private state',
  );

  const local = await start('decisions');
  await approve(local, true);
  const rehearsal = await settled();
  assert.equal(rehearsal.result, 'verified', JSON.stringify(rehearsal));
  assert.equal(rehearsal.requests, 0);
  assert.equal(rehearsal.fixture.file.cleanup, 'completed');
  checks.push('Decisions rehearsal calls the same file executor and host verifier');

  const denied = await start();
  await post(denied, intakeNote);
  await post(denied, intakeNote, 'case=INTAKE-502');
  await post(denied, intakeNote, 'case=INTAKE-501&extra=1');
  await page().evaluate(() => {
    document.body.dataset.finished = 'true';
    document.body.dataset.revision = '900';
    document.body.dataset.results = '[{"operation":"attach","job":"INTAKE-501"}]';
  });
  empty(await state());
  await approve(denied, false);
  const refused = await settled();
  empty(refused);
  assert.equal(refused.status, 'refused');
  assert.equal(refused.fixture.file.current.effect, 'none');
  assert.equal(refused.fixture.file.cleanup, 'completed');
  assert.equal(requests, 1);
  checks.push('Forged receipt/page and wrong or extra case rejected; explicit refusal sends no file');

  const lostHTTP = await start();
  await page()
    .locator('input[type=file]')
    .evaluate((input) => {
      input.addEventListener('change', (event) => event.stopImmediatePropagation(), true);
    });
  await approve(lostHTTP, true);
  const missing = await settled();
  empty(missing);
  assert.equal(missing.result, 'unverified');
  assert.equal(missing.fixture.file.current.effect, 'completed', 'The native selection itself did complete');
  assert.equal(missing.fixture.file.cleanup, 'completed');
  assert.equal(requests, 1);
  checks.push('Native selection without any HTTP receipt stays unverified; no automatic retry');

  // Hold actual assignment after grant consumption and business approval.
  // A matching injected body must not commit before the original control post-check.
  for (const mode of ['replace', 'stop', 'unfinished body', 'wrong bytes', 'duplicate']) {
    // Each case needs a separate one-use owner and original control.
    // oxlint-disable-next-line no-await-in-loop
    const run = await start();
    const taskPage = page();
    // oxlint-disable-next-line no-await-in-loop
    const sample = await taskPage.locator('input[type=file]').elementHandle();
    const prototype = Object.getPrototypeOf(sample);
    const original = prototype.setInputFiles;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    prototype.setInputFiles = async function setInputFiles(...args) {
      entered.resolve();
      await release.promise;
      return original.apply(this, args);
    };
    try {
      // oxlint-disable-next-line no-await-in-loop
      await approve(run, true);
      // oxlint-disable-next-line no-await-in-loop
      assert.equal(await Promise.race([entered.promise.then(() => true), delay(3000, false)]), true);
      let staged;
      if (mode === 'unfinished body') {
        // Keep a real chunked body open after one byte. Native selection is
        // still held. Expiring the existing permit must close this request.
        const incomplete = httpRequest(`${app.origin}/fixture/files/effect?run=${run.id}&case=INTAKE-501`, {
          method: 'POST',
          headers: { Origin: app.origin, 'Content-Type': 'application/octet-stream' },
        });
        const closed = Promise.withResolvers();
        incomplete.once('close', () => closed.resolve(true));
        incomplete.once('error', () => {
          // Permit expiry closes only the admitted incomplete connection.
        });
        staged = closed.promise;
        incomplete.write(intakeNote.slice(0, 1));
      } else if (mode === 'wrong bytes') {
        // Same length and route pass admission; only the content differs.
        staged = post(run, `X${intakeNote.slice(1)}`);
      } else if (mode === 'duplicate') {
        const receive = () =>
          fetch(`${app.origin}/fixture/files/effect?run=${run.id}&case=INTAKE-501`, {
            method: 'POST',
            headers: { Origin: app.origin, 'Content-Type': 'application/octet-stream' },
            body: intakeNote,
          });
        const duplicates = [receive(), receive()];
        // Either arrival may reserve the permit; the other must refuse
        // while the original native selection is still held.
        // oxlint-disable-next-line no-await-in-loop
        const rejectedDuplicate = await Promise.race([...duplicates, delay(3000, null)]);
        assert.equal(rejectedDuplicate?.status, 403);
        staged = Promise.all(duplicates);
      } else {
        staged = post(run, intakeNote);
      }
      // Wrong-record requests cannot preempt an approved slot.
      // oxlint-disable-next-line no-await-in-loop
      await post(run, intakeNote, 'case=INTAKE-502');
      // oxlint-disable-next-line no-await-in-loop
      empty(await state());
      if (mode === 'unfinished body' && typeof globalThis.gc === 'function') {
        // Keep the deadline live even when Node 22 collects during receive.
        globalThis.gc();
      }
      if (mode === 'replace') {
        // oxlint-disable-next-line no-await-in-loop
        await taskPage.evaluate(() => {
          const row = document.querySelector('[data-record-id]');
          row.replaceWith(row.cloneNode(true));
        });
      } else if (mode === 'stop') {
        // oxlint-disable-next-line no-await-in-loop
        await call('/api/stop', { runId: run.id });
        // oxlint-disable-next-line no-await-in-loop
        const draining = await state();
        empty(draining);
        assert.equal(draining.closing, true);
        assert.equal(draining.fixture.file.cleanup, 'pending');
      } else if (mode === 'unfinished body') {
        // oxlint-disable-next-line no-await-in-loop
        const expired = await Promise.race([staged, delay(6500, false)]);
        assert.equal(expired, true, 'Expired body receive must settle');
        // oxlint-disable-next-line no-await-in-loop
        empty(await state());
      } else if (mode === 'wrong bytes') {
        // oxlint-disable-next-line no-await-in-loop
        await staged;
        // A good body cannot replenish the permit after a digest mismatch.
        // oxlint-disable-next-line no-await-in-loop
        await post(run, intakeNote);
      }
      release.resolve();
      // oxlint-disable-next-line no-await-in-loop
      const received = await staged;
      // oxlint-disable-next-line no-await-in-loop
      const end = await settled();
      if (mode === 'duplicate') {
        assert.deepEqual(received.map(({ status }) => status).toSorted(), [200, 403]);
        assert.equal(end.fixture.verified, true);
        assert.equal(end.fixture.revision, 1);
        assert.deepEqual(end.fixture.results, [{ operation: 'attach', job: 'INTAKE-501' }]);
        // The injected matching request committed after selection. The native
        // handler's later duplicate is refused, so its page confirmation
        // cannot complete. Keep the real write; stop the failed run.
        assert.equal(end.result, 'unverified');
        assert.equal(end.status, 'failed');
        // oxlint-disable-next-line no-await-in-loop
        await post(run, intakeNote);
      } else {
        empty(end);
      }
      assert.equal(
        end.fixture.file.current.effect,
        ['unfinished body', 'wrong bytes', 'duplicate'].includes(mode) ? 'completed' : 'unknown',
      );
      assert.equal(end.fixture.file.cleanup, 'completed');
      assert.equal(requests, 1);
      checks.push(
        `Admitted native selection + ${mode}: exact byte/one-use host receipt and truthful cleanup`,
      );
    } finally {
      release.resolve();
      prototype.setInputFiles = original;
      // Browser may already have closed with its original owner.
      // oxlint-disable-next-line no-await-in-loop
      await sample.dispose().catch(() => {
        // The stopped browser may already have disposed this original handle.
      });
    }
  }
  // Hold the original document after the file owner created its private area,
  // before the owner returns to the launcher. No production hook.
  const sampleContext = await browser.newContext();
  const samplePage = await sampleContext.newPage();
  const pagePrototype = Object.getPrototypeOf(samplePage);
  const originalEvaluateHandle = pagePrototype.evaluateHandle;
  const heldSetup = Promise.withResolvers();
  const releaseSetup = Promise.withResolvers();
  const beforeSetup = await privateDirectories();
  pagePrototype.evaluateHandle = async function evaluateHandle(expression, ...args) {
    const handle = await originalEvaluateHandle.call(this, expression, ...args);
    const areas = await privateDirectories();
    if (this.url() === `${app.origin}/fixture/files` && areas.length === beforeSetup.length + 1) {
      heldSetup.resolve();
      await releaseSetup.promise;
    }
    return handle;
  };
  try {
    requests = 0;
    const starting = await call('/api/start', {
      taskId: 'files',
      api: 'responses',
      mode: 'live',
      allowFileUpload: true,
    });
    assert.equal(await Promise.race([heldSetup.promise.then(() => true), delay(3000, false)]), true);
    const duringSetup = await privateDirectories();
    assert.equal(duringSetup.length, beforeSetup.length + 1);
    await call('/api/stop', { runId: starting.id });
    const closing = await state();
    assert.equal(closing.closing, true);
    assert.equal(Object.hasOwn(closing, 'approval'), false);
    empty(closing);
    assert.equal(requests, 0);
    await call(
      '/api/start',
      {
        taskId: 'files',
        api: 'responses',
        mode: 'live',
        allowFileUpload: true,
      },
      409,
    );
    releaseSetup.resolve();
    const ended = await settled();
    empty(ended);
    assert.equal(ended.fixture.file, null);
    assert.deepEqual(await privateDirectories(), beforeSetup);
    assert.equal(requests, 0);
    checks.push(
      'Stop during real file-owner initialization drains and cleans the unpublished owner; zero model requests',
    );
  } finally {
    releaseSetup.resolve();
    pagePrototype.evaluateHandle = originalEvaluateHandle;
    await sampleContext.close();
  }
  console.log(
    JSON.stringify({ scope: 'Real Chromium and loopback bytes; all model HTTP scripted locally', checks }),
  );
} finally {
  try {
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
    chromium.launch = savedLaunch;
  }
}
