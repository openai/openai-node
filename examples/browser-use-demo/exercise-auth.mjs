// Exercise public and owner-launched pages on the actual loopback server. No SDK requests.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

if (typeof process.getuid === 'function') {
  const temporary = await mkdtemp(path.join(tmpdir(), 'demo-key-file-'));
  const fifo = path.join(temporary, 'key');
  const execute = promisify(execFile);
  try {
    await execute('mkfifo', ['-m', '600', fifo]);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('OPENAI_')),
    );
    await assert.rejects(
      execute(process.execPath, [fileURLToPath(new URL('server.mjs', import.meta.url)), '--key-file', fifo], {
        env,
        timeout: 3000,
      }),
      (error) => {
        assert.equal(error.killed, false, 'A special key file must be rejected without waiting for a writer');
        assert.equal(error.signal, null);
        assert.equal(error.code, 1);
        assert.match(error.stderr, /owner-only regular file/u);
        return true;
      },
    );
    console.log('PASS key-file startup rejects an owner-only FIFO without blocking');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const app = await createDemoServer({ port: 0 });
const browser = await chromium.launch({ headless: true });
const token = new URL(app.launchUrl).hash.slice('#token='.length);
try {
  await Promise.all(
    ['/', '/traces'].map(async (route) => {
      const response = await fetch(app.origin + route);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(!html.includes(token), 'Public pages cannot grant control or expose traces.');
    }),
  );
  await Promise.all(
    ['/api/state', '/api/traces', '/api/frame', '/api/export'].map(async (route) => {
      const response = await fetch(app.origin + route);
      assert.equal(response.status, 403, 'Anonymous read refused.');
    }),
  );
  await Promise.all(
    ['/api/start', '/api/stop', '/api/approval', '/api/input'].map(async (route) => {
      const response = await fetch(app.origin + route, {
        method: 'POST',
        headers: { Origin: app.origin, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 403, 'Anonymous action refused.');
    }),
  );
  const anonymous = await browser.newPage();
  let anonymousAPI = 0;
  anonymous.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      anonymousAPI += 1;
    }
  });
  await anonymous.goto(app.origin);
  await anonymous.locator('#message').getByText('Open the private link', { exact: false }).waitFor();
  assert.equal(await anonymous.locator('#start').isDisabled(), true);
  await anonymous.goto(`${app.origin}/traces`);
  await anonymous.locator('#status').getByText('Open the private link', { exact: false }).waitFor();
  assert.equal(await anonymous.locator('#reload').isDisabled(), true);
  assert.equal(anonymousAPI, 0, 'Public pages must not poll private endpoints.');
  await anonymous.close();

  const owner = await browser.newPage();
  let privateState = 0;
  const leaks = [];
  owner.on('request', (request) => {
    // Keep only a boolean leak report; never put a token into failure logs.
    if (request.url().includes(token) || (request.headers().referer || '').includes(token)) {
      leaks.push(true);
    }
    if (new URL(request.url()).pathname === '/api/state' && request.headers()['x-demo-token'] === token) {
      privateState += 1;
    }
  });
  await owner.goto(app.launchUrl);
  await owner.waitForFunction(() =>
    document.querySelector('#availability').textContent.includes('rehearsal'),
  );
  assert.equal(owner.url(), `${app.origin}/`, 'Remove private fragment immediately from browser history.');
  assert.ok(privateState > 0, 'Owner uses control header.');
  await owner.getByText('Usage and diagnostics', { exact: true }).click();
  await owner.getByRole('link', { name: 'Open saved trace viewer (view only)' }).click();
  await owner.waitForFunction(() => document.querySelector('#status').textContent.includes('No capture'));
  assert.equal(owner.url(), `${app.origin}/traces`);
  await owner.getByRole('link', { name: 'Return to live dashboard' }).click();
  await owner.waitForFunction(() =>
    document.querySelector('#availability').textContent.includes('rehearsal'),
  );
  assert.equal(owner.url(), `${app.origin}/`);
  await owner.reload();
  await owner.locator('#message').getByText('Open the private link', { exact: false }).waitFor();
  assert.equal(await owner.locator('#start').isDisabled(), true);
  await owner.goto(app.launchUrl);
  await owner.waitForFunction(() =>
    document.querySelector('#availability').textContent.includes('rehearsal'),
  );
  assert.equal(owner.url(), `${app.origin}/`);
  assert.equal(await owner.locator('#start').isDisabled(), false);
  assert.deepEqual(leaks, [], 'No credential in network URLs or Referer.');
  await owner.close();
  console.log(
    'PASS public/help, private bootstrap, in-memory navigation, reload and no bearer in network URLs/referrers.',
  );
} finally {
  await browser.close();
  await app.close();
}
