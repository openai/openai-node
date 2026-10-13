import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { createDemoServer } from './server.mjs';

// This contract test uses scripted choices through the real SDK and a real isolated Chromium.
// It does not need a key or claim model quality, API speed, or a live run.
const app = await createDemoServer({ port: 0 });
const results = [];
const binding = (run) => ({
  runId: run.id,
  ownerVersion: run.ownerVersion,
  tabId: run.browser?.tabId ?? null,
  sequence: run.browser?.sequence ?? null,
});
try {
  const dashboardResponse = await fetch(app.origin);
  const dashboard = await dashboardResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!dashboard.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token, 'The trusted launcher should supply its header token.');
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
  const waitFor = async (condition) => {
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      // Poll each state after the last; later decisions depend on the current run.
      // oxlint-disable-next-line no-await-in-loop
      const { value } = await call('/api/state');
      if (condition(value.run)) {
        return value.run;
      }
      // Keep the bounded polling loop from saturating the local server.
      // oxlint-disable-next-line no-await-in-loop
      await setTimeout(30);
    }
    throw new Error('The local demo did not reach the expected state.');
  };
  const start = async (taskId) => {
    await waitFor((state) => !state?.closing);
    const response = await call('/api/start', { taskId, api: 'decisions', mode: 'rehearsal' });
    assert.equal(response.status, 200);
    return response.value;
  };
  const checkLiveView = async (runId) => {
    const run = await waitFor((state) => state.approval && state.view?.status === 'live');
    assert.equal(run.id, runId);
    const frame = await fetch(
      `${app.origin}/api/view?run=${run.id}&tabId=${run.browser.tabId}&sequence=${run.browser.sequence}`,
      {
        headers: { 'X-Demo-Token': token },
      },
    );
    assert.equal(frame.status, 200, 'The active page must have a private live view.');
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    const pixels = Buffer.from(await frame.arrayBuffer());
    assert.deepEqual([...pixels.subarray(0, 2)], [0xff, 0xd8]);
    const denied = await Promise.all(
      [{}, { 'X-Demo-Token': 'wrong' }, { 'X-Demo-Token': token, Origin: 'https://other.invalid' }].map(
        (headers) =>
          fetch(
            `${app.origin}/api/view?run=${run.id}&tabId=${run.browser.tabId}&sequence=${run.browser.sequence}`,
            { headers },
          ),
      ),
    );
    assert.ok(denied.every((response) => response.status === 403));
    const stale = await fetch(`${app.origin}/api/view?run=old-run`, {
      headers: { 'X-Demo-Token': token },
    });
    assert.equal(stale.status, 404);
    results.push({ control: 'private live frame, access and stale-run checks', pass: true });
  };
  const checkClosedView = async (runId) => {
    await waitFor((state) => state.view?.status === 'closed');
    const closed = await fetch(`${app.origin}/api/view?run=${runId}`, {
      headers: { 'X-Demo-Token': token },
    });
    assert.equal(closed.status, 410, 'Closing the task must expire its live image route.');
  };
  const checkEndedView = async (runId) => {
    const frame = await fetch(`${app.origin}/api/view?run=${runId}`, {
      headers: { 'X-Demo-Token': token },
    });
    assert.equal(frame.status, 410, 'An ended run must reject frames before cleanup finishes.');
    const { value } = await call('/api/state');
    assert.equal(value.run.view.status, 'closed');
  };
  for (const taskId of ['support', 'reservation', 'invoices']) {
    // A single demo server allows only one run at a time.
    // oxlint-disable-next-line no-await-in-loop
    await start(taskId);
    // Wait for the run just started before evaluating or approving it.
    // oxlint-disable-next-line no-await-in-loop
    let run = await waitFor((state) => state.approval || state.status !== 'running');
    while (run.approval) {
      if (taskId === 'reservation') {
        // This view belongs to the pending action; verify it before approval.
        // oxlint-disable-next-line no-await-in-loop
        await checkLiveView(run.id);
      }
      // Approval ID belongs to this exact pending action.
      // oxlint-disable-next-line no-await-in-loop
      const response = await call('/api/approval', {
        runId: run.id,
        ownerVersion: run.ownerVersion,
        tabId: run.browser?.tabId ?? null,
        sequence: run.browser?.sequence ?? null,
        approvalId: run.approval.id,
        approved: true,
      });
      assert.equal(response.status, 200);
      // The next approval cannot be known until the preceding action completes.
      // oxlint-disable-next-line no-await-in-loop
      run = await waitFor((state) => state.approval || state.status !== 'running');
    }
    assert.equal(run.status, 'complete', JSON.stringify(run));
    assert.equal(run.result, 'verified');
    assert.equal(run.fixture.verified, true);
    assert.equal(run.requests, 0);
    assert.equal(run.mode, 'rehearsal');
    if (taskId === 'reservation') {
      // Check cleanup before the next task replaces the current run.
      // oxlint-disable-next-line no-await-in-loop
      await checkClosedView(run.id);
    }
    results.push({ taskId, outcome: run.status, apiRequests: run.requests });
  }

  await start('invoices');
  const beforeNotes = await waitFor((state) => state.approval && state.view?.status === 'live');
  const takeover = await call('/api/take-control', binding(beforeNotes));
  assert.equal(takeover.status, 200);
  const human = await waitFor((state) => state.owner === 'human' && state.view.status === 'live');
  const pausedReceipt = await call(`/api/export?run=${human.id}`);
  assert.equal(pausedReceipt.value.status, 'paused');
  assert.equal(pausedReceipt.value.owner, 'human');
  const captured = await call('/api/inspect', {
    ...binding(human),
    name: 'browser_screenshot',
    args: { tab_id: null },
    consent: true,
  });
  assert.equal(captured.status, 200);
  assert.ok(captured.value.output.output.some((item) => item.type === 'input_image'));
  const openNotes = await call('/api/input', { ...binding(human), action: 'open_notes' });
  assert.equal(openNotes.status, 200);
  const notes = await waitFor((state) => state.browser?.role === 'Notes' && state.view.status === 'live');
  assert.deepEqual(notes.fixture.results, []);
  const inputCases = [
    ...[
      'Enter',
      'Tab',
      'Backspace',
      'Delete',
      'Escape',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Space',
      'ControlOrMeta+A',
    ].map((key) => [{ action: 'key', key }, 200]),
    [{ action: 'key', key: 'ControlOrMeta+L' }, 400],
    [{ action: 'key', key: 'ControlOrMeta+S' }, 400],
    [{ action: 'type', text: '' }, 400],
    [{ action: 'type', text: 'x'.repeat(2000) }, 200],
    [{ action: 'type', text: 'x'.repeat(2001) }, 400],
    [{ action: 'type', text: 'line one\nline two' }, 200],
    [{ action: 'type', text: '🙂'.repeat(1000) }, 200],
    [{ action: 'type', text: `${'🙂'.repeat(1000)}a` }, 400],
    [{ action: 'scroll', direction: 'down', amount: 1 }, 200],
    [{ action: 'scroll', direction: 'up', amount: 2048 }, 200],
    [{ action: 'scroll', direction: 'right', amount: 2049 }, 400],
    [{ action: 'scroll', direction: 'left', amount: 0 }, 400],
    [{ action: 'scroll', direction: 'down', amount: 1.5 }, 400],
  ];
  for (const [action, expected] of inputCases) {
    // oxlint-disable-next-line no-await-in-loop
    const current = await waitFor((state) => !state.humanInputBusy && state.view.status === 'live');
    // oxlint-disable-next-line no-await-in-loop
    const response = await call('/api/input', { ...binding(current), ...action });
    assert.equal(response.status, expected, JSON.stringify({ action, response }));
  }
  results.push({ control: 'browser input contract', cases: inputCases.length, pass: true });
  for (let index = 0; index < 257; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Each input uses the current ownership and frame binding.
    const current = await waitFor((state) => !state.humanInputBusy && state.view?.status === 'live');
    // oxlint-disable-next-line no-await-in-loop -- Exercise the real HTTP input boundary sequentially.
    const response = await call('/api/input', { ...binding(current), action: 'key', key: 'ArrowLeft' });
    assert.equal(response.status, 200);
  }
  const bounded = await waitFor((state) => !state.humanInputBusy);
  assert.equal(bounded.events.length, 256);
  assert.ok(bounded.eventsDropped > 0);
  assert.equal(bounded.events[0].kind, 'human');
  results.push({ control: 'bounded event history', dropped: bounded.eventsDropped, pass: true });
  const returnFromNotes = await waitFor((state) => !state.humanInputBusy && state.view.status === 'live');
  const returnControl = await call('/api/return-control', binding(returnFromNotes));
  assert.equal(returnControl.status, 200);
  const resumed = await waitFor((state) => state.approval || state.owner === 'stopped');
  assert.ok(resumed.approval, `Resuming from Notes must request fresh approval: ${JSON.stringify(resumed)}`);
  assert.equal(resumed.browser.role, 'Task');
  assert.notEqual(resumed.approval.id, beforeNotes.approval.id);
  const reapproval = await call('/api/approval', {
    ...binding(resumed),
    approvalId: resumed.approval.id,
    approved: true,
  });
  assert.equal(reapproval.status, 200);
  const completedAfterNotes = await waitFor((state) => state.owner === 'stopped' && !state.closing);
  assert.equal(completedAfterNotes.status, 'complete');
  assert.equal(completedAfterNotes.result, 'verified');
  assert.equal(completedAfterNotes.fixture.verified, true);
  assert.equal(completedAfterNotes.requests, 0);
  results.push({ control: 'unfinished rehearsal resumes from Notes, then verifies the fixture', pass: true });

  await start('invoices');
  const refused = await waitFor((state) => state.approval);
  const oldApprovalId = refused.approval.id;
  const refusal = await call('/api/approval', {
    runId: refused.id,
    ownerVersion: refused.ownerVersion,
    tabId: refused.browser?.tabId ?? null,
    sequence: refused.browser?.sequence ?? null,
    approvalId: oldApprovalId,
    approved: false,
  });
  assert.equal(refusal.status, 200);
  await checkEndedView(refused.id);
  const refusedFinal = await waitFor((state) => state.status !== 'running');
  assert.equal(refusedFinal.status, 'refused');
  assert.deepEqual(refusedFinal.fixture.results, []);
  assert.equal(refusedFinal.fixture.verified, false);
  results.push({ control: 'refuse', noSubmission: true });

  await start('invoices');
  const fresh = await waitFor((state) => state.approval);
  const staleRun = await call('/api/approval', {
    runId: refused.id,
    ownerVersion: refused.ownerVersion,
    tabId: refused.browser?.tabId ?? null,
    sequence: refused.browser?.sequence ?? null,
    approvalId: oldApprovalId,
    approved: true,
  });
  assert.equal(staleRun.status, 409);
  const staleApproval = await call('/api/approval', {
    runId: fresh.id,
    ownerVersion: fresh.ownerVersion,
    tabId: fresh.browser?.tabId ?? null,
    sequence: fresh.browser?.sequence ?? null,
    approvalId: oldApprovalId,
    approved: true,
  });
  assert.equal(staleApproval.status, 409);
  const stop = await call('/api/stop', { runId: fresh.id });
  assert.equal(stop.status, 200);
  await checkEndedView(fresh.id);
  const stopped = await waitFor((state) => state.status !== 'running');
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.fixture.results, []);
  results.push({ control: 'stale approval and stop', noSubmission: true });

  const unauthed = await fetch(`${app.origin}/api/state`);
  assert.equal(unauthed.status, 403);
  // Fetch can replace a forged Host. Use the HTTP boundary to send the actual wire header.
  const forgedHost = httpRequest(app.origin, { headers: { Host: 'rebound.invalid' } });
  const forgedReply = once(forgedHost, 'response');
  forgedHost.end();
  const [forgedResponse] = await forgedReply;
  forgedResponse.resume();
  assert.equal(forgedResponse.statusCode, 403);
  const otherOrigin = await fetch(app.origin, { headers: { Origin: 'https://other.invalid' } });
  assert.equal(otherOrigin.status, 403);
  const wrongRehearsal = await call('/api/start', { taskId: 'support', api: 'responses', mode: 'rehearsal' });
  assert.equal(wrongRehearsal.status, 400);
  const unconfigured = await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'live' });
  assert.equal(unconfigured.status, 400);
  results.push({ control: 'origin, token and run-mode checks', pass: true });
  console.log(JSON.stringify({ kind: 'local rehearsal contract', success: true, results }, null, 2));
} finally {
  await app.close();
}
