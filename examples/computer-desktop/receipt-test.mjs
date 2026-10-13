import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

// Tests never run vfkit. If validation regresses, fail safely at the spawn boundary.
let spawnAttempted = false;
childProcess.spawn = () => {
  spawnAttempted = true;
  throw new Error('Test blocked guest spawn');
};
syncBuiltinESMExports();
const { start } = await import('./guest.mjs');
const [root] = process.argv.slice(2);
await assert.rejects(start(root));
assert.equal(spawnAttempted, false, 'invalid VM reached spawn');
assert.deepEqual(await readdir(path.join(root, 'runs')), []);
