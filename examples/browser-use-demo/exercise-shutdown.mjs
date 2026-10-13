// Exercise the actual CLI with a real isolated Chromium and one held owned cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

async function deadline() {
  await delay(15_000, undefined, { ref: false });
  throw new Error('CLI test deadline expired.');
}

const within = (promise) => Promise.race([promise, deadline()]);

if (process.env['DEMO_SHUTDOWN_EXERCISE'] === 'child') {
  // The CLI intentionally prints its private link only to a terminal. Keep it in this test process.
  Object.defineProperty(process.stdout, 'isTTY', { value: true });
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (options) => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (settings) => {
      const context = await newContext(settings);
      const close = context.close.bind(context);
      context.close = async () => {
        console.log('SHUTDOWN_PENDING');
        await delay(800);
        await close();
        console.log('SHUTDOWN_CONTEXT_CLOSED');
      };
      return context;
    };
    return browser;
  };
} else {
  // oxlint-disable no-await-in-loop -- Each process owns one signal sequence and browser.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(
      process.execPath,
      ['--import', import.meta.url, fileURLToPath(new URL('server.mjs', import.meta.url))],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DEMO_SHUTDOWN_EXERCISE: 'child', DEMO_PORT: '0', OPENAI_API_KEY: '' },
      },
    );
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    let closed = false;
    const ready = once(lines, 'cliReady');
    const draining = once(lines, 'cliDraining');
    lines.on('line', (line) => {
      if (line.startsWith('Browser-use example (private link): ')) {
        lines.emit('cliReady', new URL(line.slice('Browser-use example (private link): '.length)));
      } else if (line === 'SHUTDOWN_PENDING') {
        lines.emit('cliDraining');
      } else if (line === 'SHUTDOWN_CONTEXT_CLOSED') {
        closed = true;
      }
    });
    child.stderr.resume();
    try {
      const [link] = await within(ready);
      const headers = { 'X-Demo-Token': link.hash.slice('#token='.length), Origin: link.origin };
      const started = await fetch(`${link.origin}/api/start`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'invoices', api: 'decisions', mode: 'rehearsal' }),
      });
      assert.equal(started.status, 200);
      const waitUntil = performance.now() + 15_000;
      let state;
      while (performance.now() < waitUntil) {
        state = await fetch(`${link.origin}/api/state`, { headers }).then((response) => response.json());
        if (state.run?.approval) {
          break;
        }
        await delay(25);
      }
      assert.ok(state?.run?.approval, 'The CLI must own a live browser before shutdown.');
      child.kill(signal);
      await within(draining);
      child.kill(signal);
      assert.equal(await Promise.race([exited.then(() => 'exited'), delay(100, 'pending')]), 'pending');
      const [code, exitSignal] = await within(exited);
      assert.equal(exitSignal, null);
      assert.equal(code, 0);
      assert.equal(closed, true, 'CLI must complete its admitted context cleanup.');
      console.log(`PASS ${signal}: repeated signal drains the owned browser before CLI exit`);
    } finally {
      lines.close();
      // Only the child created by this case is eligible for cleanup.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await within(exited);
      }
    }
  }
  // oxlint-enable no-await-in-loop
}
