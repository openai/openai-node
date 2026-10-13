// Optional local request proof. Run [basic|chain|popup|redirects|origin|all]; default all. No SDK API calls.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createBrowserDriver } from './driver.mjs';

const allowedHits = [];
const deniedHits = [];
const checks = [];
const contractHits = [];
const scenario = process.argv[2] ?? 'all';
assert.ok(
  ['basic', 'chain', 'popup', 'redirects', 'origin', 'all'].includes(scenario),
  'Use basic, chain, popup, redirects, origin or all',
);
const denied = createServer((request, response) => {
  deniedHits.push(request.url);
  response.writeHead(200, { 'content-type': 'text/html' }).end('Denied counter control');
});
denied.on('upgrade', (request, socket) => {
  deniedHits.push(`upgrade:${request.url}`);
  socket.destroy();
});
denied.listen(0, '127.0.0.1');
await once(denied, 'listening');
const deniedOrigin = `http://127.0.0.1:${denied.address().port}`;
const permitted = createServer((request, response) => {
  allowedHits.push(request.url);
  const path = request.url;
  if (path.startsWith('/contract/')) {
    const chunks = [];
    request.on('data', (part) => chunks.push(part));
    request.on('end', () => {
      contractHits.push({ path, method: request.method, body: Buffer.concat(chunks).toString() });
      const redirect = path.match(/^\/contract\/status\/(?<code>301|302|303|307|308)$/u);
      if (redirect) {
        response.writeHead(Number(redirect.groups.code), { Location: '../target?scope=exact' }).end();
      } else if (path === '/contract/cross') {
        response
          .writeHead(302, { Location: `http://localhost:${permitted.address().port}/contract/remote` })
          .end();
      } else if (path === '/contract/cache') {
        response.writeHead(304, { Location: `${deniedOrigin}/unused-304-location` }).end();
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' }).end('fixture contract body');
      }
    });
  } else if (path === '/chain') {
    response.writeHead(302, { Location: '/hop' }).end();
  } else if (path === '/hop') {
    response.writeHead(307, { Location: `${deniedOrigin}/end` }).end();
  } else if (path === '/good-chain') {
    response.writeHead(302, { Location: '/positive' }).end();
  } else if (path === '/script.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end('window.fixtureScript = 1');
  } else if (path === '/image.gif') {
    response
      .writeHead(200, { 'content-type': 'image/gif' })
      .end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
  } else if (path === '/sw.js') {
    response
      .writeHead(200, { 'content-type': 'text/javascript' })
      .end('self.addEventListener("fetch", () => {})');
  } else if (path === '/hold') {
    // Canceled by closing the disposable context. Do not claim it as policy refusal.
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('pending');
  } else {
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>Local request fixture</title><body>Permitted fixture</body>');
  }
});
permitted.on('upgrade', (request, socket) => {
  allowedHits.push(`upgrade:${request.url}`);
  socket.destroy();
});
permitted.listen(0, '127.0.0.1');
await once(permitted, 'listening');
const origin = `http://127.0.0.1:${permitted.address().port}`;
const alternate = `http://localhost:${permitted.address().port}`;
const paths = [
  '/fixture',
  '/positive',
  '/good-chain',
  '/chain',
  '/hop',
  '/image.gif',
  '/script.js',
  '/sw.js',
  '/hold',
  '/contract/target?scope=exact',
  '/contract/cross',
  '/contract/cache',
  ...[301, 302, 303, 307, 308].map((code) => `/contract/status/${code}`),
];
const urls = [...paths.map((path) => origin + path), `${alternate}/positive`, `${alternate}/contract/remote`];
let browser;
const deadline = setTimeout(() => {
  console.error('Network exercise exceeded 35 seconds.');
  void browser?.close();
  denied.closeAllConnections();
  permitted.closeAllConnections();
}, 35_000);
deadline.unref();

async function waitHit(hits, target) {
  const until = Date.now() + 2400;
  while (!hits.includes(target) && Date.now() < until) {
    // The oracle waits for a real request before advancing, within this deadline.
    // oxlint-disable-next-line no-await-in-loop
    await delay(10);
  }
  assert.ok(hits.includes(target), `Missing positive server evidence for ${target}`);
}
try {
  browser = await chromium.launch({
    headless: true,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    },
  });
  // Prove the denied counter is live, before measuring a guarded context.
  const unguarded = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await unguarded.newPage();
    await page.goto(`${deniedOrigin}/counter-control`, { timeout: 3000 });
    assert.deepEqual(deniedHits, ['/counter-control']);
  } finally {
    await unguarded.close();
  }
  deniedHits.length = 0;
  checks.push('independent denied counter receives unguarded positive control');
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  try {
    const driver = createBrowserDriver(context, { ownedFixture: { urls } });
    const first = await driver.new_tab({ url: `${origin}/fixture` });
    const [page] = context.pages();
    page.setDefaultTimeout(2800);
    await page.evaluate(() => {
      localStorage.setItem('only_this_run', 'present');
    });
    await context.addCookies([{ name: 'only_this_run', value: 'present', url: origin }]);
    await driver.navigate({ tab_id: first, url: `${origin}/positive` });
    assert.equal(page.url(), `${origin}/positive`);
    await waitHit(allowedHits, '/positive');
    checks.push('direct allowed navigation reaches independent route');
    await driver.navigate({ tab_id: first, url: `${origin}/fixture` });
    const results = await page.evaluate(
      async ({ origin: allowed, alternate: cross, deniedOrigin: blocked }) => {
        // Serialized in the browser realm; this cannot capture a Node helper.
        // oxlint-disable-next-line consistent-function-scoping
        const resource = (tag, src) =>
          // Only a real DOM event proves whether Chromium loaded the resource.
          // oxlint-disable-next-line promise/avoid-new
          new Promise((resolve) => {
            const node = document.createElement(tag);
            const done = (event) => resolve(event.type);
            node.addEventListener('load', done, { once: true });
            node.addEventListener('error', done, { once: true });
            node.src = src;
            document.body.append(node);
          });
        // oxlint-disable-next-line consistent-function-scoping
        const fetchText = async (url) => {
          try {
            const response = await fetch(url);
            return { ok: response.ok };
          } catch {
            return { ok: false };
          }
        };
        const result = {
          allowedImage: await resource('img', `${allowed}/image.gif`),
          deniedImage: await resource('img', `${blocked}/image.gif`),
          allowedScript: await resource('script', `${allowed}/script.js`),
          deniedScript: await resource('script', `${blocked}/script.js`),
          scriptRan: window.fixtureScript,
          allowedFetch: await fetchText(`${allowed}/positive`),
          deniedFetch: await fetchText(`${blocked}/fetch`),
          sameFrame: await resource('iframe', `${allowed}/positive`),
          crossFrame: await resource('iframe', `${cross}/positive`),
          deniedFrame: await resource('iframe', `${blocked}/child`),
        };
        const child = [...document.querySelectorAll('iframe')].find(
          (node) => node.src === `${cross}/positive`,
        );
        try {
          result.parentReadsChild = !!child.contentWindow.document;
        } catch {
          result.parentReadsChild = false;
        }
        // Serialized in Chromium along with the page's real WebSocket constructor.
        // oxlint-disable-next-line consistent-function-scoping
        const socket = (url) =>
          // Wait for native connect/error/close, not a timer assumption.
          // oxlint-disable-next-line promise/avoid-new
          new Promise((resolve) => {
            const ws = new WebSocket(url);
            ws.addEventListener(
              'open',
              () => {
                ws.close();
                resolve('open');
              },
              { once: true },
            );
            ws.addEventListener('error', () => resolve('error'), { once: true });
            ws.addEventListener('close', () => resolve('close'), { once: true });
          });
        result.allowedSocket = await socket(`${allowed.replace('http:', 'ws:')}/socket`);
        result.deniedSocket = await socket(`${blocked.replace('http:', 'ws:')}/socket`);
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          result.worker = registration ? 'registered' : 'blocked';
        } catch {
          result.worker = 'blocked';
        }
        return result;
      },
      { origin, alternate, deniedOrigin },
    );
    assert.equal(results.allowedImage, 'load');
    assert.equal(results.allowedScript, 'load');
    assert.equal(results.scriptRan, 1);
    assert.deepEqual(results.allowedFetch, { ok: true });
    assert.equal(results.sameFrame, 'load');
    assert.equal(results.crossFrame, 'load');
    assert.equal(results.parentReadsChild, false);
    assert.ok(page.frames().some((frame) => frame.url() === `${alternate}/positive`));
    assert.equal(results.deniedImage, 'error');
    assert.equal(results.deniedScript, 'error');
    assert.deepEqual(results.deniedFetch, { ok: false });
    assert.notEqual(results.allowedSocket, 'open');
    assert.notEqual(results.deniedSocket, 'open');
    assert.equal(results.worker, 'blocked');
    assert.equal(allowedHits.includes('/sw.js'), false);
    assert.equal(
      allowedHits.some((hit) => hit.startsWith('upgrade:')),
      false,
    );
    assert.deepEqual(deniedHits, []);
    checks.push(
      'image script fetch same-origin/allowed-cross-origin frames positive; denied origin never reached',
      'WebSockets denied on both origins; worker registration blocked before script request',
    );
    // Start a real allowed request, then revoke its context while the body is open.
    const pending = (async () => {
      try {
        return await page.evaluate(async () => {
          const response = await fetch('/hold');
          return await response.text();
        });
      } catch {
        return 'closed';
      }
    })();
    await waitHit(allowedHits, '/hold');
    await context.close();
    assert.equal(await pending, 'closed');
    assert.deepEqual(deniedHits, []);
    checks.push('close cancels admitted allowed request; no policy-success inference');
  } finally {
    await context.close();
  }
  const next = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  try {
    const driver = createBrowserDriver(next, { ownedFixture: { urls } });
    const tab = await driver.new_tab({ url: `${origin}/fixture` });
    const [page] = next.pages();
    const current = await page.evaluate(() => ({
      saved: localStorage.getItem('only_this_run'),
      controlled: !!navigator.serviceWorker.controller,
    }));
    assert.deepEqual(current, { saved: null, controlled: false });
    assert.deepEqual(await next.cookies(), []);
    assert.deepEqual(deniedHits, []);
    checks.push('fresh disposable session has no previous cookies, local storage or worker control');
    const fetchFixture = (path, options = {}) =>
      page.evaluate(
        async ({ path: fixturePath, options: requestOptions }) => {
          try {
            const response = await fetch(fixturePath, requestOptions);
            return { status: response.status, text: await response.text() };
          } catch {
            return { status: 0, text: '' };
          }
        },
        { path, options },
      );
    if (scenario === 'redirects' || scenario === 'all') {
      for (const method of ['GET', 'HEAD', 'POST']) {
        contractHits.length = 0;
        const options = method === 'POST' ? { method, body: 'fixture payload' } : { method };
        // oxlint-disable-next-line no-await-in-loop
        const direct = await fetchFixture('/contract/target?scope=exact', options);
        assert.deepEqual(direct, { status: 200, text: method === 'HEAD' ? '' : 'fixture contract body' });
        assert.deepEqual(contractHits, [
          { path: '/contract/target?scope=exact', method, body: method === 'POST' ? 'fixture payload' : '' },
        ]);
        for (const code of [301, 302, 303, 307, 308]) {
          contractHits.length = 0;
          // oxlint-disable-next-line no-await-in-loop
          const result = await fetchFixture(`/contract/status/${code}`, options);
          console.log(JSON.stringify({ code, method, result, contractHits }));
          assert.deepEqual(
            contractHits,
            [{ path: `/contract/status/${code}`, method, body: method === 'POST' ? 'fixture payload' : '' }],
            'A redirect fetched or replayed an allowed target',
          );
          assert.deepEqual(result, { status: 0, text: '' });
        }
      }
      contractHits.length = 0;
      const cache = await fetchFixture('/contract/cache', { headers: { 'If-None-Match': 'fixture' } });
      assert.deepEqual(cache, { status: 304, text: '' });
      assert.deepEqual(contractHits, [{ path: '/contract/cache', method: 'GET', body: '' }]);
      assert.deepEqual(deniedHits, []);
      checks.push(
        'direct GET/HEAD/POST and 304; all actual redirects stop after the first effect with no retry',
      );
    }
    if (scenario === 'origin' || scenario === 'all') {
      const initial = await driver.state();
      const prior = initial.observation.sequence;
      const direct = await page.evaluate(
        async (url) =>
          // oxlint-disable-next-line promise/avoid-new
          await new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.addEventListener(
              'load',
              () => {
                try {
                  resolve({ loaded: true, readable: !!iframe.contentWindow.document });
                } catch {
                  resolve({ loaded: true, readable: false });
                }
              },
              { once: true },
            );
            iframe.addEventListener('error', () => resolve({ loaded: false, readable: false }), {
              once: true,
            });
            iframe.src = url;
            document.body.append(iframe);
          }),
        `${alternate}/contract/remote`,
      );
      assert.deepEqual(direct, { loaded: true, readable: false });
      assert.ok(page.frames().some((frame) => frame.url() === `${alternate}/contract/remote`));
      contractHits.length = 0;
      // A navigation, unlike a failed CORS fetch, proves refusal before an allowlisted target.
      await page.evaluate(
        async (url) =>
          // oxlint-disable-next-line promise/avoid-new
          await new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.addEventListener('load', () => resolve('load'), { once: true });
            iframe.addEventListener('error', () => resolve('error'), { once: true });
            iframe.src = url;
            document.body.append(iframe);
          }),
        `${origin}/contract/cross`,
      );
      console.log(JSON.stringify({ originNavigation: contractHits }));
      assert.deepEqual(
        contractHits,
        [{ path: '/contract/cross', method: 'GET', body: '' }],
        'Changed-origin navigation fetched a target',
      );
      const reported = await driver.state();
      assert.equal(
        reported.observation.changes.some(
          (change) => change.sequence > prior && change.type === 'navigation_refused',
        ),
        false,
        'Allowed unsupported redirect was mislabeled as a URL-policy refusal',
      );
      checks.push(
        'native remote origin remains isolated, redirect navigation refuses without a policy event',
      );
    }
    if (scenario === 'popup' || scenario === 'all') {
      const popup = page.waitForEvent('popup', { timeout: 2800 });
      await page.evaluate((url) => window.open(url), `${deniedOrigin}/popup`);
      const opened = await popup;
      try {
        await opened.waitForLoadState('domcontentloaded', { timeout: 2800 });
      } catch (error) {
        assert.ok(error instanceof Error);
      }
      assert.deepEqual(deniedHits, []);
      // No valid SDK state can supply this blocked tab's ID. The raw driver's
      // current-tab operations also refuse before returning data or acting.
      await assert.rejects(driver.state(), /outside its installed fixture/u);
      await assert.rejects(driver.read_page({ tab_id: null, filter: 'all' }), /outside this owned fixture/u);
      await assert.rejects(driver.close_tab({ tab_id: null }), /outside this owned fixture/u);
      // The blocked error document is not an installed fixture. Close it before reading owned state.
      await opened.close();
      const state = await driver.state();
      assert.ok(state.observation.changes.some((c) => c.type === 'navigation_refused'));
      assert.ok(state.observation.changes.length <= 32);
      checks.push(
        'blocked popup refuses state and current-tab reads/close; launcher closes it and original state recovers',
      );
    }
    if (scenario === 'chain' || scenario === 'all') {
      try {
        await driver.navigate({ tab_id: tab, url: `${origin}/chain` });
      } catch (error) {
        assert.ok(error instanceof Error);
      }
      await waitHit(allowedHits, '/chain');
      console.log(JSON.stringify({ checksBeforeChain: checks, allowedHits, deniedHits }));
      assert.deepEqual(
        allowedHits.filter((hit) => hit === '/chain' || hit === '/hop'),
        ['/chain'],
      );
      assert.deepEqual(deniedHits, [], 'An allowed redirect hop reached the denied server');
    }
  } finally {
    await next.close();
  }
  console.log(
    JSON.stringify(
      {
        success: true,
        checks,
        allowedHits,
        deniedHits,
        apiRequests: 0,
        notProved: [
          'OS or host-process firewall',
          'WebRTC',
          'DNS and other protocols',
          'hosted provider egress rules',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(deadline);
  await browser?.close();
  denied.closeAllConnections();
  permitted.closeAllConnections();
  await Promise.all([promisify(denied.close).call(denied), promisify(permitted.close).call(permitted)]);
}
