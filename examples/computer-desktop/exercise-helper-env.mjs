// The real Guest launcher starts only a temporary stdlib receipt helper, never a VM or Docker.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(tmpdir(), 'guest-env-'));
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
