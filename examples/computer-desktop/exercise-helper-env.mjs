// The real Guest launcher starts only a temporary stdlib receipt helper, never a VM or Docker.
import assert from 'node:assert/strict';
import fs, {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await realpath(
  await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ge-')),
);
const runtime = path.join(root, 'runtime');
const program = path.join(root, 'source');
const dockerKeys = [
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'BUILDKIT_HOST',
  'BUILDX_BUILDER',
  'BUILDX_CONFIG',
  'DOCKER_HOST',
];
const sentinelKeys = [
  'OPENAI_API_KEY',
  'BROWSERBASE_API_KEY',
  'DAYTONA_API_KEY',
  'E2B_API_KEY',
  'PYTHONPATH',
  'PYTHONHOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'SYNTHETIC_PRIVATE_SENTINEL',
];
const keys = [...dockerKeys, ...sentinelKeys];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
try {
  await mkdir(runtime, { mode: 0o700 });
  await mkdir(path.join(runtime, 'runs'), { mode: 0o700 });
  await mkdir(path.join(program, 'guest'), { recursive: true });
  const guestSource = await readFile(new URL('guest.mjs', import.meta.url), 'utf-8');
  assert.equal(guestSource.split("from 'node:child_process'").length, 2);
  await writeFile(
    path.join(program, 'guest.mjs'),
    guestSource.replace("from 'node:child_process'", "from './child-process.mjs'"),
  );
  await writeFile(
    path.join(program, 'child-process.mjs'),
    `import { execFile as run, spawn } from 'node:child_process';
import { promisify } from 'node:util';
export { spawn };
export function execFile(...args) { return run(...args); }
execFile[promisify.custom] = (file, args, options) => promisify(run)(file, args, {
  ...options, timeout: options.timeout === 0 ? 0 : 250,
});
`,
  );
  const helper = `import json,os,sys,time
from pathlib import Path
root = Path(sys.argv[sys.argv.index('--runtime-dir')+1])
(root/'captured.json').write_text(json.dumps({'flags': [sys.flags.isolated,sys.flags.no_site], 'env': dict(os.environ)}))
if (root/'delay').exists():
    time.sleep(0.5)
if '--verify-only' in sys.argv:
    raise SystemExit(17)
print('fixture_owned_id')
`;
  await writeFile(path.join(program, 'container_runtime.py'), helper);
  await writeFile(path.join(program, 'guest', 'setup.py'), helper);
  for (const key of keys) {
    process.env[key] = `fixture-${key}`;
  }
  const { start, healthy, remove } = await import(pathToFileURL(path.join(program, 'guest.mjs')).href);
  let checks = 0;
  const verify = async (container) => {
    const captured = JSON.parse(await readFile(path.join(runtime, 'captured.json'), 'utf-8'));
    assert.deepEqual(captured.flags, [1, 1]);
    for (const key of sentinelKeys) {
      assert.equal(Object.hasOwn(captured.env, key), false, key);
    }
    for (const key of dockerKeys) {
      assert.equal(captured.env[key], container ? `fixture-${key}` : undefined, key);
    }
    assert.equal(captured.env.TMPDIR, runtime);
    checks += 1;
  };
  await writeFile(path.join(runtime, 'setup.json'), JSON.stringify({ backend: 'container' }), {
    mode: 0o600,
  });
  const guest = await start(runtime);
  await verify(true);
  await healthy(guest);
  await verify(true);
  await remove(guest);
  await verify(true);
  await writeFile(path.join(runtime, 'delay'), 'bounded helper delay');
  const delayedGuest = await start(runtime);
  await verify(true);
  await assert.rejects(healthy(delayedGuest));
  await rm(path.join(runtime, 'delay'));
  await remove(delayedGuest);
  await rm(path.join(runtime, 'setup.json'));
  await assert.rejects(start(runtime));
  await verify(false);
  await writeFile(
    path.join(program, 'guest', 'setup.py'),
    `import os, pathlib, sys, time
root = pathlib.Path(sys.argv[sys.argv.index('--runtime-dir') + 1])
(root / 'verifier-pid').write_text(str(os.getpid()))
time.sleep(60)
`,
  );
  const controller = new AbortController();
  const reason = new Error('caller stopped receipt verification');
  const verification = start(runtime, { signal: controller.signal });
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- assert.rejects requires a predicate for exact error identity.
  const rejected = assert.rejects(verification, (error) => error === reason);
  let verifierPid;
  for (let attempt = 0; attempt < 200 && !verifierPid; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Wait for the controlled child to report its actual PID.
      verifierPid = Number(await readFile(path.join(runtime, 'verifier-pid'), 'utf-8'));
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
      // oxlint-disable-next-line no-await-in-loop -- Bound receipt-helper startup.
      await delay(10);
    }
  }
  assert.ok(verifierPid, 'The verifier did not start');
  controller.abort(reason);
  await rejected;
  assert.throws(() => process.kill(verifierPid, 0), { code: 'ESRCH' });
  assert.deepEqual(await readdir(path.join(runtime, 'runs')), []);
  await rm(path.join(runtime, 'verifier-pid'));
  checks += 1;
  // A controlled executable stands in for vfkit; the actual owner must preserve its exit status.
  await copyFile(new URL('guest/vm_owner.py', import.meta.url), path.join(program, 'guest', 'vm_owner.py'));
  // Accept only this temporary runtime.
  await writeFile(path.join(program, 'guest', 'setup.py'), '');
  await mkdir(path.join(runtime, 'bin'), { mode: 0o700 });
  await writeFile(path.join(runtime, 'bin/vfkit'), '#!/bin/sh\nexit 7\n', { mode: 0o700 });
  const controlled = await start(runtime);
  assert.deepEqual(await controlled.gone, { code: 7, signal: null });
  await remove(controlled);
  assert.deepEqual(await readdir(path.join(runtime, 'runs')), []);
  checks += 1;
  // A reaped VM and its one private run; only the filesystem boundary is interrupted.
  for (const when of ['before-rename', 'post-rename', 'moved-lstat']) {
    const publicDir = path.join(runtime, 'runs', when);
    // oxlint-disable-next-line no-await-in-loop
    await mkdir(publicDir, { mode: 0o700 });
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(path.join(publicDir, 'owned'), 'owned original');
    // oxlint-disable-next-line no-await-in-loop -- Each synthetic run is cleaned before the next one.
    const originalState = await lstat(publicDir);
    const reaped = {
      backend: 'vm',
      dir: publicDir,
      st: originalState,
      child: { exitCode: 0, signalCode: null },
      gone: Promise.resolve({ code: 0 }),
    };
    const original = { rename: fs.rename, lstat: fs.lstat };
    let injected = false;
    fs.rename = async (...args) => {
      if (String(args[0]) === publicDir && when === 'before-rename' && !injected) {
        injected = true;
        throw new Error('fixture rename interruption');
      }
      const result = await original.rename(...args);
      if (String(args[0]) === publicDir && when === 'post-rename' && !injected) {
        injected = true;
        throw new Error('fixture rename interruption');
      }
      return result;
    };
    fs.lstat = async (...args) => {
      const info = await original.lstat(...args);
      if (!injected && when === 'moved-lstat' && String(args[0]).includes('/.cleanup-')) {
        injected = true;
        throw new Error('fixture lstat interruption');
      }
      return info;
    };
    syncBuiltinESMExports();
    try {
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(remove(reaped), /fixture .* interruption/u);
      assert.ok(injected);
      // oxlint-disable-next-line no-await-in-loop
      await remove(reaped);
      // oxlint-disable-next-line no-await-in-loop
      assert.deepEqual(await readdir(path.join(runtime, 'runs')), []);
      checks += 1;
    } finally {
      Object.assign(fs, original);
      syncBuiltinESMExports();
    }
  }
  console.log(JSON.stringify({ checks, api_calls: 0, vendor_calls: 0, vm_starts: 0 }));
} finally {
  for (const [key, value] of previous) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
  await rm(root, { recursive: true, force: true });
}
