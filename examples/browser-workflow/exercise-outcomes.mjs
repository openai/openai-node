import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { main, openWorkflow, serve } from './workflow.mjs';

const mode = process.argv[2] ?? 'pixels';
assert.ok(['pixels', 'identifiers', 'browser-loss', 'operator-stop'].includes(mode));
if (mode === 'identifiers') {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-ids-'));
  const fixturePath = path.join(directory, 'fixtures.json');
  const original = JSON.parse(await readFile(new URL('assets/fixtures.json', import.meta.url), 'utf-8')).A;
  const accepted = [];
  try {
    for (const [name, fragment] of [
      ['NUL', '\0'],
      ['CR', '\r'],
      ['surrogate', '\uD800'],
    ]) {
      for (const field of ['requests', 'slots']) {
        const fixture = structuredClone(original);
        fixture[field][0].id = `id-${fragment}-end`;
        if (field === 'requests') {
          fixture.requestId = fixture.requests[0].id;
        }
        // oxlint-disable-next-line no-await-in-loop
        await writeFile(fixturePath, JSON.stringify({ C: fixture }));
        try {
          // oxlint-disable-next-line no-await-in-loop
          const invalid = await serve(fixturePath);
          accepted.push(`${field}:${name}`);
          // oxlint-disable-next-line no-await-in-loop
          await invalid.close();
        } catch (error) {
          assert.match(error.message, new RegExp(`^${field}\\[0\\]\\.id is invalid`, 'u'));
        }
      }
    }
    await writeFile(fixturePath, JSON.stringify({ 'C-\uD800': original }));
    try {
      const invalid = await serve(fixturePath);
      accepted.push('fixture:surrogate');
      await invalid.close();
    } catch (error) {
      assert.match(error.message, /^Fixture IDs must be nonempty strings/u);
    }
    const fixture = structuredClone(original);
    const variant = 'C\u0000\r " & Ω 🌕 !\'()* /';
    const requestId = 'REQ " & Ω 🌕\nline';
    const slotId = 'ROOM " & Ω 🌕\nline';
    fixture.requestId = requestId;
    fixture.requests[0].id = requestId;
    fixture.slots[1].id = slotId;
    await writeFile(fixturePath, JSON.stringify({ [variant]: fixture }));
    const server = await serve(fixturePath);
    try {
      const current = await openWorkflow(server, variant, { confirm: async () => true });
      try {
        const request = current.page.locator('[data-request]').first();
        assert.equal(await request.getAttribute('data-request'), requestId);
        await request.click();
        const slot = current.page.locator('[data-slot]').nth(1);
        assert.equal(await slot.getAttribute('data-slot'), slotId);
        assert.equal(
          await current.page.evaluate(
            (id) => JSON.parse(localStorage.getItem(`workflow.${id}.selected`)),
            variant,
          ),
          requestId,
        );
        await slot.click();
        await current.page.locator('[data-route="dispatch"]').click();
        const send = current.page.locator('[data-send]');
        assert.equal(await send.getAttribute('data-send'), requestId);
        await send.click();
        const stored = await current.stored();
        assert.equal(stored.bookings[requestId].slot, slotId);
        assert.equal(stored.correspondence[requestId].request, requestId);
        assert.equal(await current.verify(), true);
        await current.page.reload();
        assert.equal(await current.verify(), true);
        console.log('PASS LF, Unicode, quote and ampersand IDs select, book, send and verify after reload');
      } finally {
        await current.close();
      }
    } finally {
      await server.close();
    }
    assert.deepEqual(accepted, [], 'These IDs must fail before the fixture server opens');
    console.log(
      'PASS 6 request/slot IDs and 1 fixture ID rejected before serving; URL-safe fixture IDs round-trip',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else if (mode === 'pixels') {
  const server = await serve();
  let workflow;
  try {
    workflow = await openWorkflow(server, 'A', { confirm: async () => true });
    for (const route of ['/inbox', '/schedule', '/dispatch']) {
      // Each screenshot follows navigation to one reviewed synthetic page.
      // oxlint-disable-next-line no-await-in-loop
      const navigated = await workflow.execute('navigate', {
        tab_id: null,
        url: `${server.origin}${route}?fixture=A`,
      });
      assert.equal(navigated.ok, true);
      // oxlint-disable-next-line no-await-in-loop
      const image = await workflow.driver.screenshot({ tab_id: null });
      assert.equal(image.type, 'input_image');
      assert.match(image.image_url, /^data:image\/png;base64,/u);
      assert.ok(image.image_url.length > 100);
    }
    console.log('PASS screenshots work on all three reviewed workflow pages');
  } finally {
    await workflow?.close();
    await server.close();
  }
} else {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-outcome-'));
  const originalLaunch = chromium.launch;
  const originalFetch = globalThis.fetch;
  const previousExitCode = process.exitCode;
  const names = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  let browser;
  let requests = 0;
  chromium.launch = async function launch(options) {
    browser = await originalLaunch.call(this, options);
    return browser;
  };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, 'https://api.openai.com');
    requests += 1;
    if (mode === 'browser-loss') {
      await browser.close();
    } else {
      process.emit('SIGINT');
    }
    return Response.json({
      id: 'synthetic',
      object: 'response',
      status: 'completed',
      output: [{ id: 'message', type: 'message', role: 'assistant', status: 'completed', content: [] }],
    });
  };
  Object.assign(process.env, {
    OPENAI_API_KEY: 'synthetic-no-network',
    OPENAI_MODEL: 'synthetic',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
  });
  try {
    const receipt = path.join(directory, 'receipt.json');
    await main({ values: { mode: 'run', fixture: 'A', api: 'responses', receipt } });
    const saved = JSON.parse(await readFile(receipt, 'utf-8'));
    assert.equal(saved.status, mode === 'browser-loss' ? 'failed' : 'stopped');
    if (mode === 'operator-stop') {
      assert.deepEqual(saved.stored, { bookings: {}, correspondence: {} });
    }
    assert.equal(saved.cleanup, true);
    assert.equal(requests, 1);
    console.log(`PASS ${mode} has the correct CLI receipt and cleanup`);
  } finally {
    await browser?.close();
    chromium.launch = originalLaunch;
    globalThis.fetch = originalFetch;
    process.exitCode = previousExitCode;
    for (const name of names) {
      if (previous[name] === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = previous[name];
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}
