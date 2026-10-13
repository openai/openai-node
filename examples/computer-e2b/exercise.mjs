/* eslint-disable no-await-in-loop -- Finish each fixture's cleanup before starting the next case. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Sandbox } from '@e2b/desktop';
import OpenAI from 'openai';
import { ComputerToolset } from 'openai/helpers/computer';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { E2BComputer } from './adapter.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAE0lEQVR4nGP4TyJgGNUwqgE7AAATaT3feQFNJQAAAABJRU5ErkJggg==',
  'base64',
);
const yes = { beforeAction: () => true };
const call = (action) => ({
  type: 'computer_call',
  id: 'computer_fixture',
  call_id: 'computer_fixture',
  status: 'completed',
  actions: [action],
  pending_safety_checks: [],
});
const passed = [];
async function check(name, run) {
  await run();
  passed.push(name);
}

async function fixture(frame = true) {
  const state = {
    id: 'local-fixture',
    width: 16,
    height: 12,
    x: 7,
    y: 7,
    calls: [],
    clicks: [],
    keys: [],
    text: '',
    writes: 0,
    files: new Map(),
    image: png,
    failMove: false,
    failRead: false,
    failRemove: false,
    afterRead: null,
    holdMove: null,
    streamClosed: 0,
  };
  const commands = {
    async run(command) {
      state.calls.push(command);
      if (command === 'xrandr') {
        state.afterSize?.();
        return { stdout: `screen connected ${state.width}x${state.height}+0+0` };
      }
      const capture = /^scrot --pointer (?<path>\/tmp\/openai-computer-[0-9a-f-]+\.png)$/u.exec(command);
      if (capture) {
        state.files.set(capture.groups.path, state.image);
        return { stdout: '' };
      }
      const move = /^xdotool mousemove --sync (?<x>\d+) (?<y>\d+)$/u.exec(command);
      if (move) {
        if (state.holdMove) {
          await state.holdMove;
        }
        if (state.failMove) {
          throw new Error('fixture move failure');
        }
        state.x = Number(move.groups.x);
        state.y = Number(move.groups.y);
        state.afterMove?.();
        return { stdout: '' };
      }
      const click = /^xdotool click (?:--repeat (?<count>\d+) )?(?<button>[123])$/u.exec(command);
      if (click) {
        state.clicks.push({
          x: state.x,
          y: state.y,
          button: Number(click.groups.button),
          count: Number(click.groups.count ?? 1),
        });
        return { stdout: '' };
      }
      if (command.startsWith('xdotool key ')) {
        state.keys.push(command.slice(12));
        state.afterKey?.();
        return { stdout: '' };
      }
      const type = /^xdotool type --delay 0 -- (?<text>.*)$/su.exec(command);
      if (type) {
        state.text += execFileSync('/bin/sh', ['-c', `printf %s ${type.groups.text}`], {
          encoding: 'utf-8',
          env: { SDK_FIXTURE_WORD: 'expanded' },
          maxBuffer: 16_384,
        });
        state.writes += 1;
        state.afterWrite?.();
        return { stdout: '' };
      }
      throw new Error('Unexpected fixture command');
    },
  };
  const files = {
    async read(path, options) {
      assert.equal(options.format, 'stream');
      if (state.failRead) {
        throw new Error('fixture read failure');
      }
      const bytes = state.files.get(path);
      state.stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          if (state.afterRead) {
            state.afterRead();
          }
          controller.close();
        },
        cancel() {
          state.streamClosed += 1;
        },
      });
      return state.stream;
    },
    async remove(path) {
      if (state.failRemove) {
        throw new Error('fixture removal failure');
      }
      state.files.delete(path);
    },
  };
  const sandbox = Object.create(Sandbox.prototype);
  Object.defineProperties(sandbox, {
    sandboxId: { get: () => state.id },
    commands: { value: commands },
    files: { value: files },
  });
  const driver = await E2BComputer.fromStartedDesktop(sandbox);
  const tool = new ComputerToolset(driver);
  if (frame) {
    await tool.execute(call({ type: 'screenshot' }), yes);
  }
  return { state, sandbox, driver, tool };
}

for (const [name, action, expected] of [
  ['left at x zero', { type: 'click', x: 0, y: 5, button: 'left' }, { x: 0, y: 5, button: 1, count: 1 }],
  ['right at y zero', { type: 'click', x: 5, y: 0, button: 'right' }, { x: 5, y: 0, button: 3, count: 1 }],
  ['double at origin', { type: 'double_click', x: 0, y: 0 }, { x: 0, y: 0, button: 1, count: 2 }],
]) {
  await check(name, async () => {
    const { state, driver, tool } = await fixture();
    await tool.execute(call(action), yes);
    assert.deepEqual(state.clicks, [expected]);
    assert.equal(state.files.size, 0);
    await driver.close();
  });
}

await check('real provider edge bug control', async () => {
  const { state, sandbox, driver } = await fixture();
  await sandbox.leftClick(0, 5);
  assert.deepEqual(state.clicks, [{ x: 7, y: 7, button: 1, count: 1 }]);
  await driver.close();
});
await check('matching image and edge move', async () => {
  const { state, driver, tool } = await fixture();
  const result = await tool.execute(call({ type: 'move', x: 15, y: 11 }), yes);
  assert.deepEqual([state.x, state.y], [15, 11]);
  assert.equal(result.output.image_url, `data:image/png;base64,${png.toString('base64')}`);
  await driver.close();
});
await check('first screenshot required', async () => {
  const { state, driver } = await fixture(false);
  const before = state.calls.length;
  await assert.rejects(driver.click({ x: 1, y: 1, button: 'left' }));
  assert.equal(state.calls.length, before);
  await driver.screenshot();
  await driver.close();
});

await check('malformed pointer modifiers never reach the provider', async () => {
  const { state, driver, tool } = await fixture();
  const before = state.calls.length;
  for (const keys of [1, 0, false, '', {}, { length: 0, ctrl: true }]) {
    await assert.rejects(tool.execute(call({ type: 'click', x: 0, y: 0, button: 'left', keys }), yes));
  }
  assert.equal(state.calls.length, before);
  await driver.click({ x: 0, y: 0, button: 'left', keys: [] });
  assert.deepEqual(state.clicks, [{ x: 0, y: 0, button: 1, count: 1 }]);
  await driver.close();
});

for (const action of [
  { type: 'move', x: -1, y: 0 },
  { type: 'move', x: 16, y: 0 },
  { type: 'move', x: 0, y: 12 },
  { type: 'move', x: 0.5, y: 0 },
  { type: 'move', x: true, y: 0 },
  { type: 'click', x: 0, y: 0, button: 'wheel' },
  { type: 'click', x: 0, y: 0, button: 'back' },
  { type: 'click', x: 0, y: 0, button: 'left', keys: ['CTRL'] },
  {
    type: 'drag',
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  { type: 'scroll', x: 0, y: 0, scroll_x: 0, scroll_y: 100 },
  { type: 'keypress', keys: ['a;printf injected'] },
  { type: 'keypress', keys: ['constructor'] },
  { type: 'keypress', keys: ['__proto__'] },
  { type: 'keypress', keys: ['CTRL', 'CTRL', 'a'] },
  { type: 'type', text: '\0' },
  { type: 'type', text: '\uD800' },
  { type: 'type', text: 'a'.repeat(4097) },
]) {
  await check(`refusal ${passed.length}`, async () => {
    const { state, driver, tool } = await fixture();
    const before = state.calls.length;
    await assert.rejects(tool.execute(call(action), yes));
    assert.equal(state.calls.length, before);
    await driver.close();
  });
}

await check('safe chord', async () => {
  const { state, driver, tool } = await fixture();
  await tool.execute(call({ type: 'keypress', keys: ['CTRL', 'a'] }), yes);
  await tool.execute(call({ type: 'keypress', keys: ['ENTER'] }), yes);
  await tool.execute(call({ type: 'keypress', keys: ['PAGEUP'] }), yes);
  assert.deepEqual(state.keys, ['Control_L+a', 'Return', 'Page_Up']);
  await driver.close();
});
await check('validated pointer values survive caller mutation', async () => {
  const { state, driver } = await fixture();
  const action = { x: 0, y: 0, button: 'left' };
  state.afterSize = () => Object.assign(action, { x: 999, y: 999, button: 'right' });
  await driver.click(action);
  assert.deepEqual(state.clicks, [{ x: 0, y: 0, button: 1, count: 1 }]);
  await driver.close();
});
await check('identity change during size query prevents input', async () => {
  const { state, driver } = await fixture();
  state.afterSize = () => {
    state.id = 'different';
  };
  await assert.rejects(driver.type({ text: 'refused' }));
  assert.equal(state.writes, 0);
  await driver.close();
});
for (const mode of ['left', 'right', 'double_click', 'move', 'type', 'keypress']) {
  await check(`changed identity or dimensions after ${mode} retires before further input`, async () => {
    const { state, driver } = await fixture();
    if (mode === 'type') {
      state.afterWrite = () => {
        state.width += 1;
      };
      await assert.rejects(driver.type({ text: 'one local note' }));
      assert.equal(state.writes, 1);
    } else if (mode === 'keypress') {
      state.afterKey = () => {
        state.id = 'different';
      };
      await assert.rejects(driver.keypress({ keys: ['Enter'] }));
      assert.equal(state.keys.length, 1);
    } else {
      state.afterMove = () => {
        state.id = 'different';
      };
      const action = { x: 0, y: 0, keys: null };
      const work = ['left', 'right'].includes(mode)
        ? driver.click({ ...action, button: mode })
        : driver[mode](action);
      await assert.rejects(work);
      assert.deepEqual(state.clicks, []);
    }
    const count = state.calls.length;
    await assert.rejects(driver.type({ text: 'refused' }));
    await assert.rejects(driver.screenshot());
    assert.equal(state.calls.length, count);
    await driver.close();
  });
}
await check('Unicode and shell text preserved in one command', async () => {
  const { state, driver, tool } = await fixture();
  const text = `${'a'.repeat(24)}😀 ' " $SDK_FIXTURE_WORD $(printf injected); end`;
  await tool.execute(call({ type: 'type', text }), yes);
  assert.equal(state.text, text);
  assert.equal(state.writes, 1);
  await driver.close();
});
await check('strict approval and Stop', async () => {
  const { state, driver, tool } = await fixture();
  const before = state.calls.length;
  await assert.rejects(
    tool.execute(call({ type: 'click', x: 0, y: 0, button: 'left' }), {
      beforeAction: () => ({ approved: true }),
    }),
  );
  await assert.rejects(
    tool.execute(call({ type: 'click', x: 0, y: 0, button: 'left' }), {
      ...yes,
      signal: AbortSignal.abort(),
    }),
  );
  assert.equal(state.calls.length, before);
  await driver.close();
});
await check('failed move never clicks and retires keyboard', async () => {
  const { state, driver, tool } = await fixture();
  state.failMove = true;
  await assert.rejects(tool.execute(call({ type: 'click', x: 0, y: 0, button: 'left' }), yes));
  assert.equal(state.clicks.length, 0);
  const before = state.calls.length;
  await assert.rejects(driver.type({ text: 'refused' }));
  await assert.rejects(driver.keypress({ keys: ['a'] }));
  assert.equal(state.calls.length, before);
  await driver.close();
});
for (const action of [
  { type: 'click', x: 0, y: 0, button: 'left' },
  { type: 'click', x: 0, y: 0, button: 'right' },
  { type: 'double_click', x: 0, y: 0 },
  { type: 'move', x: 0, y: 0 },
]) {
  await check(`Stop during ${action.type} ${action.button ?? ''} drains move and retires`, async () => {
    const { state, driver, tool } = await fixture();
    const gate = Promise.withResolvers();
    const stop = new AbortController();
    state.holdMove = gate.promise;
    const pending = tool.execute(call(action), { ...yes, signal: stop.signal });
    const settled = assert.rejects(pending);
    await nextTurn();
    stop.abort(new Error('fixture Stop'));
    gate.resolve();
    await settled;
    assert.deepEqual(state.clicks, []);
    const before = state.calls.length;
    await assert.rejects(driver.type({ text: 'refused' }));
    await assert.rejects(driver.screenshot());
    assert.equal(state.calls.length, before);
    await driver.close();
  });
}
for (const kind of [
  'read',
  'invalid PNG',
  'ihdr-only',
  'no-iend',
  'oversize',
  'changed size',
  'changed identity',
  'remove',
]) {
  await check(`capture ${kind}`, async () => {
    const { state, driver } = await fixture();
    if (kind === 'read') {
      state.failRead = true;
    }
    if (kind === 'invalid PNG') {
      state.image = Buffer.from('invalid');
    }
    if (kind === 'ihdr-only') {
      state.image = png.subarray(0, 33);
    }
    if (kind === 'no-iend') {
      state.image = png.subarray(0, -12);
    }
    if (kind === 'oversize') {
      state.image = Buffer.alloc(8 * 1024 * 1024 + 1);
    }
    if (kind === 'changed size') {
      state.afterRead = () => {
        state.width = 17;
      };
    }
    if (kind === 'changed identity') {
      state.afterRead = () => {
        state.id = 'different';
      };
    }
    if (kind === 'remove') {
      state.failRemove = true;
    }
    await assert.rejects(driver.screenshot());
    assert.equal(state.stream.locked, false);
    const before = state.calls.length;
    await assert.rejects(driver.type({ text: 'refused' }));
    assert.equal(state.calls.length, before);
    if (kind === 'remove' || kind === 'changed identity') {
      assert.equal(state.files.size, 1);
    } else {
      assert.equal(state.files.size, 0);
    }
    state.id = 'local-fixture';
    state.failRemove = false;
    await driver.close();
    assert.equal(state.files.size, 0);
  });
}
await check('concurrent input and early close refused until drain', async () => {
  const { state, driver } = await fixture();
  const gate = Promise.withResolvers();
  state.holdMove = gate.promise;
  const pending = driver.click({ x: 0, y: 0, button: 'left' });
  await nextTurn();
  await assert.rejects(driver.type({ text: 'refused' }));
  await assert.rejects(driver.close());
  gate.resolve();
  await pending;
  await driver.close();
  assert.equal(state.clicks.length, 1);
  assert.equal(state.text, '');
});
await check('mixed Responses preserves tool results', async () => {
  const { state, driver, tool } = await fixture();
  const bodies = [];
  const client = new OpenAI({
    apiKey: 'fixture',
    baseURL: 'http://127.0.0.1:1',
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      bodies.push(await request.json());
      const output =
        bodies.length === 1
          ? [
              call({ type: 'click', x: 0, y: 0, button: 'left' }),
              {
                type: 'function_call',
                id: 'oracle',
                call_id: 'oracle',
                name: 'oracle',
                arguments: '{}',
                status: 'completed',
              },
            ]
          : [
              {
                type: 'message',
                id: 'done',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'done', annotations: [] }],
              },
            ];
      return Response.json({
        id: `response_${bodies.length}`,
        object: 'response',
        created_at: 0,
        status: 'completed',
        model: '',
        output,
      });
    },
  });
  const runner = new ResponsesToolRunner({
    computer: tool,
    functions: [
      {
        tool: {
          type: 'function',
          name: 'oracle',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          strict: true,
        },
        execute: () => String(state.clicks.length),
      },
    ],
  });
  await runner.run(client, { model: '', input: 'fixture' }, { maxSteps: 3, computerOptions: yes });
  assert.equal(bodies.length, 2);
  assert.equal(state.clicks.length, 1);
  assert.ok(
    bodies[1].input.some(
      (item) => item.type === 'function_call_output' && item.call_id === 'oracle' && item.output === '1',
    ),
  );
  assert.ok(
    bodies[1].input.some(
      (item) => item.type === 'computer_call_output' && item.call_id === 'computer_fixture',
    ),
  );
  await driver.close();
});

console.log(
  JSON.stringify({
    passed: passed.length,
    cases: passed,
    provider: 'installed E2B methods with controlled command/file facades',
    realProviderRequests: 0,
    realModelRequests: 0,
  }),
);
