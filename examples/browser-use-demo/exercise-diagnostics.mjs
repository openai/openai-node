import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticCapture,
  diagnosticObservation,
  readDiagnosticTrace,
  RunDiagnostics,
} from './diagnostics.mjs';

const secret = 'synthetic-private-credential';
const capture = createDiagnosticCapture({ secrets: [secret] });
try {
  // Permission bits describe this actual file, not the process umask.
  // oxlint-disable-next-line no-bitwise
  assert.equal(statSync(capture.directory).mode & 0o777, 0o700);
  const run = new RunDiagnostics(capture, 'live');
  const observation = diagnosticObservation([
    { type: 'input_text', text: `Rule: route this invoice to review. ${secret}` },
    { type: 'input_image', image_url: 'data:image/png;base64,PRIVATE_SCREENSHOT' },
  ]);
  run.record('observation', observation);
  run.record('choices', [
    { id: 'review', description: 'Send to review', done: false },
    { id: 'pay', description: 'Pay invoice', done: false },
    { id: 'done', description: 'Finish', done: true },
  ]);
  run.event({
    api: 'decisions',
    stage: 'request',
    reason: 'completed',
    call_id: null,
    member: null,
    duration_ms: 13,
    usage: { input_tokens: 17, output_tokens: 3, total_tokens: 20 },
  });
  run.event({ api: 'decisions', stage: 'selection', reason: 'completed', call_id: 'pay', usage: null });
  run.record('effect', { member: 'click', state: { saved: 'paid' } });
  run.record('verification', { verified: false });
  run.measure('actionMs', 2);
  run.measure('approvalMs', 7);
  run.close();
  // oxlint-disable-next-line no-bitwise
  assert.equal(statSync(run.recorder.filename).mode & 0o777, 0o600);
  const raw = readFileSync(run.recorder.filename, 'utf-8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('PRIVATE_SCREENSHOT'), false);
  const trace = readDiagnosticTrace(run.recorder.filename);
  assert.equal(trace.incomplete, false);
  assert.equal(trace.records.find((record) => record.kind === 'verification').data.verified, false);
  assert.equal(trace.records.find((record) => record.data?.stage === 'selection').data.call_id, 'pay');
  assert.deepEqual(run.summary(2).usage, {
    recordedRequests: 1,
    missingRequests: 1,
    complete: false,
    inputTokens: 17,
    outputTokens: 3,
    totalTokens: 20,
  });
  assert.deepEqual(run.summary(2).timing, { apiMs: 13, actionMs: 2, approvalMs: 7 });
  assert.equal(JSON.stringify(run.summary(2)).includes('paid'), false);
  assert.equal(new RunDiagnostics(undefined, 'live').summary(1).usage.inputTokens, null);

  const visual = createDiagnosticCapture();
  try {
    assert.throws(() => createDiagnosticCapture({ captureId: visual.directory }), /capture ID/u);
    const recorder = visual.start();
    const pixels = Buffer.alloc(1024 * 1024, 12);
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      recorder.frame({ sequence, owner: 'human', role: 'Task', mime: 'image/jpeg' }, pixels);
    }
    recorder.frame(
      { sequence: 11, owner: 'human', role: 'Task', mime: 'image/jpeg' },
      Buffer.alloc(pixels.length + 1),
    );
    recorder.close();
    const reopened = createDiagnosticCapture({ captureId: visual.id });
    assert.deepEqual(reopened.traces(), ['run-1']);
    const saved = reopened.trace('run-1');
    assert.equal(saved.records.filter((record) => record.kind === 'frame').length, 8);
    assert.deepEqual(saved.records.at(-1).data, {
      status: 'complete',
      omitted: 0,
      frames: 8,
      omittedFrames: 3,
    });
    assert.deepEqual(reopened.frame('run-1', '1').pixels, pixels);
    assert.throws(() => reopened.frame('run-1', '9'));
    assert.throws(() => reopened.trace('../run-1'));
    const next = reopened.start();
    assert.match(next.filename, /run-2\.jsonl$/u);
    next.record('observation', 'Visible literal <button>synthetic note</button>');
    next.close();
    assert.equal(
      reopened.trace('run-2').records.some((record) => record.kind === 'frame'),
      false,
    );
    const full = reopened.start();
    const metadata = { sequence: 1, owner: 'human', role: 'Task', mime: 'image/jpeg' };
    full.frame(metadata, Buffer.from('saved frame'));
    full.frame(metadata, Buffer.from('duplicate must not replace or delete saved frame'));
    const space = 1024 * 1024 - 512 - statSync(full.filename).size;
    full.record('observation', 'x'.repeat(space - 80));
    full.frame({ ...metadata, sequence: 2 }, Buffer.from('unreferenced frame'));
    full.close();
    const nearLimit = reopened.trace('run-3');
    assert.equal(nearLimit.incomplete, false);
    assert.deepEqual(nearLimit.records.at(-1).data, {
      status: 'limited',
      omitted: 1,
      frames: 1,
      omittedFrames: 2,
    });
    assert.equal(reopened.frame('run-3', '1').pixels.toString(), 'saved frame');
    assert.equal(existsSync(path.join(reopened.directory, 'run-3-2.frame')), false);
    assert.throws(() => reopened.frame('run-3', '2'));
  } finally {
    rmSync(visual.directory, { recursive: true, force: true });
  }

  const bounded = capture.start();
  bounded.record('run', { api: 'responses', mode: 'rehearsal', taskId: 'reservations' });
  bounded.record('observation', 'x'.repeat(1024 * 1024));
  bounded.close();
  assert.equal(bounded.status, 'limited');
  assert.equal(bounded.omitted, 1);
  assert.equal(readDiagnosticTrace(bounded.filename).records.length, 2);
  assert.deepEqual(readDiagnosticTrace(bounded.filename).records.at(-1).data, {
    status: 'limited',
    omitted: 1,
    frames: 0,
    omittedFrames: 0,
  });

  const failed = capture.start();
  failed.record('run', { api: 'responses', mode: 'rehearsal', taskId: 'reservations' });
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => failed.record('observation', circular));
  assert.equal(failed.status, 'failed');
  assert.equal(readDiagnosticTrace(failed.filename).records.length, 1);
  appendFileSync(failed.filename, '{"version":');
  const damaged = readDiagnosticTrace(failed.filename);
  assert.equal(damaged.incomplete, true);
  assert.equal(damaged.records.length, 1);
  assert.deepEqual(damaged.records[0].data, { api: 'responses', mode: 'rehearsal', taskId: 'reservations' });
  const malformed = capture.start();
  malformed.close();
  for (const [kind, data] of [
    ['run', {}],
    ['observation', [null]],
    ['choices', [{ id: 'save', description: 'Save', done: null }]],
    ['runner', { stage: 'request' }],
    ['effect', { member: 'click', state: null }],
    ['verification', { verified: 'yes' }],
    ['capture', { status: 'complete', omitted: false, frames: 0, omittedFrames: 0 }],
    ['frame', null],
    ['frame', { sequence: 1, owner: 'human', role: 'Task' }],
  ]) {
    writeFileSync(
      malformed.filename,
      [
        { version: 1, kind: 'observation', atMs: 0, data: 'retained prefix' },
        { version: 1, kind, atMs: 1, data },
        {
          version: 1,
          kind: 'capture',
          atMs: 2,
          data: { status: 'complete', omitted: 0, frames: 0, omittedFrames: 0 },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n'),
    );
    assert.deepEqual(
      capture.trace('run-4'),
      {
        records: [{ version: 1, kind: 'observation', atMs: 0, data: 'retained prefix' }],
        incomplete: true,
      },
      kind,
    );
    assert.throws(() => capture.frame('run-4', '1'));
  }
  for (let index = 4; index < 16; index += 1) {
    capture.start().close();
  }
  assert.equal(capture.start(), null);
  console.log(
    'PASS private trace, wrong-choice evidence, redaction, unknown usage, bounds and failure isolation',
  );
} finally {
  rmSync(capture.directory, { recursive: true, force: true });
}
