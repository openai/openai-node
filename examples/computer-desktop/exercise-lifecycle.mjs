import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Desktop } from './desktop.mjs';
import { writeTestReceipt } from './test-runtime.mjs';

if (process.argv.includes('--with-browser')) {
  throw new Error(
    '--with-browser requires the final browser demo layer. Run this exercise without that flag.',
  );
}

function call() {
  return {
    type: 'computer_call',
    id: 'cu_local',
    call_id: 'call_local',
    status: 'completed',
    actions: [{ type: 'type', text: 'fixture change' }],
    pending_safety_checks: [],
  };
}

async function makeRuntime(mode) {
  const root = await mkdtemp(path.join(tmpdir(), 'cu-'));
  await Promise.all(['bin', 'build', 'runs'].map((name) => mkdir(path.join(root, name), { mode: 0o700 })));
  const image = await open(path.join(root, 'build', 'desktop.raw'), 'wx', 0o400);
  try {
    await image.truncate(16 * 1024 ** 3);
  } finally {
    await image.close();
  }
  // This child implements only the private transport needed for lifecycle checks.
  // It has no X11, Chromium, SDK import, model call or real task data.
  const program = `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
if (${JSON.stringify(mode)} === 'startup') process.exit(2);
const parameter = process.argv.find((arg) => arg.startsWith('virtio-vsock,'));
const socketPath = parameter.split('socketURL=')[1].split(',')[0];
const server = createServer({ allowHalfOpen: true }, (socket) => {
  let request = '';
  socket.setEncoding('utf8');
  socket.on('data', (data) => { request += data; });
  socket.on('end', () => {
    const action = JSON.parse(request);
    if (action.type === 'ready' && ${JSON.stringify(mode)} === 'pending-startup') {
      writeFileSync('../../ready-entered', '1');
      return;
    }
    if (action.type !== 'ready' && ${JSON.stringify(mode)} === 'malformed') {
      socket.end('SYNTHETIC_8738_NOT_JSON\\n');
      return;
    }
    if (action.type === 'ready' || action.type === 'verify') {
      socket.end(JSON.stringify({ ok: true }) + '\\n');
    } else {
      appendFileSync('../../effect-count', '1\\n');
      writeFileSync('input-received', '1');
      if (${JSON.stringify(mode)} === 'drop') socket.destroy();
    }
  });
});
server.listen(socketPath);
`;
  // vfkit in this private test runtime is an owned Node fixture executable.
  await writeFile(path.join(root, 'bin', 'vfkit'), program, { flag: 'wx', mode: 0o700 });
  await writeTestReceipt(root);
  return root;
}

async function effects(root) {
  const result = await readFile(path.join(root, 'effect-count'), 'utf-8');
  return result.trim().split('\n').length;
}

async function waitForInput(root, id) {
  const target = path.join(root, 'runs', id, 'input-received');
  const end = performance.now() + 4000;
  while (performance.now() < end) {
    try {
      // Wait for the fixture's external receipt of a real SDK-dispatched input.
      // oxlint-disable-next-line no-await-in-loop
      await lstat(target);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  throw new Error('Fixture never received the input.');
}

const runtimes = [];
try {
  for (const member of ['verify', 'seal', 'captureFrame']) {
    // Each controlled child owns one independent raw-reply refusal.
    // oxlint-disable-next-line no-await-in-loop
    const root = await makeRuntime('malformed');
    runtimes.push(root);
    // oxlint-disable-next-line no-await-in-loop
    const desktop = await Desktop.create({ runtimeDir: root });
    try {
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(desktop[member](), (error) => {
        assert.equal(error.message, 'Invalid private desktop reply.');
        assert.doesNotMatch(String(error.stack), /SYNTHETIC_8738/u);
        assert.equal(error.cause, undefined);
        return true;
      });
      // oxlint-disable-next-line no-await-in-loop
      assert.deepEqual(await readdir(path.join(root, 'runs')), []);
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await desktop.stop();
    }
  }
  console.log('PASS verify, seal and viewer malformed replies reveal no raw guest data or parser cause');
  const bad = await makeRuntime('startup');
  runtimes.push(bad);
  await assert.rejects(Desktop.create({ runtimeDir: bad }), /did not start/u);
  assert.deepEqual(await readdir(path.join(bad, 'runs')), []);
  console.log('PASS failed startup reaps its exact child and leaves no run directory');

  // oxlint-disable eslint/no-await-in-loop -- Each CLI owns and cleans up a separate runtime.
  const entries = ['run.mjs'];
  for (const entry of entries) {
    const pending = await makeRuntime('pending-startup');
    runtimes.push(pending);
    const cli = spawn(
      process.execPath,
      [fileURLToPath(new URL(entry, import.meta.url)), '--live', '--runtime-dir', pending],
      {
        env: { ...process.env, OPENAI_API_KEY: 'fixture-no-request', OPENAI_MODEL: 'fixture-no-request' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let prompted = false;
    let errors = '';
    cli.stdout.on('data', (part) => {
      if (!prompted && part.toString().includes('Type yes')) {
        prompted = true;
        cli.stdin.write('yes\n');
      }
    });
    cli.stderr.on('data', (part) => {
      errors += part;
    });
    const exited = once(cli, 'exit');
    try {
      const end = performance.now() + 5000;
      let ready = false;
      while (performance.now() < end) {
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Wait for the child to enter its held readiness request.
          await lstat(path.join(pending, 'ready-entered'));
          ready = true;
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- Observe the child without racing its readiness request.
        await delay(10);
      }
      assert.ok(ready, errors);
      assert.equal(cli.kill('SIGINT'), true);
      const result = await Promise.race([exited, delay(5000, undefined, { ref: false })]);
      assert.ok(result, 'SIGINT must end startup within 5 seconds');
      assert.notEqual(result[0], 0);
      assert.deepEqual(await readdir(path.join(pending, 'runs')), []);
      console.log(`PASS SIGINT during ${entry} startup promptly reaps the guest and removes its run`);
    } finally {
      if (cli.exitCode === null && cli.signalCode === null) {
        cli.kill('SIGKILL');
        await exited;
      }
    }
  }
  // oxlint-enable eslint/no-await-in-loop

  const retry = await makeRuntime('hold');
  runtimes.push(retry);
  const retired = await Desktop.create({ runtimeDir: retry });
  const runDir = path.join(retry, 'runs', retired.id);
  const retained = path.join(retry, 'retained');
  await rename(runDir, retained);
  await mkdir(runDir, { mode: 0o700 });
  await assert.rejects(retired.stop(), /Run root ownership changed/u);
  assert.ok(await lstat(retained), 'the original owned run must remain after failed removal');
  await assert.rejects(retired.withComputer(() => assert.fail('Stopped input was admitted')));
  await assert.rejects(retired.verify());
  await assert.rejects(retired.captureFrame());
  await rm(runDir, { recursive: true });
  await rename(retained, runDir);
  await Promise.all([retired.stop(), retired.stop()]);
  await retired.stop();
  assert.deepEqual(await readdir(path.join(retry, 'runs')), []);
  console.log(
    'PASS failed removal remains visible; Stop retries exact guest once, input and view stay closed',
  );

  const held = await makeRuntime('hold');
  runtimes.push(held);
  const main = await Desktop.create({ runtimeDir: held });
  const sentinel = await Desktop.create({ runtimeDir: held });
  try {
    const active = main.withComputer((computer, signal) =>
      computer.execute(call(), { signal, beforeAction: () => true }),
    );
    const rejected = assert.rejects(active);
    await waitForInput(held, main.id);
    assert.equal(await effects(held), 1);
    const stopping = main.stop();
    await assert.rejects(main.verify());
    await Promise.all([stopping, rejected]);
    assert.equal(main.uncertainEffects, true);
    assert.deepEqual(await readdir(path.join(held, 'runs')), [sentinel.id]);
    const sentinelState = await sentinel.verify();
    assert.equal(sentinelState.ok, true);
    assert.equal(await effects(held), 1);
    console.log('PASS Stop with received pending input: unknown effect, exact cleanup, sentinel usable');
  } finally {
    await Promise.all([main.stop(), sentinel.stop()]);
  }
  assert.deepEqual(await readdir(path.join(held, 'runs')), []);

  const dropped = await makeRuntime('drop');
  runtimes.push(dropped);
  const desktop = await Desktop.create({ runtimeDir: dropped });
  try {
    await assert.rejects(
      desktop.withComputer((computer, signal) =>
        computer.execute(call(), { signal, beforeAction: () => true }),
      ),
    );
    assert.equal(desktop.uncertainEffects, true);
    await assert.rejects(desktop.verify());
    assert.deepEqual(await readdir(path.join(dropped, 'runs')), []);
    assert.equal(await effects(dropped), 1);
    console.log('PASS input then lost reply: one effect, no replay, owner retired, original run removed');
  } finally {
    await desktop.stop();
  }
} finally {
  await Promise.all(runtimes.map((root) => rm(root, { recursive: true })));
}
