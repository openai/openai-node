// A controlled owner tests a late frame crossing the real session's control boundary.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createDesktopSession, desktopInput, executeDesktop } from './desktop-session.mjs';

assert.equal(desktopInput({ action: 'scroll', direction: 'up', amount: 100 }), null);
assert.deepEqual(desktopInput({ action: 'scroll', direction: 'up', amount: 100 }, { x: 700, y: 180 }), {
  type: 'scroll',
  x: 700,
  y: 180,
  scroll_x: 0,
  scroll_y: -100,
});

// oxlint-disable no-await-in-loop -- Each run independently checks capture before or after real verification.
for (const before of [true, false]) {
  let verified = false;
  const trial = {
    id: crypto.randomUUID(),
    controller: new AbortController(),
    owner: 'agent',
    result: null,
    receipts: [],
    events: [],
    started: performance.now(),
    addEvent(kind, text) {
      this.events.push({ kind, text });
    },
    session: {
      async capture() {
        if (before || verified) {
          throw new Error('Controlled desktop capture failure');
        }
      },
      async verify() {
        verified = true;
        return { file_matches: true, browser_matches: true };
      },
      async seal() {
        return { file_matches: true, browser_matches: true };
      },
      hasUncertainEffects: () => false,
    },
  };
  await executeDesktop({ apiKey: 'local-fixture', models: { responses: 'local-fixture' }, run: trial });
  assert.equal(trial.status, 'failed');
  assert.equal(trial.result, before ? 'unverified' : 'verified');
  assert.equal(verified, !before);
  assert.equal(trial.events.at(-1).kind, 'result');
}
// oxlint-enable no-await-in-loop
console.log('PASS desktop capture failures retain verified business evidence only after verification');

const changed = {
  id: crypto.randomUUID(),
  controller: new AbortController(),
  owner: 'agent',
  result: null,
  receipts: [],
  events: [],
  started: performance.now(),
  addEvent(kind, text) {
    this.events.push({ kind, text });
  },
  session: {
    async capture() {
      return null;
    },
    async verify() {
      return { file_matches: true, browser_matches: true };
    },
    async seal() {
      return { file_matches: false, browser_matches: true };
    },
    hasUncertainEffects: () => false,
  },
};
await executeDesktop({ apiKey: 'local-fixture', models: { responses: 'local-fixture' }, run: changed });
assert.equal(changed.status, 'unverified');
assert.equal(changed.result, 'unverified');
console.log(
  'PASS a saved record that changes before terminal seal cannot publish the earlier matching proof',
);

const original = Desktop.create;
const waiting = Promise.withResolvers();
const entered = Promise.withResolvers();
let frames = 0;
let session;
let stopped = false;
const run = {
  owner: 'agent',
  ownerVersion: 0,
  started: performance.now(),
  checkpoints: [],
  checkpointSequence: 0,
  checkpointBytes: 0,
  checkpointDropped: 0,
  stop() {
    this.owner = 'stopped';
  },
};
Desktop.create = async () => ({
  id: 'controlled-owner',
  async captureFrame() {
    frames += 1;
    const capture = frames;
    if (capture === 2) {
      entered.resolve();
      await waiting.promise;
    }
    return { frame: Buffer.from(`frame-${capture}`), width: 1024, height: 768 };
  },
  async stop() {
    stopped = true;
  },
});
try {
  session = await createDesktopSession({ run, runtimeDir: 'controlled-factory-only' });
  run.owner = 'draining-to-human';
  run.ownerVersion = 1;
  const old = session.refreshView();
  await entered.promise;
  run.owner = 'human';
  run.ownerVersion = 2;
  const fresh = session.capture();
  waiting.resolve();
  await Promise.all([old, fresh]);
  assert.equal(session.viewBinding.ownerVersion, 2);
  assert.equal(run.screenshot.toString(), 'frame-3');
  assert.equal(run.checkpoints.at(-1).pixels.toString(), 'frame-3');
  console.log('PASS a delayed old-phase frame is discarded and the new owner receives a fresh capture');
} finally {
  waiting.resolve();
  await session?.close();
  assert.equal(stopped, true);
  Desktop.create = original;
}

const pendingFrame = Promise.withResolvers();
const frameEntered = Promise.withResolvers();
let captures = 0;
Desktop.create = async () => ({
  id: 'controlled-close-failure',
  async captureFrame() {
    captures += 1;
    if (captures > 1) {
      frameEntered.resolve();
      await pendingFrame.promise;
    }
    return { frame: Buffer.from('controlled frame'), width: 1024, height: 768 };
  },
  async stop() {
    throw new Error('Controlled stop failure');
  },
});
let failedSession;
try {
  failedSession = await createDesktopSession({
    run: { ...run, owner: 'agent', checkpoints: [] },
    runtimeDir: 'controlled-factory-only',
  });
  const capture = failedSession.refreshView();
  await frameEntered.promise;
  const closing = failedSession.close();
  assert.equal(await Promise.race([Promise.allSettled([closing]), delay(20, 'pending')]), 'pending');
  pendingFrame.resolve();
  await assert.rejects(closing, /Controlled stop failure/u);
  await capture;
  console.log('PASS a failed desktop stop still drains its admitted frame capture');
} finally {
  pendingFrame.resolve();
  await Promise.allSettled([failedSession?.close()]);
  Desktop.create = original;
}
