// Controlled process/socket checks for transport ownership. Real PNG/X11 checks are separate.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Desktop } from './desktop.mjs';
import { writeTestReceipt } from './test-runtime.mjs';

assert.equal(typeof globalThis.gc, 'function', 'Run this exercise with --expose-gc.');
const pixels = PNG.sync.write(new PNG({ width: 1024, height: 768 }));

async function runtime(mode) {
  let frame = pixels;
  if (mode === 'ihdr-only') {
    frame = pixels.subarray(0, 33);
  }
  if (mode === 'no-iend') {
    frame = pixels.subarray(0, -12);
  }
  const root = await mkdtemp(path.join(tmpdir(), 'view-'));
  await Promise.all(['bin', 'build', 'runs'].map((name) => mkdir(path.join(root, name), { mode: 0o700 })));
  const file = await open(path.join(root, 'build/desktop.raw'), 'wx', 0o400);
  await file.truncate(16 * 1024 ** 3);
  await file.close();
  const program = `#!${process.execPath}
const fs = require('node:fs');
const net = require('node:net');
const socket = process.argv.find(x => x.startsWith('virtio-vsock,')).split('socketURL=')[1].split(',')[0];
const mode = ${JSON.stringify(mode)};
const image = 'data:image/png;base64,${frame.toString('base64')}';
fs.writeFileSync('../../pid', String(process.pid));
net.createServer({allowHalfOpen:true}, connection => {
  let data = '';
  connection.on('data', part => { data += part; });
  connection.on('end', () => {
    const action = JSON.parse(data);
    fs.appendFileSync('../../requests', action.type + '\\n');
    if (action.type === 'ready' && mode === 'startup') {
      fs.writeFileSync('../../ready-entered', '1');
      return;
    }
    if ((action.type === 'verify' || action.type === 'seal') && mode.startsWith('proof-')) {
      const proof = {ok:true,file_matches:false,browser_matches:false,file_empty:true,browser_effects:0};
      if (mode === 'proof-strings') Object.assign(proof, {file_matches:'false',browser_matches:'false'});
      if (mode === 'proof-missing') delete proof.file_empty;
      if (mode === 'proof-bool-count') proof.browser_effects = true;
      if (mode === 'proof-negative') proof.browser_effects = -1;
      if (mode === 'proof-oversize') proof.browser_effects = null;
      connection.end(JSON.stringify(proof) + '\\n');
      return;
    }
    if ((action.type === 'verify' || action.type === 'seal') && mode === 'phase-' + action.type) {
      fs.writeFileSync('../../phase-entered', '1');
      const timer = setInterval(() => {
        if (fs.existsSync('../../release')) {
          clearInterval(timer);
          connection.end(JSON.stringify({ok:true,file_matches:false,browser_matches:false,file_empty:true,browser_effects:0}) + '\\n');
        }
      }, 5);
      return;
    }
    if (action.type === 'ready' || action.type === 'verify') {
      connection.end(JSON.stringify({ok:true,file_matches:false,browser_matches:false,file_empty:true,browser_effects:0}) + '\\n');
      return;
    }
    const capture = action.type === 'screenshot';
    if (capture) {
      if (fs.existsSync('frame.png')) fs.writeFileSync('../../collision', '1');
      fs.writeFileSync('frame.png', image);
      fs.writeFileSync('../../capture-entered', '1');
    } else if (action.type === 'seal') {
      fs.writeFileSync('../../seal-entered', '1');
    } else {
      fs.appendFileSync('../../effects', '1\\n');
      fs.writeFileSync('../../input-entered', '1');
    }
    const complete = () => {
      if (capture) {
        const result = mode === 'malformed' ? 'data:image/png;base64,SGk=' : fs.readFileSync('frame.png','utf8');
        fs.unlinkSync('frame.png');
        connection.end(JSON.stringify({ok:true,image_url:result}) + '\\n');
      } else connection.end(JSON.stringify({ok:true}) + '\\n');
    };
    if (capture && mode === 'budget') {
      setTimeout(complete, 5200);
      return;
    }
    const held = (capture && mode !== 'input') || (!capture && (mode === 'input' || mode === 'seal'));
    if (!held || fs.existsSync('../../release')) complete();
    else {
      const timer = setInterval(() => {
        if (fs.existsSync('../../release')) { clearInterval(timer); complete(); }
      }, 5);
    }
  });
}).listen(socket);
`;
  await writeFile(path.join(root, 'bin/vfkit'), program, { flag: 'wx', mode: 0o700 });
  await writeTestReceipt(root);
  return root;
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

async function entered(root, name) {
  const end = performance.now() + 3000;
  while (performance.now() < end) {
    // The next poll depends on the child reaching this exact request boundary.
    // oxlint-disable-next-line no-await-in-loop
    if (await exists(path.join(root, name))) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  throw new Error('Controlled child never received the expected request.');
}

function typeCall() {
  return {
    type: 'computer_call',
    id: 'cu_view',
    call_id: 'call_view',
    status: 'completed',
    actions: [{ type: 'type', text: 'synthetic input' }],
    pending_safety_checks: [],
  };
}

function type(desktop, signal, beforeAction) {
  return desktop.withComputer(
    (computer, phase) =>
      computer.execute(typeCall(), {
        signal: phase,
        beforeAction: () => {
          beforeAction?.();
          return true;
        },
      }),
    { signal },
  );
}

async function noCollision(root) {
  assert.equal(await exists(path.join(root, 'collision')), false);
}

async function gone(root) {
  assert.deepEqual(await readdir(path.join(root, 'runs')), []);
  const pid = Number(await readFile(path.join(root, 'pid'), 'utf-8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

async function checkPhase(timed) {
  const root = await runtime('frame');
  let desktop;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    const view = desktop.captureFrame();
    await entered(root, 'capture-entered');
    assert.equal(await desktop.captureFrame(), null);
    const phase = new AbortController();
    let policyReached = false;
    const action = type(desktop, timed ? AbortSignal.timeout(40) : phase.signal, () => {
      policyReached = true;
    });
    const rejected = assert.rejects(action);
    await delay(10);
    assert.equal(
      policyReached,
      true,
      'The SDK must admit the action before its transport wait is cancelled.',
    );
    globalThis.gc();
    if (timed) {
      await delay(80);
    } else {
      phase.abort();
    }
    // Cancellation must settle before the independent viewer is released.
    await Promise.race([
      rejected,
      delay(1000, undefined, { ref: false }).then(() => {
        throw new Error('Queued input waited for an uncancelled viewer.');
      }),
    ]);
    await writeFile(path.join(root, 'release'), '1');
    const frame = await view;
    assert.equal(frame.width, 1024);
    assert.equal(frame.height, 768);
    await rejected;
    assert.equal(await exists(path.join(root, 'effects')), false);
    assert.equal(desktop.uncertainEffects, false);
    await type(desktop);
    const effects = await readFile(path.join(root, 'effects'), 'utf-8');
    assert.equal(effects.trim(), '1');
    await noCollision(root);
    await desktop.stop();
    await gone(root);
    console.log(
      `PASS viewer busy; waiting input revoked; fresh phase works${timed ? '; timeout survives GC' : ''}`,
    );
  } finally {
    await desktop?.stop();
    await rm(root, { recursive: true });
  }
}

async function checkStartup() {
  const root = await runtime('startup');
  const phase = new AbortController();
  const creating = Desktop.create({ runtimeDir: root, signal: phase.signal });
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Compare with the actual caller abort reason.
  const rejected = assert.rejects(creating, (error) => error === phase.signal.reason);
  try {
    await entered(root, 'ready-entered');
    const stopped = performance.now();
    phase.abort();
    await rejected;
    await gone(root);
    assert.ok(performance.now() - stopped < 1500, 'Stopped readiness must not wait for its network timeout');
    assert.equal(await exists(path.join(root, 'effects')), false);
    console.log('PASS startup cancellation reaps the exact child before any input or published desktop');
  } finally {
    phase.abort();
    const [result] = await Promise.allSettled([creating, rejected]);
    if (result.status === 'fulfilled') {
      await result.value.stop();
    }
    await rm(root, { recursive: true });
  }
}

/* oxlint-disable no-await-in-loop -- Each owned test guest must be reaped before creating the next. */
async function checkProofs() {
  for (const mode of ['strings', 'missing', 'bool-count', 'negative', 'oversize']) {
    for (const operation of ['verify', 'seal']) {
      const root = await runtime(`proof-${mode}`);
      let desktop;
      try {
        desktop = await Desktop.create({ runtimeDir: root });
        if (mode === 'oversize') {
          const proof = await desktop[operation]();
          assert.equal(proof.browser_effects, null);
          assert.equal(proof.file_matches, false);
          assert.equal(desktop.uncertainEffects, false);
        } else {
          await assert.rejects(desktop[operation](), /Invalid private desktop reply/u);
          await gone(root);
          await assert.rejects(desktop.verify(), /stopped|retired/u);
        }
      } finally {
        await desktop?.stop();
        await rm(root, { recursive: true });
      }
    }
  }
  console.log('PASS verify/seal proof fields reject malformed values; null count remains a failed proof');
}
/* oxlint-enable no-await-in-loop */

async function checkFailure(mode) {
  const root = await runtime(mode);
  let desktop;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    const viewRejected = assert.rejects(desktop.captureFrame());
    await entered(root, 'capture-entered');
    let policyReached = false;
    const actionRejected = assert.rejects(
      type(desktop, undefined, () => {
        policyReached = true;
      }),
    );
    await delay(10);
    assert.equal(policyReached, true);
    assert.equal(await desktop.captureFrame(), null);
    if (mode !== 'timeout') {
      await writeFile(path.join(root, 'release'), '1');
    }
    await Promise.all([viewRejected, actionRejected]);
    assert.equal(await exists(path.join(root, 'effects')), false);
    assert.equal(desktop.uncertainEffects, false);
    const requestText = await readFile(path.join(root, 'requests'), 'utf-8');
    const requests = requestText.trim().split('\n');
    assert.equal(requests.filter((value) => value === 'screenshot').length, 1);
    await noCollision(root);
    await assert.rejects(desktop.verify());
    await gone(root);
    console.log(`PASS ${mode} frame retires before waiting input; no false uncertain input`);
  } finally {
    await desktop?.stop();
    await rm(root, { recursive: true });
  }
}

async function checkActiveCancellation(mode, methodOnly = false) {
  const root = await runtime(mode);
  let desktop;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    const phase = new AbortController();
    const reason = new Error('Synthetic action cancelled by its caller.');
    let running;
    if (methodOnly) {
      running = desktop.withComputer((computer) =>
        computer.execute(typeCall(), { signal: phase.signal, beforeAction: () => true }),
      );
    } else {
      running =
        mode === 'seal'
          ? desktop.seal({ signal: phase.signal })
          : desktop.withComputer((computer) => computer.execute(typeCall(), { beforeAction: () => true }), {
              signal: phase.signal,
            });
    }
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Check the actual caller-owned reason by identity.
    const rejected = assert.rejects(running, (error) => error === reason);
    const boundary = { seal: 'seal-entered', input: 'input-entered', frame: 'capture-entered' };
    await entered(root, boundary[mode]);
    phase.abort(reason);
    try {
      // Both socket directions must stop before the finite fixture is released.
      await Promise.race([
        rejected,
        delay(1200).then(() => {
          throw new Error('Active transport did not see Stop');
        }),
      ]);
    } finally {
      await writeFile(path.join(root, 'release'), '1');
    }
    assert.equal(desktop.uncertainEffects, mode === 'input');
    if (mode === 'seal') {
      assert.equal(await exists(path.join(root, 'effects')), false);
    } else {
      const effects = await readFile(path.join(root, 'effects'), 'utf-8');
      assert.equal(effects.trim(), '1');
    }
    await assert.rejects(desktop.verify(), /stopped/u);
    await noCollision(root);
    await desktop.stop();
    await gone(root);
    console.log(
      `PASS active ${mode} ${methodOnly ? 'method' : 'phase'}: prompt cancellation; uncertainty matches dispatched unconfirmed input`,
    );
  } finally {
    await desktop?.stop();
    await rm(root, { recursive: true });
  }
}

async function checkScreenshotBudget() {
  const root = await runtime('budget');
  let desktop;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    const frame = await desktop.captureFrame();
    assert.equal(frame.width, 1024);
    const result = await desktop.withComputer((computer, signal) =>
      computer.execute({ ...typeCall(), actions: [{ type: 'screenshot' }] }, { signal }),
    );
    assert.ok(result.output.image_url.startsWith('data:image/png;base64,'));
    const proof = await desktop.verify();
    assert.equal(proof.ok, true);
    assert.equal(desktop.uncertainEffects, false);
    console.log('PASS viewer and SDK allow guest capture plus bounded frame transport, still usable');
  } finally {
    await desktop?.stop();
    await rm(root, { recursive: true });
  }
}

async function checkStopDuringView() {
  const root = await runtime('frame');
  let desktop;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    const rejected = assert.rejects(desktop.captureFrame(), /unavailable|stopped/u);
    await entered(root, 'capture-entered');
    let complete = false;
    // oxlint-disable-next-line promise/prefer-await-to-then -- Observe whether Stop returns while its transport is held.
    const stopping = desktop.stop().then(() => {
      complete = true;
    });
    try {
      await delay(40);
      assert.equal(complete, false, 'Stop must retain ownership until the viewer transport settles');
      const pid = Number(await readFile(path.join(root, 'pid'), 'utf-8'));
      assert.doesNotThrow(() => process.kill(pid, 0));
      assert.equal(desktop.uncertainEffects, false);
    } finally {
      await writeFile(path.join(root, 'release'), '1');
    }
    await Promise.all([rejected, stopping]);
    await gone(root);
    assert.equal(desktop.uncertainEffects, false);
    console.log('PASS Stop drains viewer before reaping; no input uncertainty and no guest remains');
  } finally {
    await desktop?.stop();
    await rm(root, { recursive: true });
  }
}

async function checkPhaseAuthority(kind) {
  const root = await runtime(`phase-${kind}`);
  let desktop;
  const consent = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const enteredLater = Promise.withResolvers();
  const releaseLater = Promise.withResolvers();
  let escaped;
  let escapedResult;
  let later;
  try {
    desktop = await Desktop.create({ runtimeDir: root });
    // Start an SDK call but return before its asynchronous approval settles.
    await desktop.withComputer((computer) => {
      escaped = computer;
      escapedResult = computer.execute(typeCall(), {
        beforeAction: () => {
          requested.resolve();
          return consent.promise;
        },
      });
    });
    await requested.promise;
    // Observe a rejection immediately so a controlled failure cannot become unhandled.
    const rejected = assert.rejects(escapedResult, /owns|own|active|stopped|cancelled|refused|result/u);
    if (kind === 'operation') {
      later = desktop.withComputer(async (current) => {
        enteredLater.resolve();
        await releaseLater.promise;
        return current.execute(typeCall(), { beforeAction: () => true });
      });
      await enteredLater.promise;
    } else {
      later = desktop[kind]();
      await entered(root, 'phase-entered');
    }
    consent.resolve(true);
    // A stale call must reject independently of the current owner settling.
    const timer = new AbortController();
    try {
      await Promise.race([
        rejected,
        delay(500, undefined, { signal: timer.signal }).then(() => {
          throw new Error('An escaped toolset waited for or ran inside a later desktop phase.');
        }),
      ]);
      assert.equal(await exists(path.join(root, 'effects')), false);
      await assert.rejects(escaped.execute(typeCall(), { beforeAction: () => true }));
    } finally {
      timer.abort();
      await writeFile(path.join(root, 'release'), '1');
      releaseLater.resolve();
    }
    const result = await later;
    if (kind === 'operation') {
      assert.ok(result.output.image_url.startsWith('data:image/png;base64,'));
      const effects = await readFile(path.join(root, 'effects'), 'utf-8');
      assert.equal(effects.trim(), '1');
    } else {
      assert.equal(result.ok, true);
    }
    assert.equal(desktop.uncertainEffects, false);
    await noCollision(root);
    console.log(`PASS escaped computer refused during ${kind}, current phase remains usable`);
  } finally {
    consent.resolve(true);
    releaseLater.resolve();
    await writeFile(path.join(root, 'release'), '1');
    await Promise.allSettled([escapedResult, later]);
    await desktop?.stop();
    await gone(root);
    await rm(root, { recursive: true });
  }
}

if (process.argv.includes('--abort-reason')) {
  await checkActiveCancellation('input');
  await checkActiveCancellation('frame');
  await checkActiveCancellation('input', true);
  await checkActiveCancellation('frame', true);
} else if (process.argv.includes('--queued-cancellation')) {
  await checkPhase(false);
  await checkPhase(true);
} else if (process.argv.includes('--phase-authority')) {
  for (const kind of ['verify', 'seal', 'operation']) {
    // Each independent owner is reaped before creating the next.
    // oxlint-disable-next-line no-await-in-loop
    await checkPhaseAuthority(kind);
  }
} else if (process.argv.includes('--method-cancellation')) {
  await checkActiveCancellation('input', true);
  await checkActiveCancellation('frame', true);
} else if (process.argv.includes('--screenshot-budget')) {
  await checkScreenshotBudget();
} else if (process.argv.includes('--active-cancellation')) {
  await checkActiveCancellation('input');
  await checkActiveCancellation('frame');
  await checkActiveCancellation('seal');
  await checkActiveCancellation('input', true);
  await checkActiveCancellation('frame', true);
  await checkScreenshotBudget();
} else {
  await checkProofs();
  await checkPhase(false);
  await checkStopDuringView();
  await checkPhase(true);
  await checkFailure('malformed');
  await checkFailure('ihdr-only');
  await checkFailure('no-iend');
  await checkFailure('timeout');
  await checkActiveCancellation('input');
  await checkActiveCancellation('frame');
  await checkActiveCancellation('seal');
  await checkStartup();
}
