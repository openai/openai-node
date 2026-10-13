// Controlled guest and API, real server/SDK/private files. This does not prove native input.
import assert from 'node:assert/strict';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { ComputerToolset } from 'openai/helpers/computer';
import { createDemoServer } from './server.mjs';

const unexpectedAction = () => assert.fail('The held response cannot authorize a computer action');

async function check(failedCleanup, deadline = false) {
  const originalCreate = Desktop.create;
  const originalFetch = globalThis.fetch;
  const originalBaseURL = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  const before = new Set(await readdir(tmpdir()));
  const entered = Promise.withResolvers();
  const pending = Promise.withResolvers();
  let stopped = false;
  let app;
  let directory;
  let retained;
  const computer = new ComputerToolset({
    click: unexpectedAction,
    double_click: unexpectedAction,
    drag: unexpectedAction,
    keypress: unexpectedAction,
    move: unexpectedAction,
    scroll: unexpectedAction,
    type: unexpectedAction,
    wait: unexpectedAction,
    screenshot: async () => ({ type: 'computer_screenshot', image_url: 'data:image/png;base64,cGl4ZWxz' }),
  });
  Desktop.create = async () => ({
    id: 'controlled-shutdown',
    captureFrame: async () => ({ frame: Buffer.from('controlled pixels'), width: 1024, height: 768 }),
    verify: async () => ({ file_matches: false, browser_matches: false }),
    withComputer: (work, { signal }) => work(computer, signal),
    async stop() {
      stopped = true;
    },
  });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname === '127.0.0.1') {
      return originalFetch(request);
    }
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    entered.resolve();
    await pending.promise;
    return Response.json({
      id: 'resp_controlled',
      object: 'response',
      status: 'completed',
      model: '',
      output: [
        {
          type: 'message',
          id: 'msg_controlled',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Controlled final', annotations: [] }],
        },
      ],
    });
  };
  try {
    app = await createDemoServer({
      port: 0,
      apiKey: 'synthetic',
      models: { responses: 'synthetic' },
      desktopRuntime: 'controlled-factory-only',
    });
    const page = await originalFetch(app.origin);
    const html = await page.text();
    const token = new URL(app.launchUrl).hash.slice('#token='.length);
    assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
    const call = async (route, body) => {
      const reply = await originalFetch(`${app.origin}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Demo-Token': token,
          Origin: app.origin,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(reply.status, 200);
      return reply.json();
    };
    const run = await call('/api/start', {
      environment: 'desktop',
      taskId: 'desktop',
      api: 'responses',
      mode: 'live',
    });
    await Promise.race([
      entered.promise,
      delay(5000).then(() => assert.fail('The real SDK did not reach the controlled Responses request.')),
    ]);
    const entries = await readdir(tmpdir());
    const created = entries.filter((name) => name.startsWith('desktop-evidence-') && !before.has(name));
    assert.equal(created.length, 1);
    directory = path.join(tmpdir(), created[0]);
    if (failedCleanup) {
      retained = `${directory}-retained`;
      await rename(directory, retained);
      await mkdir(directory, { mode: 0o700 });
    }
    await call('/api/stop', { runId: run.id });
    await delay(20);
    assert.equal(stopped, true, 'Stop retires the controlled guest before the held API returns.');
    const waiting = await call(`/api/export?run=${run.id}`);
    assert.equal(waiting.cleanup, 'pending');
    if (deadline) {
      const began = performance.now();
      await assert.rejects(
        app.close(),
        (error) =>
          error instanceof Error &&
          error.message.startsWith('Workspace cleanup did not finish. Private evidence retained: ') &&
          error.message.includes(directory),
      );
      assert.ok(performance.now() - began >= 34_000, 'The outer shutdown must allow its bounded drain.');
      assert.deepEqual(await readdir(directory), ['checkpoint.json']);
      pending.resolve();
      let removed = false;
      for (let count = 0; count < 100; count += 1) {
        // The late runner may now close its retained private ledger.
        // oxlint-disable-next-line no-await-in-loop
        removed = await readdir(directory).then(
          () => false,
          (error) => error.code === 'ENOENT',
        );
        if (removed) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await delay(10);
      }
      assert.equal(removed, true);
      directory = undefined;
    } else if (failedCleanup) {
      pending.resolve();
      let receipt;
      for (let count = 0; count < 100; count += 1) {
        // Wait for the actual inode-protected ledger close to refuse this replaced directory.
        // oxlint-disable-next-line no-await-in-loop
        receipt = await call(`/api/export?run=${run.id}`);
        if (receipt.cleanup === 'failed') {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await delay(10);
      }
      assert.equal(receipt.cleanup, 'failed');
      assert.equal(JSON.stringify(receipt).includes(directory), false);
      await assert.rejects(
        app.close(),
        (error) =>
          error instanceof AggregateError && error.errors.some((item) => item.message.includes(directory)),
      );
    } else {
      const closing = app.close();
      assert.equal(app.close(), closing);
      const held = Symbol('still waiting');
      assert.equal(await Promise.race([closing, delay(50, held)]), held);
      pending.resolve();
      await closing;
      await assert.rejects(readdir(directory), { code: 'ENOENT' });
      directory = undefined;
    }
    app = undefined;
    let outcome = 'waits for the held API and private ledger before completion';
    if (deadline) {
      outcome = 'reports its deadline and retained checkpoint before late cleanup';
    } else if (failedCleanup) {
      outcome = 'reports retained private evidence after a real ownership failure';
    }
    console.log(`PASS whole-run shutdown ${outcome}`);
  } finally {
    pending.resolve();
    try {
      await app?.close();
    } finally {
      Desktop.create = originalCreate;
      globalThis.fetch = originalFetch;
      if (originalBaseURL === undefined) {
        delete process.env.OPENAI_BASE_URL;
      } else {
        process.env.OPENAI_BASE_URL = originalBaseURL;
      }
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
      if (retained) {
        await rm(retained, { recursive: true, force: true });
      }
    }
  }
}

await check(false);
await check(true);
await check(false, true);
