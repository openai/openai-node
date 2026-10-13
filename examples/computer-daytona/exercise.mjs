import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { ComputerUse } from '@daytona/sdk';
import { ComputerToolset } from 'openai/helpers/computer';
import { VERSION } from 'openai/version';
import { fromStartedDesktop } from './adapter.mjs';

const smallPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const pixels = readFileSync(new URL('matching.png', import.meta.url));
const png = pixels.toString('base64');
const calls = [];
let value = png;
let failedPointer;
let failedRead;
let cancellation;
let changeDuringScreenshot = false;
let substituteOnRecheck = false;
let capturedReply;
let displayGate;
let changeAfterEffect;
const originalDisplay = { id: 7, isActive: true, x: 0, y: 0, width: 1024, height: 768 };
let display = { ...originalDisplay };
const capture = (kind) => async (body) => {
  calls.push([kind, body]);
  if (cancellation?.kind === kind) {
    cancellation.controller.abort(new Error('Synthetic cancellation after dispatch'));
  }
  if (changeAfterEffect === kind) {
    display = { ...display, id: 8 };
  }
  if (failedPointer === kind) {
    throw new Error('Uncertain pointer effect in local fixture.');
  }
  return { data: {} };
};
const api = {
  async getDisplayInfo() {
    if (capturedReply && substituteOnRecheck) {
      capturedReply.screenshot = 'SYNTHETIC_UNCHECKED_SCREENSHOT';
      capturedReply = undefined;
    }
    if (failedRead === 'display') {
      throw new Error('SYNTHETIC_PROVIDER_DETAIL');
    }
    if (displayGate) {
      const gate = displayGate;
      displayGate = undefined;
      gate.entered();
      await gate.finish;
    }
    return { data: { displays: [{ ...display }] } };
  },
  async takeScreenshot() {
    calls.push(['screenshot', {}]);
    if (failedRead === 'screenshot') {
      throw new Error('SYNTHETIC_PROVIDER_DETAIL');
    }
    if (cancellation?.kind === 'screenshot') {
      cancellation.controller.abort(new Error('Synthetic cancellation during capture'));
    }
    if (changeDuringScreenshot) {
      display = { ...display, id: 8 };
    }
    const data = { screenshot: value };
    if (substituteOnRecheck) {
      capturedReply = data;
    }
    return { data };
  },
  click: capture('click'),
  moveMouse: capture('move'),
  drag: capture('drag'),
  pressKey: capture('keypress'),
  typeText: capture('type'),
};
const computer = new ComputerUse(api);
let driver = await fromStartedDesktop(computer);
let tool = new ComputerToolset(driver);
const call = (action, checks = []) => ({
  type: 'computer_call',
  id: 'cu_fixture',
  call_id: 'fixture',
  status: 'completed',
  actions: [action],
  pending_safety_checks: checks,
});
const passed = [];
const failed = [];
const yes = { beforeAction: () => true };
async function checkRefusal(label, action) {
  calls.length = 0;
  let denied = false;
  try {
    await tool.execute(call(action), yes);
  } catch {
    denied = true;
  }
  const effects = calls.filter(([kind]) => kind !== 'screenshot');
  (denied && effects.length === 0 ? passed : failed).push(label);
}
if (process.argv.includes('--keys')) {
  await tool.execute(call({ type: 'screenshot' }), yes);
  for (const keys of [['Control'], ['Control', 'CTRL', 'A'], ['Shift', 'Alt'], ['Ctrl', 'ctrl']]) {
    // oxlint-disable-next-line no-await-in-loop -- Prove each refused chord leaves this adapter reusable.
    await checkRefusal(`invalid chord ${keys.join('+')}`, { type: 'keypress', keys });
  }
  calls.length = 0;
  await tool.execute(call({ type: 'keypress', keys: ['Control', 'A'] }), yes);
  assert.equal(calls[0][0], 'keypress');
  assert.deepEqual(calls[0][1], { key: 'A', modifiers: ['ctrl'] });
  assert.deepEqual(failed, []);
  console.log(JSON.stringify({ checks: passed.length + 1, api_calls: 0, vendor_calls: 0 }));
  process.exit(0);
}
const pointer = { type: 'click', x: 1023, y: 767, button: 'left' };
substituteOnRecheck = true;
assert.deepEqual(await driver.screenshot(), {
  type: 'computer_screenshot',
  image_url: `data:image/png;base64,${png}`,
});
substituteOnRecheck = false;
passed.push('screenshot:validated-snapshot-after-display');
// oxlint-disable no-await-in-loop -- Independent local transport failure at each adapter boundary.
for (const boundary of ['initial', 'display', 'screenshot', 'click']) {
  failedRead = undefined;
  failedPointer = undefined;
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  await tool.execute(call({ type: 'screenshot' }), yes);
  failedRead = boundary === 'initial' ? 'display' : boundary;
  failedPointer = boundary === 'click' ? 'click' : undefined;
  await assert.rejects(
    boundary === 'initial'
      ? fromStartedDesktop(computer)
      : tool.execute(call(boundary === 'click' ? pointer : { type: 'screenshot' }), yes),
    (error) => {
      assert.match(String(error), /Daytona provider operation failed/u);
      assert.doesNotMatch(String(error.stack), /SYNTHETIC_PROVIDER_DETAIL|Uncertain pointer effect/u);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  passed.push(`sanitized:${boundary}`);
}
// oxlint-enable no-await-in-loop
failedRead = undefined;
failedPointer = undefined;
driver = await fromStartedDesktop(computer);
tool = new ComputerToolset(driver);
await checkRefusal('display:initial-screenshot-required', pointer);
await tool.execute(call({ type: 'screenshot' }), yes);
const cases = [
  [{ type: 'click', x: 20, y: 25, button: 'right' }, 'click'],
  [{ type: 'double_click', x: 20, y: 25, keys: null }, 'click'],
  [{ type: 'move', x: 20, y: 25 }, 'move'],
  [
    {
      type: 'drag',
      path: [
        { x: 1, y: 2 },
        { x: 5, y: 8 },
      ],
    },
    'drag',
  ],
  [{ type: 'keypress', keys: ['Control', 'ArrowDown'] }, 'keypress'],
  [{ type: 'type', text: 'synthetic fixture' }, 'type'],
  [{ type: 'screenshot' }, 'screenshot'],
];
for (const [action, name] of cases) {
  calls.length = 0;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  const result = await tool.execute(call(action), { beforeAction: () => true });
  assert.equal(calls[0][0], name);
  assert.deepEqual(result.output, { type: 'computer_screenshot', image_url: `data:image/png;base64,${png}` });
  if (name === 'keypress') {
    assert.deepEqual(calls[0][1], { key: 'down', modifiers: ['ctrl'] });
  }
  passed.push(`supported:${action.type}`);
}
const unsupported = [
  { type: 'click', x: 20, y: 25, button: 'back' },
  { type: 'click', x: 20, y: 25, button: 'wheel' },
  { type: 'click', x: 20, y: 25, button: 'left', keys: ['CTRL'] },
  { type: 'move', x: 20, y: 25, keys: ['Shift'] },
  { type: 'double_click', x: 20, y: 25, keys: ['Alt'] },
  {
    type: 'drag',
    path: [
      { x: 1, y: 2 },
      { x: 5, y: 8 },
      { x: 20, y: 30 },
    ],
  },
  {
    type: 'drag',
    path: [
      { x: 1, y: 2 },
      { x: 5, y: 8 },
    ],
    keys: ['Shift'],
  },
  { type: 'scroll', x: 20, y: 25, scroll_x: 100, scroll_y: 0 },
  { type: 'scroll', x: 20, y: 25, scroll_x: 0, scroll_y: 100 },
  { type: 'move', x: 1024, y: 2 },
  { type: 'keypress', keys: ['some-main-key', 'Z'] },
];
for (const [index, action] of unsupported.entries()) {
  calls.length = 0;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await assert.rejects(tool.execute(call(action), { beforeAction: () => true }));
  assert.deepEqual(calls, []);
  passed.push(`unsupported:${index}:${action.type}`);
}
for (const checks of [[], [{ id: 'check1', code: 'fixture', message: 'synthetic' }]]) {
  calls.length = 0;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await assert.rejects(
    tool.execute(call(cases[0][0], checks), {
      beforeAction: () => checks.length > 0,
      approveSafetyChecks: () => false,
    }),
  );
  assert.deepEqual(calls, []);
  passed.push(`refused:${checks.length ? 'safety' : 'action'}`);
}
for (const invalid of [
  '',
  'https://example.invalid/private',
  Buffer.from('other pixels').toString('base64'),
]) {
  value = invalid;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await assert.rejects(tool.execute(call({ type: 'screenshot' }), { beforeAction: () => true }));
  passed.push('screenshot:invalid');
}
display = { ...originalDisplay, width: 1, height: 1 };
const small = Buffer.from(smallPng, 'base64');
// oxlint-disable no-await-in-loop -- Check exact byte budgets for each base64 padding shape on one display.
for (let extra = 0; extra < 3; extra += 1) {
  const text = Buffer.from(`Comment\0${'x'.repeat(66_000 + extra)}`);
  const chunk = Buffer.concat([Buffer.from('tEXt'), text]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(text.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(chunk));
  const image = Buffer.concat([small.subarray(0, -12), length, chunk, checksum, small.subarray(-12)]);
  value = smallPng;
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  await tool.execute(call({ type: 'screenshot' }), yes);
  value = image.toString('base64');
  await checkRefusal(`screenshot:default-byte-budget:${extra}`, { type: 'screenshot' });
  await checkRefusal(`screenshot:budget-invalidates-pointer:${extra}`, {
    type: 'click',
    x: 0,
    y: 0,
    button: 'left',
  });
  assert.deepEqual(failed, []);
  driver = await fromStartedDesktop(computer, undefined, image.length - 1);
  tool = new ComputerToolset(driver);
  await checkRefusal(`screenshot:one-byte-over:${extra}`, { type: 'screenshot' });
  driver = await fromStartedDesktop(computer, undefined, image.length);
  tool = new ComputerToolset(driver);
  const result = await tool.execute(call({ type: 'screenshot' }), yes);
  assert.deepEqual(result.output, {
    type: 'computer_screenshot',
    image_url: `data:image/png;base64,${value}`,
  });
  await tool.execute(call({ type: 'click', x: 0, y: 0, button: 'left' }), yes);
  passed.push(`screenshot:exact-byte-budget-and-pointer:${extra}`);
}
// oxlint-enable no-await-in-loop
display = { ...originalDisplay };
value = png;
driver = await fromStartedDesktop(computer);
tool = new ComputerToolset(driver);
const wrongLength = Buffer.from(pixels);
wrongLength.writeUInt32BE(12, 8);
for (const [label, payload] of [
  ['one-pixel', Buffer.from(smallPng, 'base64')],
  ['signature-only', pixels.subarray(0, 8)],
  ['truncated-ihdr', pixels.subarray(0, 32)],
  ['ihdr-only', pixels.subarray(0, 33)],
  ['no-iend', pixels.subarray(0, -12)],
  ['wrong-chunk', Buffer.concat([pixels.subarray(0, 12), Buffer.from('IDAT'), pixels.subarray(16)])],
  ['wrong-length', wrongLength],
]) {
  value = png;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await tool.execute(call({ type: 'screenshot' }), yes);
  value = payload.toString('base64');
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await checkRefusal(`screenshot:${label}`, { type: 'screenshot' });
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await checkRefusal(`display:invalidated:${label}`, pointer);
}
value = png;
for (const [action, name] of cases.slice(0, 4)) {
  // oxlint-disable-next-line no-await-in-loop
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  // oxlint-disable-next-line no-await-in-loop
  await tool.execute(call({ type: 'screenshot' }), yes);
  calls.length = 0;
  failedPointer = name;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each fixture action must settle before changing failure mode.
  await assert.rejects(tool.execute(call(action), yes));
  assert.equal(calls[0][0], name);
  failedPointer = undefined;
  // oxlint-disable-next-line eslint/no-await-in-loop -- A failed dispatch must require a new frame.
  await checkRefusal(`display:failed-${action.type}-invalidates-frame`, pointer);
  // oxlint-disable-next-line no-await-in-loop
  await checkRefusal(`display:failed-${action.type}-retires-capture`, { type: 'screenshot' });
}
driver = await fromStartedDesktop(computer);
tool = new ComputerToolset(driver);
await tool.execute(call({ type: 'screenshot' }), yes);
calls.length = 0;
await tool.execute({ ...call(pointer), actions: [pointer, pointer] }, yes);
assert.deepEqual(
  calls.map(([kind]) => kind),
  ['click', 'click', 'screenshot'],
);
passed.push('display:successful-multi-pointer-batch');
for (const moment of ['before', 'during']) {
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each fixture has its own adapter identity.
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  if (moment === 'before') {
    display.id = 8;
  }
  changeDuringScreenshot = moment === 'during';
  // oxlint-disable-next-line eslint/no-await-in-loop -- Both identity checks must precede publication.
  await checkRefusal(`display:changed-${moment}-capture`, { type: 'screenshot' });
  changeDuringScreenshot = false;
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Restoring identity must not revive an adapter.
  await checkRefusal(`display:retired-after-${moment}-capture`, pointer);
}
for (const [action, name] of cases.slice(4, 6)) {
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each uncertain operation uses a fresh adapter.
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  // oxlint-disable-next-line eslint/no-await-in-loop -- Establish pointer access before keyboard failure.
  await tool.execute(call({ type: 'screenshot' }), yes);
  failedPointer = name;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Fixture intentionally fails one provider send.
  await assert.rejects(tool.execute(call(action), yes));
  failedPointer = undefined;
  // oxlint-disable-next-line eslint/no-await-in-loop -- An uncertain keyboard send cannot reuse a frame.
  await checkRefusal(`display:failed-${name}-retires-pointer`, pointer);
  // oxlint-disable-next-line eslint/no-await-in-loop -- Fresh screenshots cannot revive a retired adapter.
  await checkRefusal(`display:failed-${name}-retires-capture`, { type: 'screenshot' });
}
for (const action of [
  { type: 'type', text: 'must not reach replacement' },
  { type: 'keypress', keys: ['Enter'] },
]) {
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Create a separate borrowed desktop for each first keyboard action.
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  display.id = 8;
  // oxlint-disable-next-line eslint/no-await-in-loop -- No pointer action must be needed to detect a replacement.
  await checkRefusal(`display:changed-before-first-${action.type}`, action);
}
display = { ...originalDisplay };
driver = await fromStartedDesktop(computer);
tool = new ComputerToolset(driver);
await checkRefusal('keypress:empty', { type: 'keypress', keys: [''] });
calls.length = 0;
await tool.execute(call({ type: 'keypress', keys: ['𐐀'] }), yes);
assert.equal(calls[0][0], 'keypress');
(calls[0][1].key === '𐐀' ? passed : failed).push('keypress:non-bmp-preserved');
for (const [label, replacement] of [
  ['resize', { width: 640, height: 480 }],
  ['identity', { id: 8 }],
  ['missing-id', { id: undefined }],
]) {
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await tool.execute(call({ type: 'screenshot' }), yes);
  display = { ...display, ...replacement };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await checkRefusal(`display:${label}`, pointer);
  display = { ...originalDisplay };
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
  await checkRefusal(`display:retired:${label}`, { type: 'screenshot' });
  if (label === 'identity') {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
    await checkRefusal('display:retired:type', { type: 'type', text: 'unwanted after retirement' });
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each case must settle before changing this one borrowed display.
    await checkRefusal('display:retired:keypress', { type: 'keypress', keys: ['Enter'] });
  }
}
driver = await fromStartedDesktop(computer);
tool = new ComputerToolset(driver);
calls.length = 0;
await tool.execute(call({ type: 'type', text: 'fresh adapter' }), yes);
assert.equal(calls[0][0], 'type');
assert.equal(calls[0][1].text, 'fresh adapter');
passed.push('display:fresh-adapter:type');
calls.length = 0;
await tool.execute(call({ type: 'keypress', keys: ['Enter'] }), yes);
assert.equal(calls[0][0], 'keypress');
assert.equal(calls[0][1].key, 'enter');
passed.push('display:fresh-adapter:keypress');
await tool.execute(call({ type: 'screenshot' }), yes);
calls.length = 0;
await tool.execute(call(pointer), yes);
assert.deepEqual(calls[0], ['click', { x: 1023, y: 767, button: 'left', double: false }]);
passed.push('display:fresh-driver-visible-positive');
for (const [action, kind] of [
  [pointer, 'click'],
  [{ type: 'move', x: 12, y: 12 }, 'move'],
  [{ type: 'type', text: 'Synthetic input' }, 'type'],
  [{ type: 'keypress', keys: ['Enter'] }, 'keypress'],
  [{ type: 'screenshot' }, 'screenshot'],
]) {
  // oxlint-disable-next-line no-await-in-loop
  driver = await fromStartedDesktop(computer);
  tool = new ComputerToolset(driver);
  // oxlint-disable-next-line no-await-in-loop
  await tool.execute(call({ type: 'screenshot' }), yes);
  cancellation = { kind, controller: new AbortController() };
  calls.length = 0;
  // oxlint-disable-next-line no-await-in-loop
  await assert.rejects(tool.execute(call(action), { ...yes, signal: cancellation.controller.signal }));
  assert.equal(calls.filter(([name]) => name === kind).length, 1);
  cancellation = undefined;
  // oxlint-disable-next-line no-await-in-loop
  await checkRefusal(`cancel:${kind}:pointer-revoked`, pointer);
  // oxlint-disable-next-line no-await-in-loop
  await checkRefusal(`cancel:${kind}:fresh-capture-cannot-revive`, { type: 'screenshot' });
}
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const daytonaEntry = import.meta.resolve('@daytona/sdk');

// Direct calls share the adapter even if the caller creates multiple public toolsets.
// oxlint-disable no-await-in-loop -- Fresh retired adapters and display identity per case.
for (const [action, kind] of [
  [{ type: 'click', x: 10, y: 10, button: 'left' }, 'click'],
  [{ type: 'type', text: 'fixture' }, 'type'],
  [{ type: 'keypress', keys: ['Enter'] }, 'keypress'],
]) {
  display = { ...originalDisplay };
  driver = await fromStartedDesktop(computer);
  await driver.screenshot();
  changeAfterEffect = kind;
  await assert.rejects(driver[action.type](action));
  changeAfterEffect = undefined;
  display = { ...originalDisplay };
  await assert.rejects(driver.screenshot());
  passed.push(`direct:display-switched-during-${kind}`);
}
display = { ...originalDisplay };
driver = await fromStartedDesktop(computer);
await driver.screenshot();
let finish;
let entered;
// oxlint-disable-next-line promise/avoid-new -- Hold the real provider call at a deterministic admission boundary.
const started = new Promise((resolve) => {
  entered = resolve;
});
displayGate = {
  entered,
  // oxlint-disable-next-line promise/avoid-new -- Release the same held provider call after overlap checks.
  finish: new Promise((resolve) => {
    finish = resolve;
  }),
};
calls.length = 0;
const pendingClick = driver.click({ type: 'click', x: 10, y: 10, button: 'left' });
await started;
await assert.rejects(driver.screenshot());
await assert.rejects(driver.type({ type: 'type', text: 'overlap' }));
await assert.rejects(driver.click({ type: 'click', x: 20, y: 20, button: 'left' }));
assert.deepEqual(calls, []);
finish();
await pendingClick;
assert.deepEqual(
  calls.map(([kind]) => kind),
  ['click'],
);
await driver.screenshot();
passed.push('direct:overlap-refused-before-dispatch-and-capture');
const cancelled = new AbortController();
cancelled.abort(new Error('Synthetic call cancelled before admission'));
calls.length = 0;
await assert.rejects(driver.type({ type: 'type', text: 'fixture' }, { signal: cancelled.signal }));
await assert.rejects(driver.screenshot({ signal: cancelled.signal }));
assert.deepEqual(calls, []);
await driver.click(pointer);
assert.deepEqual(
  calls.map(([kind]) => kind),
  ['click'],
);
passed.push('direct:cancelled-before-admission-preserves-frame');
for (const original of [
  { type: 'click', x: 20, y: 25, button: 'left' },
  { type: 'double_click', x: 20, y: 25 },
  { type: 'move', x: 20, y: 25 },
  {
    type: 'drag',
    path: [
      { x: 1, y: 2 },
      { x: 5, y: 8 },
    ],
  },
  { type: 'type', text: 'Original fixture text' },
]) {
  display = { ...originalDisplay };
  driver = await fromStartedDesktop(computer);
  await driver.screenshot();
  calls.length = 0;
  await driver[original.type](structuredClone(original));
  const expected = structuredClone(calls);
  await driver.screenshot();
  const action = structuredClone(original);
  let ready;
  let resume;
  // oxlint-disable-next-line promise/avoid-new -- Control only the provider's display read.
  const gateEntered = new Promise((resolve) => {
    ready = resolve;
  });
  displayGate = {
    entered: ready,
    // oxlint-disable-next-line promise/avoid-new -- Release the held display query before inspecting provider effects.
    finish: new Promise((resolve) => {
      resume = resolve;
    }),
  };
  calls.length = 0;
  const pending = driver[action.type](action);
  await gateEntered;
  if (action.type === 'drag') {
    action.path[0].x = 2000;
    action.path[1].y = 3000;
  } else if (action.type === 'type') {
    action.text = 'Changed fixture text';
  } else {
    action.x = 2000;
    action.y = 3000;
    action.button = 'wheel';
  }
  assert.deepEqual(calls, []);
  resume();
  await pending;
  assert.deepEqual(calls, expected);
  await driver.screenshot();
  passed.push(`direct:captured-before-display:${original.type}`);
}
// oxlint-enable no-await-in-loop
console.log(
  JSON.stringify(
    {
      scope:
        'published Daytona SDK -> in-process fake toolbox transport; installed OpenAI helper; no hosted API',
      runtime: process.version,
      daytona: JSON.parse(readFileSync(new URL(import.meta.resolve('@daytona/sdk/package.json')))).version,
      openai: VERSION,
      providerFileSha256: sha(new URL('ComputerUse.js', daytonaEntry)),
      providerTypesSha256: sha(new URL('ComputerUse.d.ts', daytonaEntry)),
      passed,
      count: passed.length,
      failed,
    },
    null,
    2,
  ),
);
if (failed.length) {
  process.exitCode = 1;
}
