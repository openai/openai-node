import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Browserbase from '@browserbasehq/sdk';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { withBrowserbaseSession, withBorrowedBrowser } from './browserbase-session.mjs';

const rows = [];
const deferred = () => Promise.withResolvers();
const noGate = async () => null;
const server = createServer((_req, res) =>
  res
    .writeHead(200, { 'content-type': 'text/html' })
    .end(
      '<title>Fixture</title><button onclick="this.textContent=\'Changed\'">Apply</button><p>Approved fixture</p>',
    ),
);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'browserbase-session-'));
const persistent = await chromium.launchPersistentContext(profile, {
  headless: true,
  chromiumSandbox: true,
  args: ['--remote-debugging-port=0'],
  env: { PATH: process.env.PATH ?? '', TMPDIR: profile, HOME: profile },
});
const devToolsAddress = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf-8');
const [port] = devToolsAddress.split('\n');
const endpoint = `http://127.0.0.1:${port}`;
const caller = await chromium.connectOverCDP(endpoint);
const sentinel = await caller.newContext();
const witness = await sentinel.newPage();
await witness.setContent('<p>Caller must survive</p>');
function config() {
  return { projectId: 'project-local', allowedOrigins: [origin] };
}
function provider(gate = async () => null, mode = {}) {
  const log = [];
  const current = {
    id: 'session-local',
    projectId: 'project-local',
    status: 'RUNNING',
    connectUrl: endpoint,
    signingKey: 'PRIVATE_SIGNING_SENTINEL',
    seleniumRemoteUrl: 'PRIVATE_SELENIUM_SENTINEL',
  };
  const client = new Browserbase({
    apiKey: 'SYNTHETIC_UNUSED_KEY',
    baseURL: 'http://synthetic.invalid',
    maxRetries: 2,
    fetch: async (url, options) => {
      const { method } = options;
      const body = options.body ? JSON.parse(options.body) : null;
      const resource = new URL(url).pathname;
      log.push({ method, resource, body });
      if (resource === '/v1/sessions') {
        assert.equal(method, 'POST');
        assert.equal(body.timeout, 60);
        assert.equal(body.keepAlive, false);
        assert.equal(body.proxies, false);
        assert.deepEqual(body.browserSettings, {
          recordSession: false,
          logSession: false,
          solveCaptchas: false,
          verified: false,
          advancedStealth: false,
        });
        await gate('create');
        if (mode.createFail) {
          return Response.json({ error: 'PRIVATE_PROVIDER_ERROR' }, { status: 504 });
        }
        return Response.json({ ...current, ...mode.created }, { status: 201 });
      }
      assert.equal(resource, '/v1/sessions/session-local');
      if (method === 'POST') {
        assert.deepEqual(body, { status: 'REQUEST_RELEASE', projectId: 'project-local' });
        await gate('release');
        if (mode.releaseFail) {
          return Response.json({ error: 'PRIVATE_PROVIDER_ERROR' }, { status: 503 });
        }
        if (!mode.stayLive) {
          current.status = 'COMPLETED';
        }
        return Response.json(current);
      }
      await gate('retrieve');
      return Response.json({ ...current, ...mode.readback });
    },
  });
  return { client, log, current };
}
function browserWrapper(browser, gate, counts, owned) {
  return {
    async newContext(opts) {
      assert.equal(opts.serviceWorkers, 'block');
      assert.equal(opts.acceptDownloads, false);
      const context = await browser.newContext(opts);
      counts.newContext += 1;
      await gate('context');
      return {
        routeWebSocket: async (...args) => {
          await context.routeWebSocket(...args);
          counts.ws += 1;
          await gate('ws');
        },
        route: async (...args) => {
          await context.route(...args);
          [, counts.guard] = args;
          counts.http += 1;
          await gate('http');
        },
        close: async () => {
          counts.contextClose += 1;
          if (counts.failClose) {
            throw new Error('PRIVATE_CONTEXT_ERROR');
          }
          await gate('close');
          await context.close();
        },
        on: (...args) => context.on(...args),
        pages: () => context.pages(),
        newPage: () => context.newPage(),
      };
    },
    async close() {
      counts.browserClose += 1;
      assert.ok(owned, 'never close borrowed Browser');
      await browser.close();
    },
  };
}
function toolkit(driver) {
  return new BrowserToolset(driver, {
    urlPolicy: (_, url) => new URL(url).origin === origin,
    confirm: () => true,
  });
}
async function workCheck(driver, signal) {
  const tools = toolkit(driver);
  const names = tools
    .tools()
    .map((t) => t.name.replace(/^.*__/u, '').replace(/^browser_/u, ''))
    .toSorted();
  assert.equal(names.length, 15);
  for (const unavailable of ['scroll_to', 'wait_for', 'zoom']) {
    assert.ok(!names.includes(unavailable));
  }
  const tabTool = tools.tools().find((t) => t.name.endsWith('new_tab'));
  const created = await tools.execute(
    {
      type: 'function_call',
      call_id: 'a',
      name: tabTool.name,
      status: 'completed',
      arguments: JSON.stringify({ url: origin }),
    },
    { signal },
  );
  if (JSON.stringify(created).includes('"ok":false')) {
    throw new Error('new tab failed');
  }
  const state = await driver.state();
  assert.equal(state.tabs.length, 1);
  const text = await driver.get_page_text({ tab_id: state.tabs[0].id });
  assert.match(text, /Approved fixture/u);
  return true;
}
async function run(name, test) {
  await test();
  assert.match(await witness.locator('p').textContent(), /Caller must survive/u);
  rows.push({ name, pass: true });
  console.log(JSON.stringify({ name, pass: true }));
}
try {
  await run('borrowed Stop before deferred context invocation', async () => {
    const stopped = new AbortController();
    let calls = 0;
    let cleanup;
    const pending = withBorrowedBrowser(
      {
        newContext() {
          calls += 1;
          return { close: noGate };
        },
      },
      config(),
      noGate,
      { signal: stopped.signal },
    );
    stopped.abort();
    await assert.rejects(pending, (error) => {
      ({ cleanup } = error);
      return error.name === 'AbortError';
    });
    assert.equal(calls, 0);
    assert.deepEqual(await cleanup.retry(), { status: 'complete' });
  });
  for (const owned of [false, true]) {
    for (const completion of ['resolve', 'reject', 'synchronous Stop']) {
      // oxlint-disable-next-line no-await-in-loop -- Each late context must finish cleanup before the next fixture.
      await run(`${owned ? 'owned' : 'borrowed'} pending context ${completion}`, async () => {
        const entered = deferred();
        const opening = deferred();
        const stopped = new AbortController();
        const p = provider();
        let contextCloses = 0;
        let browserCloses = 0;
        let workCalls = 0;
        const context = {
          close: async () => {
            contextCloses += 1;
          },
        };
        const browser = {
          newContext() {
            entered.resolve();
            if (completion === 'synchronous Stop') {
              stopped.abort();
            }
            return opening.promise;
          },
          async close() {
            browserCloses += 1;
          },
        };
        const forbidden = () => {
          workCalls += 1;
          throw new Error('Cancelled setup must not admit work');
        };
        const active = owned
          ? withBrowserbaseSession(p.client, { connectOverCDP: async () => browser }, config(), forbidden, {
              signal: stopped.signal,
            })
          : withBorrowedBrowser(browser, config(), forbidden, { signal: stopped.signal });
        const outcome = active.then(
          () => null,
          (error) => error,
        );
        let early;
        let initialStatus;
        try {
          await entered.promise;
          stopped.abort();
          early = await Promise.race([outcome, delay(250).then(() => null)]);
          if (early) {
            initialStatus = await early.cleanup.retry();
          }
        } finally {
          if (completion === 'reject') {
            opening.reject(new Error('Private context failure'));
          } else {
            opening.resolve(context);
          }
          await outcome;
        }
        assert.equal(early?.name, 'AbortError', 'Stop must settle before context creation finishes');
        assert.deepEqual(initialStatus, { status: 'pending' });
        await delay(0);
        assert.deepEqual(await early.cleanup.retry(), { status: 'complete' });
        assert.equal(contextCloses, completion === 'reject' ? 0 : 1);
        assert.equal(browserCloses, owned ? 1 : 0);
        assert.equal(workCalls, 0);
        assert.equal(p.log.filter((row) => row.body?.status === 'REQUEST_RELEASE').length, owned ? 1 : 0);
      });
    }
  }
  await run('owned happy path actual SDK session/15 generic declarations/readback', async () => {
    const p = provider();
    const result = await withBrowserbaseSession(p.client, chromium, config(), workCheck);
    assert.equal(result.result, true);
    assert.equal(result.status, 'complete');
    assert.equal(p.log.filter((r) => r.resource === '/v1/sessions').length, 1);
    assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
    const before = p.log.length;
    await result.cleanup.retry();
    assert.equal(p.log.length, before);
  });
  await run('borrowed happy path never closes browser and never has provider client', async () => {
    const result = await withBorrowedBrowser(caller, config(), workCheck);
    assert.equal(result.status, 'complete');
  });
  // oxlint-disable no-await-in-loop -- Each provider/context lifetime must finish before checking the next case.
  for (const [configured, equivalent, other] of [
    ['https://EXAMPLE.test', 'https://example.test:443/page', 'https://example.test:444/page'],
    ['https://example.test:443', 'https://example.test/page', 'http://example.test/page'],
    ['http://EXAMPLE.test', 'http://example.test:80/page', 'http://example.test:81/page'],
    ['http://example.test:80', 'http://example.test/page', 'https://example.test/page'],
    ['http://[::1]:8080', 'http://[::1]:8080/page', 'http://[::1]/page'],
  ]) {
    for (const owned of [false, true]) {
      await run(`canonical origin ${configured}, owned=${owned}`, async () => {
        const p = provider();
        const counts = { newContext: 0, ws: 0, http: 0, contextClose: 0, browserClose: 0 };
        const managed = {
          connectOverCDP: async (...args) =>
            browserWrapper(await chromium.connectOverCDP(...args), noGate, counts, true),
        };
        const caseConfig = { projectId: 'project-local', allowedOrigins: [configured] };
        const work = async () => {
          for (const [url, expected] of [
            [equivalent, ['fetch', 'fulfill']],
            [other, ['blocked']],
            ['https://unlisted.test/page', ['blocked']],
          ]) {
            const effects = [];
            await counts.guard({
              request: () => ({ url: () => url, isNavigationRequest: () => true }),
              fetch: async (options) => {
                assert.deepEqual(options, { maxRedirects: 0, timeout: 0 });
                effects.push('fetch');
                return {
                  status: () => 200,
                  dispose: async () => {
                    assert.deepEqual(effects, ['fetch', 'fulfill']);
                  },
                };
              },
              fulfill: async () => effects.push('fulfill'),
              abort: async (reason) => effects.push(reason ?? 'blocked'),
            });
            assert.deepEqual(effects, expected);
          }
          return true;
        };
        const result = owned
          ? await withBrowserbaseSession(p.client, managed, caseConfig, work)
          : await withBorrowedBrowser(browserWrapper(caller, noGate, counts, false), caseConfig, work);
        assert.equal(result.result, true);
        assert.equal(result.status, 'complete');
        assert.equal(counts.contextClose, 1);
        assert.equal(counts.browserClose, Number(owned));
        assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, Number(owned));
      });
    }
  }
  for (const originConfig of [
    'https://example.test/',
    'https://example.test/page',
    'https://example.test?query',
    'https://example.test#fragment',
    'https://user:pass@example.test',
    'ftp://example.test',
  ]) {
    for (const owned of [false, true]) {
      await run(`invalid origin ${originConfig}, owned=${owned}`, async () => {
        const p = provider();
        const counts = { newContext: 0, ws: 0, http: 0, contextClose: 0, browserClose: 0 };
        const caseConfig = { projectId: 'project-local', allowedOrigins: [originConfig] };
        await assert.rejects(
          owned
            ? withBrowserbaseSession(p.client, chromium, caseConfig, () =>
                assert.fail('Invalid config must not reach work'),
              )
            : withBorrowedBrowser(browserWrapper(caller, noGate, counts, false), caseConfig, () =>
                assert.fail('Invalid config must not reach work'),
              ),
          { name: 'BrowserSessionError' },
        );
        assert.deepEqual(p.log, []);
        assert.equal(counts.newContext, 0);
      });
    }
  }
  // oxlint-enable no-await-in-loop
  for (const [phase, rejects] of [
    ['create', false],
    ['connect', false],
    ['ws', false],
    ['http', false],
    ['callback', false],
    ['ws', true],
    ['http', true],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each fixture case must settle and preserve the sentinel before the next starts.
    await run(`owned Stop during ${phase}${rejects ? ' rejecting' : ''}`, async () => {
      const wait = deferred();
      const resume = deferred();
      const counts = { newContext: 0, ws: 0, http: 0, callback: 0, contextClose: 0, browserClose: 0 };
      const abort = new AbortController();
      const gate = async (at) => {
        if (at === phase) {
          wait.resolve();
          await resume.promise;
          if (rejects) {
            throw new Error('PRIVATE_GUARD_FAILURE');
          }
        }
      };
      const p = provider(gate);
      const connection = {
        connectOverCDP: async (...args) => {
          const b = await chromium.connectOverCDP(...args);
          await gate('connect');
          return browserWrapper(b, gate, counts, true);
        },
      };
      let settled = false;
      const outcome = withBrowserbaseSession(
        p.client,
        connection,
        config(),
        async (driver, signal) => {
          counts.callback += 1;
          await gate('callback');
          return signal.aborted ? null : true;
        },
        { signal: abort.signal },
      )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .finally(() => {
          settled = true;
        });
      await wait.promise;
      abort.abort();
      try {
        if (phase === 'ws' || phase === 'http') {
          const early = await Promise.race([outcome, delay(1000).then(() => null)]);
          assert.equal(
            early?.error?.name,
            'AbortError',
            'Guard setup must settle Stop before the held acknowledgement',
          );
          assert.equal(counts.callback, 0);
          assert.equal(counts.contextClose, 1);
          assert.equal(counts.browserClose, 1);
          assert.deepEqual(await early.error.cleanup.retry(), { status: 'pending' });
        } else {
          await delay(15);
          assert.equal(settled, false);
          assert.equal(counts.contextClose, 0);
          assert.equal(counts.browserClose, 0);
          assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 0);
        }
      } finally {
        resume.resolve();
        await outcome;
        await delay(0);
      }
      const result = await outcome;
      assert.equal(result.error?.name, 'AbortError');
      assert.ok(!JSON.stringify(result.error).includes('PRIVATE_'));
      if (phase !== 'callback') {
        assert.equal(counts.callback, 0);
      }
      if (phase === 'ws') {
        assert.equal(counts.http, 0);
      }
      assert.equal(p.log.filter((r) => r.resource === '/v1/sessions').length, 1);
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
      assert.deepEqual(await result.error.cleanup.retry(), { status: 'complete' });
      assert.equal(counts.browserClose, phase === 'create' ? 0 : 1);
    });
  }
  for (const [phase, rejects] of [
    ['ws', false],
    ['http', false],
    ['callback', false],
    ['ws', true],
    ['http', true],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each fixture case must settle and preserve the sentinel before the next starts.
    await run(`borrowed Stop during ${phase}${rejects ? ' rejecting' : ''}`, async () => {
      const wait = deferred();
      const resume = deferred();
      const abort = new AbortController();
      const counts = { newContext: 0, ws: 0, http: 0, callback: 0, contextClose: 0, browserClose: 0 };
      const gate = async (at) => {
        if (at === phase) {
          wait.resolve();
          await resume.promise;
          if (rejects) {
            throw new Error('PRIVATE_GUARD_FAILURE');
          }
        }
      };
      const pending = withBorrowedBrowser(
        browserWrapper(caller, gate, counts, false),
        config(),
        async () => {
          counts.callback += 1;
          await gate('callback');
        },
        { signal: abort.signal },
      ).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await wait.promise;
      abort.abort();
      try {
        if (phase === 'ws' || phase === 'http') {
          const early = await Promise.race([pending, delay(1000).then(() => null)]);
          assert.equal(
            early?.error?.name,
            'AbortError',
            'Guard setup must settle Stop before the held acknowledgement',
          );
          assert.equal(counts.callback, 0);
          assert.equal(counts.contextClose, 1);
          assert.deepEqual(await early.error.cleanup.retry(), { status: 'pending' });
        } else {
          await delay(15);
          assert.equal(counts.contextClose, 0);
        }
      } finally {
        resume.resolve();
        await pending;
        await delay(0);
      }
      const result = await pending;
      assert.equal(result.error?.name, 'AbortError');
      assert.equal(counts.browserClose, 0);
      assert.equal(counts.contextClose, 1);
      if (phase !== 'callback') {
        assert.equal(counts.callback, 0);
      }
      assert.deepEqual(await result.error.cleanup.retry(), { status: 'complete' });
    });
  }

  for (const phase of ['confirm', 'native']) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each fixture case must settle and preserve the sentinel before the next starts.
    await run(`Stop during admitted public helper ${phase} preserves context until settlement`, async () => {
      const wait = deferred();
      const resume = deferred();
      const abort = new AbortController();
      const counts = { newContext: 0, ws: 0, http: 0, contextClose: 0, browserClose: 0 };
      const p = provider();
      const managed = {
        connectOverCDP: async (...a) =>
          browserWrapper(await chromium.connectOverCDP(...a), async () => null, counts, true),
      };
      let declared;
      let effects = 0;
      let settled = false;
      const pending = withBrowserbaseSession(
        p.client,
        managed,
        config(),
        async (driver, signal) => {
          const snapshot = {
            ...driver,
            new_tab: async (args) => {
              const result = await driver.new_tab(args);
              effects += 1;
              if (phase === 'native') {
                wait.resolve();
                await resume.promise;
              }
              return result;
            },
          };
          const tools = new BrowserToolset(snapshot, {
            urlPolicy: (_, url) => new URL(url).origin === origin,
            confirm: async () => {
              if (phase === 'confirm') {
                wait.resolve();
                await resume.promise;
              }
              return true;
            },
          });
          declared = tools.tools().find((t) => t.name.endsWith('new_tab'));
          return await tools.execute(
            {
              type: 'function_call',
              call_id: 'held',
              name: declared.name,
              status: 'completed',
              arguments: JSON.stringify({ url: origin }),
            },
            { signal },
          );
        },
        { signal: abort.signal },
      )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .finally(() => {
          settled = true;
        });
      await wait.promise;
      abort.abort();
      await delay(15);
      assert.equal(settled, false);
      assert.equal(counts.contextClose, 0);
      assert.equal(counts.browserClose, 0);
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 0);
      assert.equal(effects, phase === 'native' ? 1 : 0);
      resume.resolve();
      const outcome = await pending;
      assert.equal(outcome.error?.name, 'AbortError');
      assert.equal(effects, phase === 'native' ? 1 : 0);
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
    });
  }
  for (const [label, created] of [
    ['path changing id', { id: '../another' }],
    ['empty id', { id: '' }],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each fixture case must settle and preserve the sentinel before the next starts.
    await run(`${label} initial identity cannot release unrelated resources`, async () => {
      const p = provider(async () => null, { created });
      const outcome = await withBrowserbaseSession(p.client, chromium, config(), () => assert.fail()).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      assert.equal(outcome.error.name, 'BrowserSessionError');
      const retryResult = await outcome.error.cleanup.retry();
      assert.equal(retryResult.status, 'unverified');
      assert.equal(p.log.length, 1);
    });
  }
  for (const initiallyVerified of [true, false]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Own and dispose each local provider independently.
    await run(
      `creation project mismatch with ${initiallyVerified ? 'matching' : 'mismatching'} verified readback`,
      async () => {
        const mode = {
          created: { projectId: 'other' },
          readback: initiallyVerified ? {} : { projectId: 'other' },
        };
        const p = provider(async () => null, mode);
        const failure = await withBrowserbaseSession(p.client, chromium, config(), () =>
          assert.fail('no work'),
        ).catch((error) => error);
        assert.equal(failure.name, 'BrowserSessionError');
        assert.equal(
          p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length,
          Number(initiallyVerified),
        );
        assert.deepEqual(await failure.cleanup.retry(), {
          status: initiallyVerified ? 'complete' : 'pending',
        });
        assert.equal(
          p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length,
          Number(initiallyVerified),
        );
        mode.readback = {};
        assert.deepEqual(await failure.cleanup.retry(), { status: 'complete' });
        assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
      },
    );
  }
  await run('504 create once, no default retries, unverified cleanup', async () => {
    const p = provider(async () => null, { createFail: true });
    const outcome = await withBrowserbaseSession(p.client, chromium, config(), () => assert.fail()).catch(
      (error) => error,
    );
    assert.equal(outcome.name, 'BrowserSessionError');
    assert.deepEqual(await outcome.cleanup.retry(), { status: 'unverified' });
    assert.equal(p.log.length, 1);
  });
  for (const readback of [{ id: 'other' }, { projectId: 'other' }, { status: 'UNRECOGNIZED' }]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each fixture case must settle and preserve the sentinel before the next starts.
    await run(`readback identity/status ${JSON.stringify(readback)} denied`, async () => {
      const p = provider(async () => null, { readback });
      const result = await withBrowserbaseSession(p.client, chromium, config(), () => true);
      assert.equal(result.status, 'pending');
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 0);
    });
  }
  await run(
    'failed cleanup on callback error; concurrent private retry reads once then updates once',
    async () => {
      const mode = { releaseFail: true };
      const p = provider(async () => null, mode);
      const failure = await withBrowserbaseSession(p.client, chromium, config(), () => {
        throw new Error('PRIVATE_CALLBACK_ERROR');
      }).catch((error) => error);
      assert.equal(failure.name, 'BrowserSessionError');
      assert.equal(JSON.stringify(failure).includes('PRIVATE_'), false);
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
      mode.releaseFail = false;
      const before = p.log.length;
      const [a, b] = await Promise.all([failure.cleanup.retry(), failure.cleanup.retry()]);
      assert.deepEqual(a, { status: 'complete' });
      assert.deepEqual(a, b);
      assert.equal(p.log[before].method, 'GET');
      assert.equal(p.log.slice(before).filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
    },
  );
  await run(
    'local close failure still releases, repeats only local cleanup when provider terminal',
    async () => {
      const counts = { newContext: 0, ws: 0, http: 0, contextClose: 0, browserClose: 0, failClose: true };
      const p = provider();
      const managed = {
        connectOverCDP: async (...a) =>
          browserWrapper(await chromium.connectOverCDP(...a), async () => null, counts, true),
      };
      const result = await withBrowserbaseSession(p.client, managed, config(), () => true);
      assert.equal(result.status, 'pending');
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
      counts.failClose = false;
      const retryResult = await result.cleanup.retry();
      assert.equal(retryResult.status, 'complete');
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
    },
  );
  await run('unsettled local close releases provider and is retained by retries', async () => {
    const counts = { newContext: 0, ws: 0, http: 0, contextClose: 0, browserClose: 0 };
    let finish;
    // oxlint-disable-next-line promise/avoid-new -- Close remains pending until the test releases its controlled gate.
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    const gate = async (at) => {
      if (at === 'close') {
        await held;
      }
    };
    const p = provider();
    const managed = {
      connectOverCDP: async (...a) => browserWrapper(await chromium.connectOverCDP(...a), gate, counts, true),
    };
    try {
      const start = performance.now();
      const result = await withBrowserbaseSession(p.client, managed, config(), () => true);
      assert.ok(performance.now() - start < 6000);
      assert.equal(result.status, 'pending');
      assert.equal(counts.contextClose, 1);
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
      const first = result.cleanup.retry();
      const second = result.cleanup.retry();
      assert.equal(first, second);
      assert.equal(counts.contextClose, 1);
      finish();
      assert.deepEqual(await first, { status: 'complete' });
      assert.equal(p.log.filter((r) => r.body?.status === 'REQUEST_RELEASE').length, 1);
    } finally {
      finish();
    }
  });
  console.log(
    JSON.stringify({
      summary: true,
      passed: rows.length,
      provider: 'synthetic_fetch_only',
      apiRequests: 0,
      chromium: persistent.browser()?.version(),
      sandbox: true,
    }),
  );
} finally {
  await sentinel.close();
  await caller.close();
  await persistent.close();
  await rm(profile, { recursive: true, force: true });
  await promisify(server.close).call(server);
}
