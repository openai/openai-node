import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createDemoServer } from './server.mjs';

const first = await createDemoServer();
const oldOrigin = first.origin;
await first.close();
const prior = createServer((request, response) => {
  if (request.url === '/worker.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(`
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', event => event.waitUntil(clients.claim()));
      self.addEventListener('fetch', event => {
        if (event.request.mode === 'navigate') {
          event.respondWith(new Response('<h1>Earlier local site</h1>', {
            headers: { 'Content-Type': 'text/html' }
          }));
        }
      });
    `);
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>Local worker fixture</h1>');
  }
});
prior.listen(Number(new URL(oldOrigin).port), '127.0.0.1');
await once(prior, 'listening');
const browser = await chromium.launch({ headless: true });
let app;
try {
  const previous = await browser.newContext();
  const page = await previous.newPage();
  await page.goto(oldOrigin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/worker.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Earlier local site' }).waitFor();

  app = await createDemoServer();
  assert.notEqual(app.origin, oldOrigin);
  await page.goto(app.launchUrl);
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
  assert.notEqual(await page.locator('h1').textContent(), 'Earlier local site');

  const fresh = await browser.newContext();
  const clean = await fresh.newPage();
  await clean.goto(app.launchUrl);
  assert.equal(await clean.evaluate(() => navigator.serviceWorker.controller), null);
  await fresh.close();
  await previous.close();
  console.log(
    'PASS default dashboard avoids the occupied previous origin; a fresh operator profile has no saved worker',
  );
} finally {
  await app?.close();
  await browser.close();
  await promisify(prior.close.bind(prior))();
}
