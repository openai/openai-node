import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs, { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Desktop } from './desktop.mjs';
import { remove, start } from './guest.mjs';
import { writeTestReceipt } from './test-runtime.mjs';

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
    if (action.type === 'ready') {
      socket.end(JSON.stringify({ ok: true }) + '\\n');
    } else if (action.type === 'verify') {
      socket.end(JSON.stringify({ ok: true, file_matches: false, browser_matches: false,
        file_empty: true, browser_effects: 0 }) + '\\n');
    } else if (action.type === 'seal' && ${JSON.stringify(mode)} === 'final') {
      socket.end(JSON.stringify({ ok: true, file_matches: true, browser_matches: true,
        file_empty: false, browser_effects: 1 }) + '\\n');
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

  const interrupted = await makeRuntime('pending-startup');
  runtimes.push(interrupted);
  const controller = new AbortController();
  const reason = new Error('Caller stopped readiness');
  const creating = Desktop.create({ runtimeDir: interrupted, signal: controller.signal });
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- assert.rejects must check the original error object, not only its fields.
  const checked = assert.rejects(creating, (error) => error === reason);
  const readinessEnd = performance.now() + 5000;
  while (performance.now() < readinessEnd) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Wait for this guest's readiness request.
      await lstat(path.join(interrupted, 'ready-entered'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Readiness must begin before cancellation.
    await delay(10);
  }
  assert.ok(performance.now() < readinessEnd, 'Guest never reached readiness');
  controller.abort(reason);
  await checked;
  assert.deepEqual(await readdir(path.join(interrupted, 'runs')), []);
  console.log('PASS startup cancellation retains caller reason after removing its owned guest');

  // oxlint-disable eslint/no-await-in-loop -- Each CLI owns and cleans up a separate runtime.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const pending = await makeRuntime('pending-startup');
    runtimes.push(pending);
    const cli = spawn(
      process.execPath,
      [fileURLToPath(new URL('run.mjs', import.meta.url)), '--live', '--runtime-dir', pending],
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
      assert.equal(cli.kill(signal), true);
      const result = await Promise.race([exited, delay(5000, undefined, { ref: false })]);
      assert.ok(result, `${signal} must end startup within 5 seconds`);
      assert.notEqual(result[0], 0);
      assert.deepEqual(await readdir(path.join(pending, 'runs')), []);
      console.log(`PASS ${signal} during startup promptly reaps the guest and removes its run`);
    } finally {
      if (cli.exitCode === null && cli.signalCode === null) {
        cli.kill('SIGKILL');
        await exited;
      }
    }
  }
  // oxlint-enable eslint/no-await-in-loop

  const finishing = await makeRuntime('final');
  runtimes.push(finishing);
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'resp_final',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_final',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Finished.', annotations: [] }],
          },
        ],
      }),
    );
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  try {
    const address = api.address();
    assert.ok(address && typeof address !== 'string');
    const cli = spawn(
      process.execPath,
      [fileURLToPath(new URL('run.mjs', import.meta.url)), '--live', '--runtime-dir', finishing],
      {
        env: {
          ...process.env,
          OPENAI_API_KEY: 'fixture-only',
          OPENAI_MODEL: 'fixture',
          OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    let prompted = false;
    cli.stdout.on('data', (data) => {
      output += data;
      if (!prompted && output.includes('Type yes')) {
        prompted = true;
        cli.stdin.write('yes\n');
      }
    });
    cli.stderr.on('data', (data) => {
      errors += data;
    });
    const [code] = await once(cli, 'close');
    assert.equal(code, 0, errors || output);
    assert.match(output, /"verified":true/u);
    assert.deepEqual(await readdir(path.join(finishing, 'runs')), []);
    console.log('PASS final CLI uses the sealed result even when intermediate verification is incomplete');
  } finally {
    api.closeAllConnections();
    api.close();
  }

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

  // Controlled changes at the filesystem boundary leave the actual guest reaping and removal in use.
  // oxlint-disable eslint/no-await-in-loop -- Each small fixture owns a separate VM child and root.
  for (const change of ['device', 'before-move', 'after-move', 'remove-retry']) {
    const root = await makeRuntime('hold');
    runtimes.push(root);
    const guest = await start(root);
    const publicDir = guest.dir;
    const saved = path.join(root, 'saved');
    const original = { lstat: fs.lstat, rm: fs.rm };
    let injected = false;
    let obstructed = false;
    if (change === 'device') {
      guest.st.dev += 1;
    } else {
      fs.lstat = async (...args) => {
        const info = await original.lstat(...args);
        const current = String(args[0]);
        if (!injected && change === 'before-move' && current === publicDir) {
          injected = true;
          await rename(publicDir, saved);
          await mkdir(publicDir, { mode: 0o700 });
          await writeFile(path.join(publicDir, 'sentinel'), 'stranger');
        }
        if (!injected && change === 'after-move' && current.includes('/.cleanup-')) {
          injected = true;
          await mkdir(publicDir, { mode: 0o700 });
          await writeFile(path.join(publicDir, 'sentinel'), 'stranger');
        }
        return info;
      };
      fs.rm = async (...args) => {
        if (!injected && change === 'remove-retry') {
          injected = true;
          throw new Error('fixture removal failure');
        }
        const result = await original.rm(...args);
        if (!obstructed && change === 'remove-retry') {
          obstructed = true;
          await writeFile(path.join(path.dirname(String(args[0])), 'sentinel'), 'stranger');
        }
        return result;
      };
      syncBuiltinESMExports();
    }
    try {
      if (change === 'device') {
        await assert.rejects(remove(guest), /Run root ownership changed/u);
        assert.ok(await lstat(publicDir));
        guest.st.dev -= 1;
        await remove(guest);
      } else if (change === 'before-move') {
        await assert.rejects(remove(guest), /Run root ownership changed/u);
        assert.ok(await lstat(saved));
        assert.equal(await readFile(path.join(publicDir, 'sentinel'), 'utf-8'), 'stranger');
      } else if (change === 'after-move') {
        await remove(guest);
        assert.equal(injected, true);
        assert.equal(await readFile(path.join(publicDir, 'sentinel'), 'utf-8'), 'stranger');
      } else {
        await assert.rejects(remove(guest), /fixture removal failure/u);
        await assert.rejects(remove(guest), { code: 'ENOTEMPTY' });
        const extra = path.join(guest.cleanupRoot, 'sentinel');
        assert.equal(await readFile(extra, 'utf-8'), 'stranger');
        await original.rm(extra);
        await remove(guest);
        assert.deepEqual(await readdir(path.join(root, 'runs')), []);
      }
      console.log(`PASS VM cleanup ${change}: owned child reaped, foreign data preserved, retry retained`);
    } finally {
      fs.lstat = original.lstat;
      fs.rm = original.rm;
      syncBuiltinESMExports();
      // Test cleanup owns this entire synthetic root, including deliberate replacements.
      if (guest.child.exitCode === null && guest.child.signalCode === null) {
        guest.child.kill('SIGKILL');
        await guest.gone;
      }
    }
  }
  // oxlint-enable eslint/no-await-in-loop

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
