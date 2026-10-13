import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopLedger } from './desktop-ledger.mjs';

const ledger = await createDesktopLedger('owned-phase');
try {
  const value = { run_id: 'owned-phase', revision: 1, history: [{ text: 'first' }] };
  const writing = ledger.save(value);
  value.revision = 99;
  value.history[0].text = 'mutated after admission';
  await assert.rejects(ledger.close(), /Wait for/u);
  await assert.rejects(ledger.save({ run_id: 'owned-phase', revision: 2 }), /next owned write/u);
  await writing;
  const target = path.join(ledger.directory, 'checkpoint.json');
  assert.deepEqual(JSON.parse(await readFile(target, 'utf-8')), {
    run_id: 'owned-phase',
    revision: 1,
    history: [{ text: 'first' }],
  });
  const file = await lstat(target);
  const directory = await lstat(ledger.directory);
  // POSIX permission bits describe this actual private file and directory.
  // oxlint-disable-next-line no-bitwise
  assert.equal(file.mode & 0o777, 0o600);
  // oxlint-disable-next-line no-bitwise
  assert.equal(directory.mode & 0o777, 0o700);
  await assert.rejects(ledger.save({ run_id: 'other-phase', revision: 2 }), /next owned write/u);
  await assert.rejects(ledger.save({ run_id: 'owned-phase', revision: 1 }), /next owned write/u);
  await ledger.save({ run_id: 'owned-phase', revision: 2, history: ['next'] });
  assert.deepEqual(await readdir(ledger.directory), ['checkpoint.json']);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf-8')), {
    run_id: 'owned-phase',
    revision: 2,
    history: ['next'],
  });
} finally {
  await ledger.close();
}
await assert.rejects(lstat(ledger.directory), { code: 'ENOENT' });
await ledger.close();
await assert.rejects(ledger.save({ run_id: 'owned-phase', revision: 3 }), /next owned write/u);
console.log(
  'PASS private atomic ledger: detached bytes, exclusive writes, revision/run identity, permissions and removal',
);
