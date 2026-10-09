'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MAX_IDLE_MS, locked, prune, run } = require('./cache.cjs');

const cache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'steady-cache-lifetime-')));

async function main() {
  fs.mkdirSync(path.join(cache, '.leases'));
  const now = Date.now();
  for (const name of ['source-old', 'deno-old', 'deps-old', 'source-active', 'deno-current', 'deps-recent']) {
    const entry = path.join(cache, name);
    fs.mkdirSync(entry);
    fs.writeFileSync(path.join(entry, 'content'), name);
    const modified = new Date(now - (name === 'deps-recent' ? 0 : MAX_IDLE_MS + 1000));
    fs.utimesSync(entry, modified, modified);
  }
  const lease = path.join(cache, '.leases', 'active.json');
  fs.writeFileSync(lease, JSON.stringify({ pids: [process.pid], entries: ['source-active'] }));
  await locked(cache, () => prune(cache, ['deno-current'], now));
  for (const name of ['source-old', 'deno-old', 'deps-old']) {
    assert.equal(fs.existsSync(path.join(cache, name)), false);
  }
  for (const name of ['source-active', 'deno-current', 'deps-recent']) {
    assert.equal(fs.existsSync(path.join(cache, name)), true);
  }
  fs.unlinkSync(lease);
  await locked(cache, () => prune(cache, ['deno-current'], now));
  assert.equal(fs.existsSync(path.join(cache, 'source-active')), false);

  const expiredProcess = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf-8' });
  assert.equal(expiredProcess.status, 0);
  fs.writeFileSync(lease, JSON.stringify({ pids: [expiredProcess.pid], entries: [] }));
  await locked(cache, () => prune(cache, ['deno-current'], now));
  assert.equal(fs.existsSync(lease), false);

  fs.writeFileSync(
    lease,
    JSON.stringify({ pids: [expiredProcess.pid, process.pid], entries: ['deps-recent'] }),
  );
  await locked(cache, () => prune(cache, ['deno-current'], now + MAX_IDLE_MS + 1000));
  assert.equal(
    fs.existsSync(path.join(cache, 'deps-recent')),
    true,
    'A surviving child protects its entries',
  );
  fs.unlinkSync(lease);

  const reusedPidLease = path.join(cache, '.leases', `${process.pid}.json`);
  fs.writeFileSync(reusedPidLease, JSON.stringify({ pids: [process.pid], entries: [] }));

  // The child observes its lease throughout execution and its exit code is preserved.
  const code = await run(cache, ['deno-current'], process.execPath, [
    '-e',
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    const leases = fs.readdirSync(${JSON.stringify(path.join(cache, '.leases'))});
    assert.equal(leases.length, 2);
    process.exit(7);
  `,
  ]);
  assert.equal(code, 7);
  assert.deepEqual(fs.readdirSync(path.join(cache, '.leases')), [`${process.pid}.json`]);
  fs.unlinkSync(reusedPidLease);
  assert.ok(fs.statSync(path.join(cache, 'deno-current')).mtimeMs >= now);
  console.log('Steady cache expiry, active leases, and cleanup passed.');
}

async function runMain() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}
void runMain();
