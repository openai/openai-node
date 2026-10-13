// Local mixed workspace, simulated desktop and transport. No API or guest.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { ComputerToolset } from 'openai/helpers/computer';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createMixedFixture, createMixedSession } from '../responses/browser/mixed-session.mjs';
import { createFieldworkMixed } from './mixed-session.mjs';

const launch = chromium.launch.bind(chromium);
const { create } = Desktop;
let ownedBrowser;
const results = [];
const action = () => assert.fail('No unexpected computer effect');
const createComputer = () =>
  new ComputerToolset({
    click: action,
    double_click: action,
    drag: action,
    keypress: action,
    move: action,
    scroll: action,
    type: action,
    wait: action,
    screenshot: () => ({ type: 'computer_screenshot', image_url: 'data:image/png;base64,AQ==' }),
  });

chromium.launch = async (...args) => {
  ownedBrowser = await launch(...args);
  return ownedBrowser;
};
async function checkReason(kind, end) {
  const stop = new AbortController();
  const computer = createComputer();
  const entered = Promise.withResolvers();
  let cleanup = 0;
  let transportAborted = false;
  const native = {
    id: 'local-mixed-stop',
    uncertainEffects: false,
    captureFrame: async () => ({ frame: Buffer.from('controlled'), width: 1024, height: 768 }),
    verify: async () => ({
      file_matches: false,
      file_empty: true,
      browser_matches: false,
      browser_effects: 0,
    }),
    withComputer: (work, { signal }) => work(computer, signal),
    async stop() {
      cleanup += 1;
    },
  };
  Desktop.create = async () => native;
  const run = {
    owner: 'agent',
    ownerVersion: 1,
    controller: stop,
    refused: false,
    checkpoints: [],
    checkpointSequence: 0,
    checkpointBytes: 0,
    checkpointDropped: 0,
    stopReason: null,
    stop(reason) {
      if (this.owner !== 'stopped') {
        this.stopReason = reason;
        this.owner = 'stopped';
        this.controller.abort();
      }
    },
  };
  const session =
    kind === 'standalone'
      ? await createMixedSession({ desktop: native, fixture: await createMixedFixture() })
      : await createFieldworkMixed({ runtimeDir: 'controlled-only', run });
  const client = new OpenAI({
    apiKey: 'local-noncredential',
    maxRetries: 0,
    fetch: async (_url, options) => {
      if (end === 'refused') {
        return Response.json({
          id: 'response-1',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc-1',
              call_id: 'fc-1',
              status: 'completed',
              name: 'browser_navigate',
              arguments: JSON.stringify({
                tab_id: null,
                url: ownedBrowser.contexts()[0].pages()[0].url(),
              }),
            },
          ],
        });
      }
      const blocked = Promise.withResolvers();
      options.signal.addEventListener(
        'abort',
        () => {
          transportAborted = true;
          blocked.reject(options.signal.reason);
        },
        { once: true },
      );
      entered.resolve();
      return blocked.promise;
    },
  });
  const phase = session.runPhase({
    client,
    model: 'fixture',
    signal: stop.signal,
    approve: async () => {
      run.refused = true;
      return false;
    },
  });
  try {
    if (end !== 'refused') {
      assert.notEqual(await Promise.race([entered.promise.then(() => true), delay(2000, false)]), false);
      if (end === 'stopped') {
        run.stop('stopped');
      }
      // A later browser loss cannot turn an operator Stop into browser_closed.
      await ownedBrowser.close();
    }
    const proof = await Promise.race([phase, delay(3000, null)]);
    assert.ok(proof, 'Admitted phase settled after its interruption');
    assert.equal(proof.status, end, kind);
    assert.equal(proof.verified, false);
    assert.equal(proof.host.routes, 0);
    if (end !== 'refused') {
      assert.equal(transportAborted, true);
    }
    if (kind === 'fieldwork' && end !== 'refused') {
      assert.equal(run.stopReason, end);
    }
    if (end === 'refused') {
      await ownedBrowser.close();
      assert.equal(run.stopReason, null, 'A later close must not replace a prior refusal');
    }
    results.push({ kind, end, status: proof.status });
  } finally {
    await session.close();
    assert.ok(cleanup >= 1, 'Owned simulated desktop retired');
    assert.equal(ownedBrowser.isConnected(), false);
  }
}

try {
  for (const kind of ['standalone', 'fieldwork']) {
    for (const end of ['browser_closed', 'stopped', 'refused']) {
      // oxlint-disable-next-line no-await-in-loop -- Each task-owned browser must close before the next case.
      await checkReason(kind, end);
    }
  }
} finally {
  Desktop.create = create;
  chromium.launch = launch;
}
assert.equal(results.length, 6);
console.log(JSON.stringify({ checks: results.length, results, api_calls: 0, vendor_calls: 0, vm_calls: 0 }));
