import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { withStandaloneBrowser } from './browser-use-session.mjs';

const ID = '57a2d3a0-917a-443d-882b-93721d7b6dea';
const FOREIGN = 'ef169644-f60b-488a-81e2-261718d4c671';
const profile = await mkdtemp(path.join(tmpdir(), 'browser-use-contract-'));
const persistent = await chromium.launchPersistentContext(profile, {
  headless: true,
  chromiumSandbox: true,
  args: ['--remote-debugging-port=0'],
  env: { PATH: process.env.PATH ?? '', HOME: profile, TMPDIR: profile },
});
const devtools = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf-8');
const [port] = devtools.split('\n');
const endpoint = `http://127.0.0.1:${port}`;
const caller = await chromium.connectOverCDP(endpoint);
const sentinel = await caller.newContext();
const witness = await sentinel.newPage();
await witness.setContent('<p>Independent caller survives</p>');
const passed = [];

async function fixture(
  mode = {},
  gate = async () => {
    // Most cases do not pause provider operations.
  },
) {
  const requests = [];
  const receipts = [];
  let status = 'active';
  let pageHits = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    if (request.url === '/approved') {
      pageHits += 1;
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Fixture</title><p>Approved local page</p>');
      return;
    }
    const verb = request.method;
    requests.push({ verb, url: request.url, body });
    const view = { id: ID, status, cdpUrl: endpoint, agentSessionId: null, liveUrl: 'PRIVATE_LIVE_URL' };
    let code = 200;
    if (verb === 'POST' && request.url === '/browsers') {
      assert.deepEqual(body, {
        timeout: 1,
        proxyCountryCode: null,
        enableRecording: false,
        browserScreenWidth: 1024,
        browserScreenHeight: 768,
        allowResizing: false,
      });
      await gate('create');
      if (mode.createFail) {
        code = 500;
      }
      if (mode.invalidId) {
        view.id = '../unowned';
      }
    } else {
      assert.equal(request.url, `/browsers/${ID}`);
      if (verb === 'GET') {
        await gate('get');
        if (mode.wrongId) {
          view.id = FOREIGN;
        }
        if (mode.attached) {
          view.agentSessionId = FOREIGN;
        }
        if (mode.missingAgent) {
          delete view.agentSessionId;
        }
        if (mode.unknownStatus) {
          view.status = 'unknown';
        }
      } else {
        assert.equal(verb, 'PATCH');
        assert.deepEqual(body, { action: 'stop' });
        await gate('stop');
        if (mode.stopFail) {
          code = 500;
        } else if (!mode.stayLive) {
          status = 'stopped';
          view.status = status;
        }
      }
    }
    response
      .writeHead(code, { 'content-type': 'application/json' })
      .end(JSON.stringify(code === 200 ? view : { detail: 'PRIVATE_PROVIDER_ERROR' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    requests,
    receipts,
    origin,
    pageHits: () => pageHits,
    start: (work, options = {}, browserType = chromium, origins = [origin]) =>
      withStandaloneBrowser(browserType, origins, work, {
        apiKey: 'SYNTHETIC_UNUSED_KEY',
        baseUrl: origin,
        onCleanup: (handle) => {
          receipts.push(handle);
        },
        ...options,
      }),
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

async function run(name, operation) {
  await operation();
  assert.equal(await witness.locator('p').textContent(), 'Independent caller survives');
  passed.push(name);
  console.log(JSON.stringify({ name, pass: true }));
}

try {
  await run('base URL credentials and fragments refused before local transport', async () => {
    const f = await fixture();
    try {
      const local = new URL(f.origin);
      for (const baseUrl of [
        `http://fixture@${local.host}`,
        `${f.origin}#fixture`,
        `${f.origin}/?page=example#fixture`,
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- Each admission must finish before the fixture is inspected.
        await assert.rejects(f.start(() => assert.fail('Refused configuration reached work'), { baseUrl }));
        assert.equal(f.requests.length, 0);
      }
    } finally {
      await f.close();
    }
  });
  await run('actual provider SDK and browser helper complete an isolated local task', async () => {
    const f = await fixture();
    try {
      const result = await f.start(async (driver, signal) => {
        const tools = new BrowserToolset(driver, {
          confirm: () => true,
          urlPolicy: (_, url) => new URL(url).origin === f.origin,
        });
        assert.equal(tools.tools().length, 15);
        const output = await tools.execute(
          {
            type: 'function_call',
            id: 'i',
            call_id: 'c',
            status: 'completed',
            name: 'browser_new_tab',
            arguments: JSON.stringify({ url: `${f.origin}/approved` }),
          },
          { signal },
        );
        assert.equal(JSON.parse(output.output[0].text).ok, true);
        assert.match(await driver.get_page_text({ tab_id: null }), /Approved local page/u);
        return 'verified';
      });
      assert.equal(result.result, 'verified');
      assert.equal(result.status, 'complete');
      assert.equal(f.receipts.length, 1);
      const count = f.requests.length;
      assert.deepEqual(await result.cleanup.retry(), { status: 'complete' });
      assert.equal(f.requests.length, count);
      assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
      assert.equal(f.requests.filter((r) => r.verb === 'POST').length, 1);
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
    } finally {
      await f.close();
    }
  });

  // oxlint-disable no-await-in-loop -- Each owned browser lifetime must finish before its next case.
  for (const [configured, equivalent, other] of [
    ['https://EXAMPLE.test', 'https://example.test:443/page', 'https://example.test:444/page'],
    ['https://example.test:443', 'https://example.test/page', 'http://example.test/page'],
    ['http://EXAMPLE.test', 'http://example.test:80/page', 'http://example.test:81/page'],
    ['http://example.test:80', 'http://example.test/page', 'https://example.test/page'],
    ['http://[::1]:8080', 'http://[::1]:8080/page', 'http://[::1]/page'],
  ]) {
    await run(`standalone canonical origin ${configured}`, async () => {
      const f = await fixture();
      let guard;
      const managed = {
        async connectOverCDP(...args) {
          const browser = await chromium.connectOverCDP(...args);
          return {
            async newContext(options) {
              const context = await browser.newContext(options);
              return {
                route: async (url, handler) => {
                  guard = handler;
                  await context.route(url, handler);
                },
                routeWebSocket: (...opts) => context.routeWebSocket(...opts),
                on: (...opts) => context.on(...opts),
                pages: () => context.pages(),
                newPage: () => context.newPage(),
                close: () => context.close(),
              };
            },
            close: () => browser.close(),
          };
        },
      };
      try {
        const result = await f.start(
          async () => {
            for (const [url, expected] of [
              [equivalent, ['fetch', 'fulfill']],
              [other, ['blocked']],
              ['https://unlisted.test/page', ['blocked']],
            ]) {
              const effects = [];
              await guard({
                request: () => ({ url: () => url, isNavigationRequest: () => true }),
                fetch: (options) => {
                  assert.deepEqual(options, { maxRedirects: 0, timeout: 0 });
                  effects.push('fetch');
                  return {
                    status: () => 200,
                    dispose: () => {
                      /* synthetic response has no buffers */
                    },
                  };
                },
                fulfill: () => effects.push('fulfill'),
                abort: (reason) => effects.push(reason ?? 'blocked'),
              });
              assert.deepEqual(effects, expected);
            }
            return true;
          },
          {},
          managed,
          [configured],
        );
        assert.equal(result.result, true);
        assert.equal(result.status, 'complete');
        assert.equal(f.receipts.length, 1);
        assert.equal(f.requests.filter((r) => r.verb === 'POST').length, 1);
        assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
        assert.equal(f.pageHits(), 0);
      } finally {
        await f.close();
      }
    });
  }
  for (const configured of [
    'https://example.test/',
    'https://example.test/page',
    'https://example.test?query',
    'https://example.test#fragment',
    'https://user:pass@example.test',
    'ftp://example.test',
  ]) {
    await run(`standalone refuses invalid origin ${configured} before create`, async () => {
      const f = await fixture();
      try {
        await assert.rejects(
          f.start(() => assert.fail('Invalid config must not reach work'), {}, chromium, [configured]),
          { name: 'BrowserUseSessionError' },
        );
        assert.deepEqual(f.requests, []);
        assert.equal(f.receipts.length, 1);
      } finally {
        await f.close();
      }
    });
  }
  for (const key of ['createFail', 'invalidId', 'wrongId', 'attached', 'missingAgent', 'unknownStatus']) {
    await run(`refuse ${key} without guessing or repeating create`, async () => {
      const f = await fixture({ [key]: true });
      try {
        const failure = await f
          .start(() => assert.fail('Unverified browser reached work'))
          .catch((error) => error);
        assert.equal(failure.name, 'BrowserUseSessionError');
        assert.equal(f.receipts.length, 1);
        assert.equal(failure.cleanup, f.receipts[0]);
        assert.equal(f.requests.filter((r) => r.verb === 'POST').length, 1);
        assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 0);
        assert.ok(!JSON.stringify(failure).includes('PRIVATE_'));
      } finally {
        await f.close();
      }
    });
  }
  for (const phase of ['create', 'get', 'connect', 'work', 'stop']) {
    await run(`Stop drains admitted ${phase}`, async () => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      let held = false;
      const gate = async (at) => {
        if (at === phase && !held) {
          held = true;
          entered.resolve();
          await release.promise;
        }
      };
      const f = await fixture({}, gate);
      const abort = new AbortController();
      const connected = {
        connectOverCDP: async (...args) => {
          const browser = await chromium.connectOverCDP(...args);
          await gate('connect');
          return browser;
        },
      };
      let settled = false;
      try {
        const pending = f
          .start(
            async () => {
              await gate('work');
              return true;
            },
            { signal: abort.signal },
            connected,
          )
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
          .finally(() => {
            settled = true;
          });
        await entered.promise;
        abort.abort();
        await delay(20);
        assert.equal(settled, false);
        assert.equal(f.receipts.length, 0);
        release.resolve();
        const result = await pending;
        assert.equal(result.error.name, 'AbortError');
        assert.equal(f.receipts.length, 1);
        assert.deepEqual(await f.receipts[0].retry(), { status: 'complete' });
        assert.equal(f.requests.filter((r) => r.verb === 'POST').length, 1);
        assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
      } finally {
        release.resolve();
        await f.close();
      }
    });
  }
  // oxlint-enable no-await-in-loop

  await run('cleanup retry shares one attempt after stop failure', async () => {
    const mode = { stopFail: true };
    const f = await fixture(mode);
    try {
      const result = await f.start(() => true);
      assert.equal(result.status, 'pending');
      mode.stopFail = false;
      const count = f.requests.length;
      const [a, b] = await Promise.all([result.cleanup.retry(), result.cleanup.retry()]);
      assert.deepEqual(a, { status: 'complete' });
      assert.deepEqual(a, b);
      assert.deepEqual(
        f.requests.slice(count).map((r) => r.verb),
        ['GET', 'PATCH', 'GET'],
      );
    } finally {
      await f.close();
    }
  });
  await run('failed notification preserves the private complete cleanup handle', async () => {
    const f = await fixture();
    try {
      const failure = await f
        .start(() => true, {
          onCleanup: () => {
            throw new Error('PRIVATE_CALLBACK');
          },
        })
        .catch((error) => error);
      assert.equal(failure.message, 'Browser cleanup notification failed.');
      assert.deepEqual(await failure.cleanup.retry(), { status: 'complete' });
      assert.ok(!JSON.stringify(failure).includes('PRIVATE_'));
    } finally {
      await f.close();
    }
  });
  await run('callback failure retains borrowed cleanup and retires the exact session', async () => {
    const f = await fixture();
    try {
      const failure = await f
        .start(() => {
          throw new Error('PRIVATE_WORK_ERROR');
        })
        .catch((error) => error);
      assert.equal(failure.name, 'BrowserUseSessionError');
      assert.equal(f.receipts[0], failure.cleanup);
      assert.deepEqual(await failure.cleanup.retry(), { status: 'complete' });
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
      assert.ok(!JSON.stringify(failure).includes('PRIVATE_'));
    } finally {
      await f.close();
    }
  });
  await run('local close failure remains pending and can be retried', async () => {
    const f = await fixture();
    let failClose = true;
    const connected = {
      connectOverCDP: async (...args) => {
        const browser = await chromium.connectOverCDP(...args);
        return {
          newContext: (...options) => browser.newContext(...options),
          close: async () => {
            if (failClose) {
              throw new Error('PRIVATE_CLOSE_ERROR');
            }
            await browser.close();
          },
        };
      },
    };
    try {
      const result = await f.start(() => true, {}, connected);
      assert.equal(result.status, 'pending');
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
      failClose = false;
      assert.deepEqual(await result.cleanup.retry(), { status: 'complete' });
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
    } finally {
      await f.close();
    }
  });
  await run('stalled CDP close still releases exact provider and retries the same local close', async () => {
    const f = await fixture();
    const release = Promise.withResolvers();
    let closes = 0;
    const connected = {
      async connectOverCDP(...args) {
        const browser = await chromium.connectOverCDP(...args);
        return {
          newContext: (...options) => browser.newContext(...options),
          async close() {
            closes += 1;
            await release.promise;
            await browser.close();
          },
        };
      },
    };
    try {
      const result = await f.start(() => true, {}, connected);
      assert.equal(result.status, 'pending');
      assert.equal(closes, 1);
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
      const retry = result.cleanup.retry();
      release.resolve();
      assert.deepEqual(await retry, { status: 'complete' });
      assert.equal(closes, 1);
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 1);
    } finally {
      release.resolve();
      await f.close();
    }
  });
  await run('active stop readback remains pending until explicit retry', async () => {
    const mode = { stayLive: true };
    const f = await fixture(mode);
    try {
      const result = await f.start(() => true);
      assert.equal(result.status, 'pending');
      mode.stayLive = false;
      assert.deepEqual(await result.cleanup.retry(), { status: 'complete' });
      assert.equal(f.requests.filter((r) => r.verb === 'PATCH').length, 2);
    } finally {
      await f.close();
    }
  });
  await run('pre-aborted admission makes no provider request', async () => {
    const f = await fixture();
    try {
      const abort = new AbortController();
      abort.abort();
      const failure = await f.start(() => assert.fail(), { signal: abort.signal }).catch((error) => error);
      assert.equal(failure.name, 'AbortError');
      assert.equal(f.requests.length, 0);
      assert.equal(f.receipts.length, 1);
    } finally {
      await f.close();
    }
  });
  await run('async notification is a reported contract error', async () => {
    const f = await fixture();
    try {
      const failure = await f
        .start(() => true, {
          onCleanup: async () => {
            throw new Error('PRIVATE_ASYNC_ERROR');
          },
        })
        .catch((error) => error);
      assert.equal(failure.message, 'Browser cleanup notification failed.');
      assert.deepEqual(await failure.cleanup.retry(), { status: 'complete' });
    } finally {
      await f.close();
    }
  });
  await run('origin changes during create cannot expand the admitted task', async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const f = await fixture({}, async (phase) => {
      if (phase === 'create') {
        entered.resolve();
        await release.promise;
      }
    });
    const other = await fixture();
    const origins = [f.origin];
    try {
      const pending = f.start(
        async (driver) => {
          await assert.rejects(driver.new_tab({ url: `${other.origin}/approved` }));
          return true;
        },
        {},
        chromium,
        origins,
      );
      await entered.promise;
      origins.push(other.origin);
      release.resolve();
      const result = await pending;
      assert.equal(result.status, 'complete');
      assert.equal(other.pageHits(), 0);
    } finally {
      release.resolve();
      await f.close();
      await other.close();
    }
  });
  console.log(JSON.stringify({ passed: passed.length, providerRequests: 'loopback only', modelRequests: 0 }));
} finally {
  await sentinel.close();
  await caller.close();
  await persistent.close();
  await rm(profile, { recursive: true, force: true });
}
