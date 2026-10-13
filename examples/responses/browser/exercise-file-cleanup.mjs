import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { mock } from 'node:test';
import { newUploadOwner } from './file-upload.mjs';
import { newDownloadOwner, digest } from './file-download.mjs';

let checks = 0;
function fixture({ failInit = false, hold = false, failOnce = false, heldRead = 0 } = {}) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let captured = false;
  let attempts = 0;
  let reads = 0;
  let assignments = 0;
  const readEntered = Promise.withResolvers();
  const readRelease = Promise.withResolvers();
  const document = {
    async dispose() {
      attempts += 1;
      entered.resolve();
      if (hold) {
        await release.promise;
      }
      if (failOnce && attempts === 1) {
        throw new Error('Fixture disposal failed.');
      }
    },
  };
  const callerHandle = {
    dispose: () => assert.fail('Caller handles must stay open.'),
    async evaluate() {
      reads += 1;
      if (reads === heldRead) {
        readEntered.resolve();
        await readRelease.promise;
      }
      return true;
    },
    async setInputFiles() {
      assignments += 1;
    },
  };
  return {
    page: {
      url: () => (failInit && captured ? 'about:blank#changed' : 'about:blank'),
      evaluateHandle: async () => {
        captured = true;
        return document;
      },
    },
    configuration: {
      record: callerHandle,
      control: callerHandle,
      recordId: 'fixture',
      allowUpload: true,
      allowDownload: true,
    },
    attempts: () => attempts,
    entered: entered.promise,
    release: () => release.resolve(),
    readEntered: readEntered.promise,
    releaseRead: () => readRelease.resolve(),
    assignments: () => assignments,
  };
}

/* oxlint-disable eslint/no-await-in-loop -- Each owner must release its private staging before the next case. */
for (const reason of ['expiry', 'session']) {
  for (const boundary of ['prepare', 'transfer']) {
    const probe = fixture();
    const owner = await newUploadOwner(probe.page, probe.configuration, async () => true);
    const clock = { now: Date.now() };
    const now = mock.method(Date, 'now', () => clock.now);
    try {
      const name = owner.generatedName();
      await writeFile(path.join(owner.uploadRoot, name), 'First');
      const first = await owner.prepare(owner.uploadRoot, name, clock.now + 10_000);
      await assert.rejects(owner.prepare(owner.uploadRoot, name, clock.now + 20_000));
      if (reason === 'expiry') {
        clock.now += 10_001;
      } else {
        owner.changeSession();
      }
      if (boundary === 'transfer') {
        const refused = await owner.upload_file({ grant_id: first.grant_id });
        assert.equal(refused.status, 'refused');
      }
      await writeFile(path.join(owner.uploadRoot, name), 'Second');
      const second = await owner.prepare(owner.uploadRoot, name, clock.now + 20_000);
      const previous = await owner.upload_file({ grant_id: first.grant_id });
      assert.equal(previous.status, 'refused');
      assert.equal(probe.assignments(), 0);
      const completed = await owner.upload_file({ grant_id: second.grant_id });
      assert.equal(completed.status, 'completed');
      assert.equal(owner.receipt().sha256, digest(Buffer.from('Second')));
      assert.equal(probe.assignments(), 1);
      checks += 1;
    } finally {
      now.mock.restore();
      await owner.stop();
    }
  }
}
{
  const probe = fixture();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const owner = await newUploadOwner(
    probe.page,
    probe.configuration,
    async () => true,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  try {
    const name = owner.generatedName();
    await writeFile(path.join(owner.uploadRoot, name), 'Session fixture');
    const prepared = assert.rejects(owner.prepare(owner.uploadRoot, name, Date.now() + 20_000));
    await entered.promise;
    owner.changeSession();
    release.resolve();
    await prepared;
    const fresh = await owner.prepare(owner.uploadRoot, name, Date.now() + 20_000);
    const completed = await owner.upload_file({ grant_id: fresh.grant_id });
    assert.equal(completed.status, 'completed');
    assert.equal(probe.assignments(), 1);
    checks += 1;
  } finally {
    release.resolve();
    await owner.stop();
  }
}
for (const make of [newUploadOwner, newDownloadOwner]) {
  const normal = fixture();
  const owner = await make(normal.page, normal.configuration, async () => false);
  await Promise.all([owner.stop(), owner.stop()]);
  await owner.stop();
  assert.equal(normal.attempts(), 1);
  assert.equal(owner.state().cleanup, 'completed');
  await assert.rejects(access(owner.area), { code: 'ENOENT' });
  checks += 1;

  const failed = fixture({ failInit: true });
  await assert.rejects(
    make(failed.page, failed.configuration, async () => false),
    /initialization refused/u,
  );
  assert.equal(failed.attempts(), 1);
  checks += 1;

  const held = fixture({ hold: true });
  const waitingOwner = await make(held.page, held.configuration, async () => false);
  const first = waitingOwner.stop();
  await held.entered;
  const second = waitingOwner.stop();
  assert.equal(waitingOwner.state().cleanup, 'pending');
  held.release();
  await Promise.all([first, second]);
  assert.equal(held.attempts(), 1);
  assert.equal(waitingOwner.state().cleanup, 'completed');
  checks += 1;

  const retry = fixture({ failOnce: true });
  const retryOwner = await make(retry.page, retry.configuration, async () => false);
  await assert.rejects(retryOwner.stop(), /Fixture disposal failed/u);
  assert.equal(retryOwner.state().cleanup, 'pending');
  await retryOwner.stop();
  assert.equal(retry.attempts(), 2);
  assert.equal(retryOwner.state().cleanup, 'completed');
  checks += 1;

  const slowFailure = fixture({ hold: true, failOnce: true });
  const lateOwner = await make(slowFailure.page, slowFailure.configuration, async () => false);
  const incomplete = assert.rejects(lateOwner.stop(), /File cleanup incomplete/u);
  await slowFailure.entered;
  await assert.rejects(access(lateOwner.area), { code: 'ENOENT' });
  await incomplete;
  assert.equal(lateOwner.state().cleanup, 'pending');
  assert.equal(slowFailure.attempts(), 1);
  slowFailure.release();
  await setImmediate();
  await lateOwner.stop();
  assert.equal(slowFailure.attempts(), 2);
  assert.equal(lateOwner.state().cleanup, 'completed');
  checks += 1;
}

for (const [direction, heldRead] of [
  ['upload', 1],
  ['download', 1],
  ['upload', 3],
]) {
  const probe = fixture({ hold: true, heldRead });
  const make = direction === 'upload' ? newUploadOwner : newDownloadOwner;
  const subject = await make(probe.page, probe.configuration, async () => true);
  const bytes = Buffer.from('Fixture');
  let grant;
  if (direction === 'upload') {
    const name = subject.generatedName();
    await writeFile(path.join(subject.uploadRoot, name), bytes, { flag: 'wx', mode: 0o600 });
    grant = await subject.prepare(subject.uploadRoot, name, Date.now() + 20_000);
  } else {
    grant = subject.issue(
      { url: 'http://127.0.0.1:1/unused', count: bytes.length, sha256: digest(bytes) },
      Date.now() + 20_000,
    );
  }
  const transfer = subject[`${direction}_file`]({ grant_id: grant.grant_id });
  await probe.readEntered;
  const stop = subject.stop();
  // Observe both immediately, including a legitimate bounded Stop rejection.
  const completed = Promise.allSettled([transfer, stop]);
  try {
    await probe.entered;
    await assert.rejects(access(subject.area), { code: 'ENOENT' });
    assert.equal(subject.state().cleanup, 'pending');
    const ended = await Promise.race([
      completed,
      delay(4200).then(() => assert.fail(`${direction}: held document disposal blocked Stop`)),
    ]);
    assert.equal(ended[0].status, 'fulfilled', 'Transfer must preserve its own interruption evidence');
    assert.equal(ended[1].status, 'rejected', 'Stop must not claim unfinished handle cleanup');
    assert.match(ended[1].reason.message, /File cleanup incomplete/u);
    assert.deepEqual(ended[0].value, {
      version: 1,
      status: 'interrupted',
      effect: heldRead === 3 ? 'unknown' : 'none',
      cleanup: 'pending',
    });
    assert.deepEqual(subject.receipt(), {
      status: heldRead === 3 ? 'unknown' : 'refused',
      attempted: heldRead === 3,
      completed: false,
    });
    assert.equal(probe.assignments(), Number(heldRead === 3));
    if (direction === 'download') {
      assert.equal(subject.stats.requests, 0);
    }
    assert.equal(probe.attempts(), 1, 'A pending disposal remains owned, not retried');
    probe.releaseRead();
    probe.release();
    await subject.stop();
    assert.equal(probe.attempts(), 1);
    assert.equal(subject.state().cleanup, 'completed');
    checks += 1;
  } finally {
    probe.releaseRead();
    probe.release();
    await completed;
    await subject.stop();
  }
}
/* oxlint-enable eslint/no-await-in-loop */

const active = fixture();
const started = Promise.withResolvers();
const release = Promise.withResolvers();
const uploading = await newUploadOwner(
  active.page,
  active.configuration,
  async () => false,
  async () => {
    started.resolve();
    await release.promise;
  },
);
const name = uploading.generatedName();
await writeFile(path.join(uploading.uploadRoot, name), 'Fixture', { flag: 'wx', mode: 0o600 });
const preparing = assert.rejects(uploading.prepare(uploading.uploadRoot, name, Date.now() + 30_000));
await started.promise;
const stopping = uploading.stop();
await setImmediate();
assert.equal(active.attempts(), 0);
release.resolve();
await Promise.all([preparing, stopping]);
assert.equal(active.attempts(), 1);
checks += 1;
console.log(JSON.stringify({ checks, passed: true, api_calls: 0, vendor_calls: 0 }));
