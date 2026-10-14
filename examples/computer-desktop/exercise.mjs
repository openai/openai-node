import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Desktop } from './desktop.mjs';

const { values } = parseArgs({ options: { 'runtime-dir': { type: 'string' } } });
if (!values['runtime-dir']) {
  throw new Error(
    'From examples/: node computer-desktop/exercise.mjs --runtime-dir /absolute/private/runtime',
  );
}

let sequence = 0;
function call(actions, pending_safety_checks = []) {
  sequence += 1;
  const id = String(sequence);
  return {
    type: 'computer_call',
    id: `cu_${id}`,
    call_id: `call_${id}`,
    status: 'completed',
    actions,
    pending_safety_checks,
  };
}

async function execute(desktop, actions, options = {}, checks = []) {
  return desktop.withComputer((computer, signal) =>
    computer.execute(call(actions, checks), { signal, beforeAction: () => true, ...options }),
  );
}

function frame(output) {
  const url = output.output.image_url;
  assert.ok(url.startsWith('data:image/png;base64,'));
  const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  assert.ok(png.length > 24 && png.length <= 4 * 1024 * 1024);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 768);
  return createHash('sha256').update(png).digest('hex');
}

async function empty(desktop) {
  const result = await desktop.verify();
  assert.equal(result.browser_effects, 0);
  assert.equal(result.file_empty, true);
  assert.equal(result.file_matches, false);
  assert.equal(result.browser_matches, false);
}

const main = await Desktop.create({ runtimeDir: values['runtime-dir'] });
let sentinel;
try {
  sentinel = await Desktop.create({ runtimeDir: values['runtime-dir'] });
  assert.notEqual(main.id, sentinel.id);
  await empty(main);
  await empty(sentinel);
  const initial = frame(await execute(main, [{ type: 'screenshot' }]));
  const ticket = { type: 'click', button: 'left', x: 200, y: 215 };

  // A refusal with actual executable coordinates cannot touch the fixture.
  await assert.rejects(execute(main, [ticket], { beforeAction: () => false }));
  await assert.rejects(execute(main, [ticket], {}, [{ id: 'check_fixture', code: 'confirm_local_change' }]));
  await empty(main);
  console.log('PASS per-action and native safety refusals: zero file/browser effects');

  const invalid = [
    { type: 'click', x: -1, y: 0, button: 'left' },
    { type: 'move', x: 1024, y: 0 },
    { type: 'move', x: 0, y: 768 },
    { type: 'click', x: Number.NaN, y: 0, button: 'left' },
    {
      type: 'drag',
      path: [
        { x: 100, y: 100 },
        { x: 1200, y: 700 },
        { x: 200, y: 100 },
      ],
      keys: ['CTRL'],
    },
    { type: 'keypress', keys: ['Unsupported'] },
    { type: 'scroll', x: 700, y: 400, scroll_x: 0, scroll_y: 2049 },
  ];
  for (const action of invalid) {
    // Full private validation occurs before any key or mouse button is pressed.
    // oxlint-disable-next-line no-await-in-loop
    await assert.rejects(execute(main, [action]));
    // oxlint-disable-next-line no-await-in-loop
    await empty(main);
  }
  console.log('PASS invalid paths/keys/text/bounds: zero effects, owner still usable');

  await execute(main, [
    { type: 'move', x: 0, y: 0 },
    { type: 'move', x: 1023, y: 767 },
    { type: 'wait' },
    { type: 'move', x: 950, y: 650 },
    { type: 'move', x: 950, y: 650 },
    { type: 'scroll', x: 950, y: 650, scroll_x: 0, scroll_y: 120 },
    { type: 'scroll', x: 920, y: 650, scroll_x: 0, scroll_y: -120 },
    // A blank editor has no text to select; this proves drag can release before subsequent typing.
    {
      type: 'drag',
      path: [
        { x: 900, y: 450 },
        { x: 900, y: 451 },
      ],
    },
    { type: 'double_click', x: 700, y: 180 },
  ]);
  await empty(main);
  console.log('PASS repeated position and same/changed nonzero scroll; no fixture changes');
  await execute(main, [
    { type: 'click', button: 'left', x: 700, y: 180 },
    { type: 'type', text: `${'synthetic fixture '.repeat(192)}\nDesktop receipt D-2201` },
    { type: 'keypress', keys: ['CTRL', 'S'] },
  ]);
  let longText = await main.verify();
  for (let attempt = 0; attempt < 5 && longText.file_empty; attempt += 1) {
    // Wait for the actual local editor save receipt, within five normal GUI waits.
    // oxlint-disable-next-line no-await-in-loop
    await execute(main, [{ type: 'wait' }]);
    // oxlint-disable-next-line no-await-in-loop
    longText = await main.verify();
  }
  assert.equal(
    longText.file_empty,
    false,
    'A type action longer than 2,000 characters must reach the editor.',
  );
  assert.equal(longText.file_matches, false);
  assert.equal(longText.browser_effects, 0);
  // Remove the first line using only editor actions. The exact receipt began after character 2,000.
  await execute(main, [
    { type: 'keypress', keys: ['HOME'] },
    { type: 'keypress', keys: ['CTRL', 'SHIFT', 'HOME'] },
    { type: 'keypress', keys: ['BACKSPACE'] },
    { type: 'keypress', keys: ['CTRL', 'S'] },
  ]);
  const suffix = await main.verify();
  assert.equal(suffix.file_matches, true, 'The suffix beyond character 2,000 must be saved in full.');

  const edited = frame(
    await execute(main, [
      { type: 'click', button: 'left', x: 700, y: 180 },
      { type: 'keypress', keys: ['CTRL', 'A'] },
      { type: 'type', text: 'Desktop receipt D-2201' },
      { type: 'keypress', keys: ['CTRL', 'S'] },
      { type: 'wait' },
    ]),
  );
  assert.notEqual(edited, initial, 'X11 pixels must change after real work');
  const done = await main.verify();
  assert.equal(done.file_matches, true);
  assert.equal(done.browser_matches, false);
  await empty(sentinel);
  console.log('PASS actual X11/editor and exact fixed file oracle; isolated sentinel unchanged');

  for (const separator of ['\n', '\r\n']) {
    // Joining the two lines must produce the fixed receipt; dropped line breaks produce a different file.
    // oxlint-disable-next-line no-await-in-loop
    await execute(main, [
      { type: 'keypress', keys: ['CTRL', 'A'] },
      { type: 'type', text: `Desktop receipt${separator}D-2201` },
      { type: 'keypress', keys: ['HOME'] },
      { type: 'keypress', keys: ['BACKSPACE'] },
      { type: 'type', text: ' ' },
      { type: 'keypress', keys: ['CTRL', 'S'] },
    ]);
    // oxlint-disable-next-line no-await-in-loop
    const multiline = await main.verify();
    assert.equal(multiline.file_matches, true, 'Native typing must preserve a line break.');
    assert.equal(multiline.browser_effects, 0);
  }
  console.log('PASS LF and CRLF native typing against the exact fixed file oracle');
  // Finish the browser ticket last: a workspace with both records complete refuses further input.
  const seen = [];
  await execute(
    main,
    [ticket],
    {
      beforeAction: (action) => {
        seen.push(action.type);
        return true;
      },
      approveSafetyChecks: () => true,
    },
    [{ id: 'check_fixture', code: 'confirm_local_change' }],
  );
  assert.deepEqual(seen, ['click', 'screenshot']);
  const postTicket = await main.verify();
  assert.equal(postTicket.browser_matches, true);
  assert.equal(postTicket.browser_effects, 1);
  assert.equal(postTicket.file_matches, true);
  await assert.rejects(execute(main, [{ type: 'type', text: 'Late edit' }]));
  assert.deepEqual(await main.verify(), postTicket);
  assert.equal(main.uncertainEffects, false);
  const sealed = await main.seal();
  assert.equal(sealed.file_matches, true);
  assert.equal(sealed.browser_matches, true);
  const finalFrame = frame(await execute(main, [{ type: 'screenshot' }]));
  // These real inputs would otherwise alter both saved records after an observational verify.
  await assert.rejects(execute(main, [ticket]));
  await assert.rejects(
    execute(main, [
      { type: 'type', text: 'Late edit' },
      { type: 'keypress', keys: ['CTRL', 'S'] },
    ]),
  );
  assert.deepEqual(await main.verify(), sealed);
  assert.deepEqual(await main.seal(), sealed);
  assert.equal(frame(await execute(main, [{ type: 'screenshot' }])), finalFrame);
  assert.equal(main.uncertainEffects, false);
  await empty(sentinel);
  console.log(
    'PASS terminal seal: stable file/browser proof and saved frame; later real inputs refused; sentinel usable',
  );

  // Holding consent proves Stop closes admission for the complete SDK operation.
  let consentEntered;
  // An explicitly held consent callback is the Stop race under test.
  // oxlint-disable-next-line promise/avoid-new
  const entered = new Promise((resolve) => {
    consentEntered = resolve;
  });
  let release;
  // oxlint-disable-next-line promise/avoid-new
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const old = execute(main, [ticket], {
    beforeAction: async () => {
      consentEntered();
      await held;
      return true;
    },
  });
  const oldRejected = assert.rejects(old);
  await entered;
  const stopping = main.stop();
  await assert.rejects(execute(main, [ticket]));
  release();
  await Promise.all([oldRejected, stopping]);
  await assert.rejects(main.verify());
  await empty(sentinel);
  console.log('PASS Stop during consent, no later action, original retired and sentinel remains');
  console.log(JSON.stringify({ validated: true, uncertainEffects: main.uncertainEffects }));
} finally {
  await Promise.all([main.stop(), sentinel?.stop()]);
}
