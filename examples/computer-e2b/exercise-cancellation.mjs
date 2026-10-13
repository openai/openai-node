/* eslint-disable no-await-in-loop -- Settle each local fixture before admitting another. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerToolset } from 'openai/helpers/computer';
import { E2BComputer } from './adapter.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAE0lEQVR4nGP4TyJgGNUwqgE7AAATaT3feQFNJQAAAABJRU5ErkJggg==',
  'base64',
);
const call = (action) => ({
  type: 'computer_call',
  id: 'fixture',
  call_id: 'fixture',
  status: 'completed',
  actions: [action],
  pending_safety_checks: [],
});
function deferred() {
  let release;
  // eslint-disable-next-line promise/avoid-new -- Tests explicitly hold and release one native input.
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture() {
  const entered = deferred();
  const gate = deferred();
  const effects = [];
  const files = new Map();
  let held;
  const work = async (operation) => {
    effects.push(operation);
    if (held === operation) {
      entered.release();
      await gate.promise;
    }
  };
  const sandbox = {
    sandboxId: 'local-fixture',
    getScreenSize: () => ({ width: 16, height: 12 }),
    moveMouse: () => work('move'),
    leftClick: () => work('left'),
    rightClick: () => work('right'),
    doubleClick: () => work('double'),
    press: () => work('key'),
    write: () => work('text'),
    commands: {
      async run(command) {
        const path = command.match(/^scrot --pointer (?<path>\/tmp\/openai-computer-[0-9a-f-]+\.png)$/u)
          ?.groups.path;
        assert.ok(path);
        files.set(path, png);
      },
    },
    files: {
      async read(path) {
        assert.ok(files.has(path));
        return new ReadableStream({
          start(controller) {
            controller.enqueue(files.get(path));
            controller.close();
          },
        });
      },
      async remove(path) {
        files.delete(path);
      },
    },
  };
  return {
    sandbox,
    effects,
    files,
    entered,
    gate,
    hold(value) {
      held = value;
    },
  };
}

let checks = 0;
{
  const f = fixture();
  const adapter = await E2BComputer.fromStartedDesktop(f.sandbox);
  const controller = new AbortController();
  const capture = f.sandbox.commands.run;
  let received;
  f.sandbox.commands.run = async (command, options) => {
    await capture(command);
    received = options.signal;
    f.entered.release();
    await f.gate.promise;
  };
  const outcome = (async () => {
    try {
      await adapter.screenshot({ signal: controller.signal });
      return 'completed';
    } catch (error) {
      return error;
    }
  })();
  try {
    await f.entered.promise;
    assert.equal(received, controller.signal, 'The provider capture must receive the caller signal');
    controller.abort(new Error('fixture Stop during capture'));
  } finally {
    f.gate.release();
    const error = await outcome;
    await adapter.close();
    assert.equal(f.files.size, 0, 'The capture path is removed even after interruption');
    if (controller.signal.aborted) {
      assert.ok(error instanceof Error && /cancel|stop/iu.test(error.message));
      await assert.rejects(adapter.screenshot());
    }
  }
  checks += 1;
}
const actions = [
  { held: 'move', action: { type: 'click', x: 1, y: 2, button: 'left' }, expected: ['move'] },
  { held: 'move', action: { type: 'double_click', x: 1, y: 2 }, expected: ['move'] },
  { held: 'move', action: { type: 'move', x: 1, y: 2 }, expected: ['move'] },
  { held: 'left', action: { type: 'click', x: 1, y: 2, button: 'left' }, expected: ['move', 'left'] },
  { held: 'right', action: { type: 'click', x: 1, y: 2, button: 'right' }, expected: ['move', 'right'] },
  { held: 'double', action: { type: 'double_click', x: 1, y: 2 }, expected: ['move', 'double'] },
  { held: 'key', action: { type: 'keypress', keys: ['ENTER'] }, expected: ['key'] },
  { held: 'text', action: { type: 'type', text: 'local fixture' }, expected: ['text'] },
];
for (const { held, action, expected } of actions) {
  const f = fixture();
  const adapter = await E2BComputer.fromStartedDesktop(f.sandbox);
  await adapter.screenshot();
  f.hold(held);
  const controller = new AbortController();
  const toolset = new ComputerToolset(adapter);
  let settled = false;
  const active = toolset.execute(call(action), { beforeAction: () => true, signal: controller.signal });
  const outcome = (async () => {
    try {
      await active;
      return 'completed';
    } catch (error) {
      return error;
    } finally {
      settled = true;
    }
  })();
  await f.entered.promise;
  controller.abort(new Error('fixture Stop'));
  await assert.rejects(adapter.keypress({ type: 'keypress', keys: ['ENTER'] }), /already running/u);
  assert.equal(settled, false, 'Stop must retain the admitted input until the provider call settles');
  f.gate.release();
  const error = await outcome;
  assert.ok(error instanceof Error && /cancel|stop/iu.test(error.message));
  assert.deepEqual(f.effects, expected, 'Never issue the next input after Stop');
  await assert.rejects(
    toolset.execute(call({ type: 'click', x: 1, y: 2, button: 'left' }), { beforeAction: () => true }),
  );
  await assert.rejects(adapter.screenshot());
  assert.deepEqual(f.effects, expected);
  await adapter.close();
  assert.equal(f.files.size, 0);
  checks += 1;
}
{
  const f = fixture();
  const adapter = await E2BComputer.fromStartedDesktop(f.sandbox);
  await adapter.screenshot();
  const toolset = new ComputerToolset(adapter);
  await assert.rejects(
    toolset.execute(call({ type: 'click', x: 1, y: 2, button: 'left' }), {
      beforeAction: () => true,
      signal: AbortSignal.abort(),
    }),
  );
  assert.deepEqual(f.effects, []);
  await toolset.execute(call({ type: 'click', x: 1, y: 2, button: 'left' }), { beforeAction: () => true });
  assert.deepEqual(f.effects, ['move', 'left']);
  await adapter.close();
  checks += 1;
}
{
  const f = fixture();
  const stop = new AbortController();
  let advancedAfterStop = false;
  let streamClosed = false;
  f.sandbox.files.read = async function* read() {
    try {
      yield png.subarray(0, 16);
      stop.abort(new Error('fixture Stop'));
      yield png.subarray(16);
      advancedAfterStop = true;
    } finally {
      streamClosed = true;
    }
  };
  const adapter = await E2BComputer.fromStartedDesktop(f.sandbox);
  await assert.rejects(adapter.screenshot({ signal: stop.signal }), /Stop/u);
  assert.equal(advancedAfterStop, false, 'Stop must interrupt a stream that keeps yielding');
  assert.equal(streamClosed, true);
  assert.equal(f.files.size, 0);
  await adapter.close();
  checks += 1;
}
{
  const f = fixture();
  const stop = new AbortController();
  const entered = deferred();
  let streamController;
  let aborted = false;
  f.sandbox.files.read = async (_path, options) =>
    new ReadableStream({
      start(controller) {
        streamController = controller;
        options.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            controller.error(options.signal.reason);
          },
          { once: true },
        );
        entered.release();
      },
    });
  const adapter = await E2BComputer.fromStartedDesktop(f.sandbox);
  const outcome = (async () => {
    try {
      await adapter.screenshot({ signal: stop.signal });
      return null;
    } catch (error) {
      return error;
    }
  })();
  let prompt;
  try {
    await entered.promise;
    stop.abort(new Error('fixture Stop'));
    prompt = await Promise.race([outcome.then(() => true), delay(250).then(() => false)]);
  } finally {
    if (!aborted) {
      streamController.close();
    }
  }
  const error = await outcome;
  assert.match(error?.message, /Stop/u);
  assert.equal(prompt, true, 'The provider signal must interrupt a pending stream read');
  assert.equal(f.files.size, 0);
  await adapter.close();
  checks += 1;
}
process.stdout.write(`${JSON.stringify({ checks, api_calls: 0, vendor_calls: 0 })}\n`);
