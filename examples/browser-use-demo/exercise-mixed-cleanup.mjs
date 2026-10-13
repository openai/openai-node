// Real Fieldwork/Chromium/ledger, controlled Desktop and held synthetic API; no VM.
import assert from 'node:assert/strict';
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerToolset } from 'openai/helpers/computer';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createDemoServer } from './server.mjs';
import { createFieldworkMixed } from './mixed-session.mjs';

const originalCreate = Desktop.create;
const originalFetch = globalThis.fetch;
const before = new Set(await readdir(tmpdir()));
const entered = Promise.withResolvers();
const gate = Promise.withResolvers();
let app;
let directory;
let retained;
let stopped = false;
let requests = 0;
const stopError = new Error('controlled guest stop failure private-cause-92f3');
const unexpectedAction = () => assert.fail('The held response cannot authorize a computer action');
const computer = new ComputerToolset({
  click: unexpectedAction,
  double_click: unexpectedAction,
  drag: unexpectedAction,
  keypress: unexpectedAction,
  move: unexpectedAction,
  scroll: unexpectedAction,
  type: unexpectedAction,
  wait: unexpectedAction,
  screenshot: () => ({ type: 'computer_screenshot', image_url: 'data:image/png;base64,AQ==' }),
});
Desktop.create = async () => ({
  id: 'controlled-mixed-cleanup',
  uncertainEffects: false,
  captureFrame: async () => ({ frame: Buffer.from('controlled pixels'), width: 1024, height: 768 }),
  verify: async () => ({ file_matches: false, file_empty: true, browser_matches: false, browser_effects: 0 }),
  withComputer: (work, { signal }) => work(computer, signal),
  async stop() {
    stopped = true;
    throw stopError;
  },
});
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === '127.0.0.1') {
    return originalFetch(request);
  }
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  requests += 1;
  entered.resolve();
  await gate.promise;
  return Response.json({
    id: 'late',
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'late',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Late response cannot authorize anything', annotations: [] }],
      },
    ],
  });
};
try {
  app = await createDemoServer({
    port: 0,
    apiKey: 'synthetic',
    models: { responses: 'synthetic' },
    desktopRuntime: 'controlled-factory-only',
  });
  const response = await originalFetch(app.origin);
  const html = await response.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  const call = async (route, body, expected = 200) => {
    const reply = await originalFetch(`${app.origin}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Demo-Token': token,
        Origin: app.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(reply.status, expected, route);
    return reply.json();
  };
  await call('/api/start', { environment: 'mixed', taskId: 'mixed', api: 'responses', mode: 'live' });
  await entered.promise;
  const entries = await readdir(tmpdir());
  const created = entries.filter((name) => name.startsWith('desktop-evidence-') && !before.has(name));
  assert.equal(created.length, 1);
  directory = path.join(tmpdir(), created[0]);
  retained = `${directory}-owned-test-retained`;
  await rename(directory, retained);
  await mkdir(directory, { mode: 0o700 });
  const { run } = await call('/api/state');
  assert.ok(run.desktop);
  await call('/api/take-control', { runId: run.id, ...run.desktop });
  gate.resolve();
  let current;
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Inspect this same transfer only after its previous observation settled.
    ({ run: current } = await call('/api/state'));
    if (current.owner === 'human' || (current.owner === 'stopped' && stopped)) {
      break;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Poll one owned transfer, never start another while it is draining.
    await delay(25);
  }
  const receipt = await call(`/api/export?run=${run.id}`);
  assert.equal(current.owner, 'stopped', 'failed ledger close must never admit a human');
  assert.equal(receipt.cleanup, 'failed');
  assert.equal(receipt.result, 'unverified');
  assert.equal(stopped, true, 'retire the other owned environments after ledger failure');
  assert.equal(requests, 1, 'a failed checkpoint must never admit another agent phase');
  await call('/api/return-control', { runId: run.id, ...run.desktop }, 409);
  await call('/api/input', { runId: run.id, ...run.desktop, action: 'click', x: 700, y: 180 }, 409);
  await access(retained);
  await access(directory);
  assert.equal(JSON.stringify(receipt).includes(directory), false, 'private path never enters export');
  assert.equal(
    JSON.stringify(receipt).includes(stopError.message),
    false,
    'guest failure stays out of export',
  );
  assert.equal(
    JSON.stringify(current).includes(stopError.message),
    false,
    'guest failure stays out of dashboard state and diagnostics',
  );
  const closing = app.close();
  await assert.rejects(closing, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(
      error.errors.some((entry) => entry.message.includes(directory)),
      'CLI error must retain the original ledger path',
    );
    return true;
  });
  app = undefined;
  console.log(
    'PASS replaced mixed ledger: no handoff or new request, cleanup failed, owned guest retired, private path retained for local shutdown only',
  );
} finally {
  gate.resolve();
  try {
    await app?.close().catch(() => null);
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
    if (retained) {
      await rm(retained, { recursive: true, force: true });
    }
  } finally {
    Desktop.create = originalCreate;
    globalThis.fetch = originalFetch;
  }
}

// A guest failure must not strand the real Host browser, fixture or download area.
const areaParent = tmpdir();
const earlierAreas = new Set(await readdir(areaParent));
let guestStops = 0;
let busyGuest = true;
Desktop.create = async () => ({
  id: 'controlled-guest-stop',
  uncertainEffects: false,
  captureFrame: async () =>
    busyGuest ? null : { frame: Buffer.from('controlled pixels'), width: 1024, height: 768 },
  verify: async () => ({ file_matches: false, file_empty: true, browser_matches: false, browser_effects: 0 }),
  withComputer: (work, { signal }) => work(computer, signal),
  async stop() {
    guestStops += 1;
    throw stopError;
  },
});
let ownedArea;
try {
  const run = {
    owner: 'agent',
    ownerVersion: 0,
    started: performance.now(),
    checkpointSequence: 0,
    checkpointBytes: 0,
    checkpointDropped: 0,
    checkpoints: [],
    stop() {
      this.owner = 'stopped';
    },
  };
  const session = await createFieldworkMixed({ runtimeDir: 'controlled-factory-only', run });
  assert.ok(session.binding(), 'the real Host workspace is ready');
  await session.selectView('guest');
  assert.equal(run.owner, 'agent', 'Selecting a busy guest does not stop the run.');
  assert.equal(run.liveView, null, 'The old Host frame is revoked while guest pixels are pending.');
  assert.equal(session.binding().view, 'guest');
  busyGuest = false;
  await session.refreshView();
  assert.ok(session.matches(session.viewBinding), 'A later guest frame has the new binding.');
  assert.equal(run.liveView.frame.toString(), 'controlled pixels');
  console.log(
    'PASS switching to a busy Guest revokes Host pixels, retains the run and admits only a fresh Guest frame',
  );

  const entries = await readdir(areaParent);
  const areas = entries.filter((name) => name.startsWith('openai-file-download-') && !earlierAreas.has(name));
  assert.equal(areas.length, 1, 'one actual DownloadOwner area was created');
  ownedArea = path.join(areaParent, areas[0]);
  await access(ownedArea);
  await assert.rejects(session.close(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 1);
    const [retirement] = error.errors;
    assert.ok(retirement instanceof AggregateError);
    assert.deepEqual(retirement.errors, [stopError], 'keep the private guest failure once for its owner');
    return true;
  });
  assert.ok(guestStops >= 1, 'attempted to retire the guest');
  await assert.rejects(
    access(ownedArea),
    { code: 'ENOENT' },
    'real download area removed after guest failure',
  );
  assert.equal(session.fileState().direction, 'download');
  assert.equal(
    session.fileState().cleanup,
    'completed',
    'the guest failure does not mislabel successful file cleanup',
  );
  assert.equal(session.binding(), null);
  console.log('PASS failed guest Stop: Host and download cleanup attempted, original failure preserved');
} finally {
  Desktop.create = originalCreate;
  if (ownedArea) {
    await rm(ownedArea, { recursive: true, force: true });
  }
}
