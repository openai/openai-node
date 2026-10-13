import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import fileIO, { readFile, readdir, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { newDownloadOwner, digest } from './file-download.mjs';

const require = createRequire(import.meta.url);

const html = await readFile(new URL('file-download.html', import.meta.url));
const content = Buffer.from('PRIVATE_RESULT_ONLY_FOR_QUARANTINE\n'.repeat(600));
const gate = () => {
  let release;
  // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
};
const receipts = [];
const waitFor = async (predicate) => {
  const expiry = Date.now() + 3000;
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
  while (!(await predicate())) {
    assert.ok(Date.now() < expiry, 'bounded local observable did not settle');
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await delay(10);
  }
};
const called = (name, args) => ({
  type: 'function_call',
  name,
  call_id: 'download_once',
  status: 'completed',
  arguments: JSON.stringify(args),
});

function runSDK(owner, permitted, suppliedArgs, readState = false) {
  const args = suppliedArgs === undefined ? { grant_id: permitted?.grant_id } : suppliedArgs;
  const bodies = [];
  const client = new OpenAI({
    apiKey: 'synthetic-unused',
    baseURL: 'http://local-fake-transport.invalid/v1',
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert.ok(bodies.length <= 2, 'fixed function must never automatically retry');
      const output =
        bodies.length === 1
          ? [called(readState ? 'file_status' : 'download', readState ? {} : args)]
          : [
              {
                type: 'message',
                id: 'msg_fixture',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Finished', annotations: [] }],
              },
            ];
      return Response.json({
        id: `resp_${bodies.length}`,
        object: 'response',
        created_at: 0,
        model: '',
        status: 'completed',
        output,
      });
    },
  });
  const runner = new ResponsesToolRunner({
    functions: [
      {
        tool: {
          type: 'function',
          name: 'download',
          description: 'Receive the prepared fixture result.',
          strict: true,
          parameters: {
            type: 'object',
            properties: { grant_id: { type: 'string' } },
            required: ['grant_id'],
            additionalProperties: false,
          },
        },
        execute: (callArgs) => owner.download(callArgs),
      },
      {
        tool: {
          type: 'function',
          name: 'file_status',
          description: 'Read bounded transfer and cleanup outcomes.',
          strict: true,
          parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
        execute: () => JSON.stringify(owner.state()),
      },
    ],
  });
  const settled = runner
    .run(
      client,
      { model: '', input: 'Receive the prepared result.', store: false },
      // A status read is a separate, explicitly authorized run after Stop.
      { maxSteps: 3, signal: readState ? undefined : owner.abort.signal },
    )
    // oxlint-disable-next-line promise/prefer-await-to-then -- Register ownership or rejection handling before a held operation can reenter.
    .then(
      (value) => ({ value }),
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection immediately while the fixture holds the operation.
      (error) => ({ error }),
    );
  return { bodies, settled };
}

const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  },
});
async function scenario(name, mode, check, options = {}) {
  const requests = [];
  const deliveries = [];
  const requestEntered = gate();
  const bodyRelease = gate();
  let blocked = 0;
  // oxlint-disable-next-line eslint/complexity -- Keep this single owned transfer or fixture response transaction in order.
  const server = createServer(async (req, res) => {
    if (req.url === '/fixture') {
      return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    }
    if (req.url === '/trap') {
      requests.push({ path: 'TRAP' });
      return res.end('trap');
    }
    if (req.url === '/unsolicited') {
      return res
        .writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="../../UNTRUSTED_NAME"',
        })
        .end(content);
    }
    if (req.url !== '/result') {
      res.writeHead(404).end();
      return;
    }
    requests.push({ path: req.url, method: req.method, headers: req.headers });
    requestEntered.resolve();
    if (mode === 'held-headers' || mode === 'slow-headers') {
      await bodyRelease.promise;
    }
    if (res.destroyed) {
      return;
    }
    if (mode === 'redirect') {
      res.writeHead(302, { location: '/trap', 'content-type': 'application/octet-stream' }).end();
      return;
    }
    if (mode === 'huge-headers') {
      res
        .writeHead(200, { 'content-type': 'application/octet-stream', 'x-oversize': 'x'.repeat(12_000) })
        .end(content);
      return;
    }
    const head = {
      'content-type': mode === 'html' ? 'text/html' : 'application/octet-stream',
      'content-disposition':
        'attachment; filename="../../UNTRUSTED_NAME"; filename*=utf-8\'\'/tmp/PRIVATE_RESULT',
      'x-untrusted-path': '/tmp/PRIVATE_RESULT',
      'content-encoding': mode === 'encoded' ? 'gzip' : 'identity',
    };
    if (
      ['positive', 'held-headers', 'slow-headers', 'short-length', 'long-length', 'wrong-digest'].includes(
        mode,
      )
    ) {
      let contentLength = content.length;
      if (mode === 'short-length') {
        contentLength -= 5;
      }
      if (mode === 'long-length') {
        contentLength += 5;
      }
      head['content-length'] = String(contentLength);
    }
    res.writeHead(200, head);
    res.flushHeaders();
    const record = (chunk) => {
      deliveries.push(chunk.length);
      return res.write(chunk);
    };
    if (mode === 'oversized') {
      for (let i = 0; i < 12 && !res.destroyed; i += 1) {
        if (!record(Buffer.alloc(8192, 88))) {
          // This private fixture honors backpressure but also stops on cancel.
          // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
          await Promise.race([once(res, 'drain'), once(res, 'close')]).catch(() => {
            // Canceling the fixture response can end native backpressure with an error.
          });
        }
      }
      res.end();
      return;
    }
    if (mode === 'truncate') {
      record(content.subarray(0, 9000));
      await bodyRelease.promise;
      res.destroy();
      return;
    }
    if (mode === 'lost-final-chunk') {
      record(content);
      await bodyRelease.promise;
      res.destroy();
      return;
    }
    if (mode === 'held-body' || mode === 'slow-body') {
      record(content.subarray(0, 12_000));
      await bodyRelease.promise;
      if (!res.destroyed) {
        record(content.subarray(12_000));
        res.end();
      }
      return;
    }
    record(mode === 'wrong-digest' ? Buffer.alloc(content.length, 90) : content);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  const page = await context.newPage();
  page.on('download', async (download) => {
    await download.cancel();
    blocked += 1;
  });
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  await page.goto(url);
  const config = {
    allowDownload: !options.noConfig && options.enabled !== false,
    record: await page.locator('[data-record-id="result-case"]').elementHandle(),
    control: await page.locator('button[data-result]').elementHandle(),
    recordId: 'result-case',
  };
  const owner = await newDownloadOwner(page, config, options.approve ?? (async () => true));
  const entry = {
    owner,
    page,
    config,
    requests,
    deliveries,
    requestEntered,
    bodyRelease,
    blocked: () => blocked,
    issue(expiry = Date.now() + 15_000) {
      return owner.issue(
        { url: url.replace('/fixture', '/result'), count: content.length, sha256: digest(content) },
        expiry,
      );
    },
  };
  try {
    const earlierReceipt = await check(entry);
    const last = owner.receipt();
    const rendered = JSON.stringify([last, owner.state()]);
    for (const marker of [
      owner.area,
      owner.quarantine,
      content.toString(),
      'UNTRUSTED_NAME',
      'PRIVATE_RESULT',
      'http:',
      url,
      '/result',
      '<html',
      'Error:',
      'q_',
    ]) {
      assert.ok(!rendered.includes(marker), `${name}: fixed receipt must hide ${marker}`);
    }
    assert.ok(owner.stats.readBytes <= 65_537, `${name}: application read cap`);
    assert.ok(owner.stats.writtenBytes <= 65_536, `${name}: write cap`);
    assert.ok(owner.stats.peakFileBytes <= 65_536, `${name}: peak actual fstat cap`);
    if (owner.stats.requests) {
      assert.ok(requests.length <= 1, `${name}:no redirect/replay`);
      for (const request of requests) {
        assert.equal(request.path, '/result');
        assert.equal(request.method, 'GET');
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, undefined);
        assert.equal(request.headers['proxy-authorization'], undefined);
      }
    }
    const quarantined = await readdir(owner.quarantine).catch(() => []);
    receipts.push({
      name,
      mode,
      stats: { ...owner.stats },
      fixtureRequests: requests.length,
      fixtureBytesWritten: deliveries.reduce((a, b) => a + b, 0),
      quarantineFiles: quarantined.length,
      ...(earlierReceipt ? { earlierReceipt } : {}),
      lastCallReceipt: last,
      blocked,
    });
  } finally {
    bodyRelease.resolve();
    await owner.stop();
    assert.equal(owner.state().cleanup, 'completed');
    await context.close();
    // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await assert.rejects(access(owner.area));
  }
}
async function done(owner, call, status) {
  const result = await call.settled;
  assert.ok(!result.error, result.error?.message);
  assert.equal(call.bodies.length, 2);
  const item = call.bodies[1].input.find((candidate) => candidate.type === 'function_call_output');
  assert.deepEqual(JSON.parse(item.output), owner.receipt());
  assert.equal(owner.receipt().status, status);
}
async function nothing(e) {
  assert.equal(e.owner.stats.requests, 0);
  assert.equal(e.requests.length, 0);
  assert.deepEqual(await readdir(e.owner.quarantine), []);
}
async function safeRefusal(e, grant, args) {
  await done(e.owner, runSDK(e.owner, grant, args), 'refused');
  await nothing(e);
}
async function completed(e, grant) {
  await done(e.owner, runSDK(e.owner, grant), 'completed');
  const files = await readdir(e.owner.quarantine);
  assert.equal(files.length, 1);
  assert.match(files[0], /^q_[a-f0-9]{24}$/u);
  const full = path.join(e.owner.quarantine, files[0]);
  const stored = await stat(full);
  // oxlint-disable-next-line eslint/no-bitwise -- Native file permissions are bitmasks.
  assert.equal(stored.mode & 0o777, 0o600);
  const disk = await readFile(full);
  assert.deepEqual(disk, content);
  assert.deepEqual(e.owner.receipt(), {
    status: 'completed',
    attempted: true,
    completed: true,
    count: content.length,
    sha256: digest(content),
  });
  assert.deepEqual(e.owner.state().current, { status: 'completed', effect: 'completed' });
  assert.equal(e.owner.state().cleanup, 'not_started');
  assert.equal(e.requests.length, 1);
}
async function retired(e, grant) {
  assert.deepEqual(e.owner.receipt(), { status: 'unknown', attempted: true, completed: false });
  assert.deepEqual(await readdir(e.owner.quarantine).catch(() => []), []);
  assert.equal(JSON.parse(await e.owner.download({ grant_id: grant.grant_id })).status, 'refused');
  assert.throws(() => e.issue(), /^Error: Result grant refused\.$/u);
  assert.equal(e.owner.stats.requests, 1);
}
try {
  await scenario('positive+tampered filenames+copied config', 'positive', async (e) => {
    const expected = {
      url: e.page.url().replace('/fixture', '/result'),
      count: content.length,
      sha256: digest(content),
    };
    const grant = e.owner.issue(expected, Date.now() + 15_000);
    Object.assign(expected, { url: 'http://127.0.0.1:1/changed', count: 0, sha256: '0'.repeat(64) });
    grant.label = '../../UNTRUSTED_NAME';
    e.config.allowDownload = false;
    e.config.port = 1;
    await completed(e, grant);
    const receipt = e.owner.receipt();
    assert.equal(JSON.parse(await e.owner.download({ grant_id: grant.grant_id })).status, 'refused');
    assert.equal(receipt.completed, true);
    assert.throws(() => e.issue(), /^Error: Result grant refused\.$/u);
    assert.equal(e.owner.stats.requests, 1);
    return receipt;
  });
  await scenario(
    'absent config denies',
    'positive',
    async (e) => {
      assert.throws(() => e.issue(), /^Error: Result grant refused\.$/u);
      await nothing(e);
    },
    { noConfig: true },
  );
  await scenario(
    'denied config cannot be enabled later',
    'positive',
    async (e) => {
      e.config.allowDownload = true;
      assert.throws(() => e.issue());
      await nothing(e);
    },
    { enabled: false },
  );
  for (const approval of [false, null, 0, 1, 'true', {}, []]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await scenario(
      `strict-approval-${String(approval)}`,
      'positive',
      async (e) => {
        await safeRefusal(e, e.issue());
      },
      { approve: async () => approval },
    );
  }
  for (const args of [
    { grant_id: 'other' },
    { grant_id: 'download-to-upload-path', path: '/tmp/PRIVATE_RESULT' },
    { grant_id: 'other', url: 'http://127.0.0.1/result' },
    { grant_id: 'other', headers: { authorization: 'PRIVATE' } },
    { grant_id: 'other', name: 'UNTRUSTED_NAME' },
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await scenario(`model-args-${Object.keys(args).join('-')}`, 'positive', async (e) => {
      const grant = e.issue();
      // Distinguish a forged grant from an actual grant extended with a model-selected request.
      const attempted = Object.keys(args).length === 1 ? args : { ...args, grant_id: grant.grant_id };
      await safeRefusal(e, grant, attempted);
    });
  }
  for (const mode of [
    'positive',
    'chunked',
    'redirect',
    'huge-headers',
    'html',
    'encoded',
    'short-length',
    'long-length',
    'oversized',
    'wrong-digest',
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await scenario(`native-${mode}`, mode, async (e) => {
      const grant = e.issue();
      if (mode === 'positive' || mode === 'chunked') {
        await completed(e, grant);
      } else {
        await done(e.owner, runSDK(e.owner, grant), 'unknown');
        await retired(e, grant);
      }
    });
  }
  for (const mutation of ['control', 'disabled', 'record', 'document', 'session', 'expired', 'stop']) {
    const pending = gate();
    const seen = gate();
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await scenario(
      `held-approval-${mutation}`,
      'positive',
      async (e) => {
        const expires = mutation === 'expired' ? Date.now() + 300 : Date.now() + 15_000;
        const grant = e.issue(expires);
        const call = runSDK(e.owner, grant);
        await seen.promise;
        await nothing(e);
        let stop;
        if (mutation === 'control') {
          await e.page.locator('button').evaluate((el) => el.replaceWith(el.cloneNode(true)));
        }
        if (mutation === 'disabled') {
          await e.owner.control.evaluate((el) => {
            el.disabled = true;
          });
        }
        if (mutation === 'record') {
          await e.page.locator('section').evaluate((el) => el.replaceWith(el.cloneNode(true)));
        }
        if (mutation === 'document') {
          await e.page.reload();
        }
        if (mutation === 'session') {
          e.owner.changeSession();
        }
        if (mutation === 'expired') {
          await delay(Math.max(0, expires - Date.now() + 5));
        }
        if (mutation === 'stop') {
          stop = e.owner.stop();
          try {
            await Promise.race([
              stop,
              delay(2000, undefined, { ref: false }).then(() => {
                throw new Error('Stop waited for the pending approval.');
              }),
            ]);
            assert.equal(e.owner.state().cleanup, 'completed');
          } finally {
            pending.resolve(true);
          }
        }
        pending.resolve(true);
        if (stop) {
          const result = await call.settled;
          assert.ok(result.error);
          await stop;
          assert.deepEqual(e.owner.state().current, { status: 'interrupted', effect: 'none' });
        } else {
          await done(e.owner, call, 'refused');
        }
        assert.equal(e.owner.stats.requests, 0);
        assert.equal(e.requests.length, 0);
      },
      {
        approve: async (metadata) => {
          assert.deepEqual(Object.keys(metadata).toSorted(), ['count', 'label', 'sha256']);
          seen.resolve();
          return pending.promise;
        },
      },
    );
  }
  for (const mode of [
    'truncate',
    'lost-final-chunk',
    'held-body',
    'held-headers',
    'slow-body',
    'slow-headers',
  ]) {
    for (const mutation of mode.startsWith('held')
      ? ['stop', 'control', 'document', 'session', 'expired']
      : ['end']) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
      await scenario(`${mode}-${mutation}`, mode, async (e) => {
        let lifetime = 15_000;
        if (mutation === 'expired') {
          lifetime = 500;
        } else if (mode.startsWith('slow')) {
          lifetime = 1500;
        }
        const expires = Date.now() + lifetime;
        const grant = e.issue(expires);
        const call = runSDK(e.owner, grant);
        await e.requestEntered.promise;
        if (mode.includes('body') || mode === 'truncate' || mode === 'lost-final-chunk') {
          await waitFor(() => e.owner.stats.peakFileBytes >= 8192);
          const files = await readdir(e.owner.quarantine);
          assert.equal(files.length, 1);
          const mid = await stat(path.join(e.owner.quarantine, files[0]));
          assert.ok(mid.size >= 8192 && mid.size <= 65_536, 'actual quarantine bounds during held stream');
        }
        let hasStopped = false;
        let stopping;
        if (mutation === 'stop') {
          const beforeStop = e.owner.state().current;
          assert.equal(beforeStop.effect, 'unknown');
          assert.ok(['in_progress', 'unknown'].includes(beforeStop.status));
          stopping = e.owner.stop().then(() => {
            hasStopped = true;
          });
          assert.equal(JSON.parse(await e.owner.download({ grant_id: grant.grant_id })).status, 'refused');
          await stopping;
          assert.equal(hasStopped, true);
          const expected = beforeStop.status === 'in_progress' ? 'interrupted' : 'unknown';
          assert.deepEqual(e.owner.state().current, { status: expected, effect: 'unknown' }, mode);
          const exposed = e.owner.state();
          exposed.current.effect = 'completed';
          exposed.recent.length = 0;
          const read = runSDK(e.owner, null, {}, true);
          const statusRead = await read.settled;
          assert.ok(!statusRead.error);
          const replay = read.bodies[1].input.find((item) => item.type === 'function_call_output');
          assert.deepEqual(JSON.parse(replay.output), e.owner.state());
          assert.equal(e.owner.state().current.effect, 'unknown');
          assert.equal(e.owner.state().cleanup, 'completed');
          e.bodyRelease.resolve();
          const result = await call.settled;
          assert.ok(result.error);
        } else {
          if (mutation === 'control') {
            await e.owner.control.evaluate((el) => {
              el.disabled = true;
            });
          }
          if (mutation === 'document') {
            await e.page.reload();
          }
          if (mutation === 'session') {
            e.owner.changeSession();
          }
          if (mutation === 'expired') {
            await delay(Math.max(0, expires - Date.now() + 5));
          }
          if (!mode.startsWith('slow') && mutation !== 'expired') {
            e.bodyRelease.resolve();
          }
          await done(e.owner, call, 'unknown');
        }
        await retired(e, grant);
      });
    }
  }
  await scenario(
    'browser-download-remains-blocked',
    'positive',
    async (e) => {
      await e.page.evaluate(() => {
        const a = document.createElement('a');
        a.href = '/unsolicited';
        a.download = 'UNTRUSTED_NAME';
        document.body.append(a);
        a.click();
      });
      await waitFor(() => e.blocked() === 1);
      await safeRefusal(e, { grant_id: 'browser-download-is-not-a-grant' });
    },
    { enabled: false },
  );
  await scenario('failed-close-retains-uncertain-transfer', 'wrong-digest', async (e) => {
    const grant = e.issue();
    const openFile = fileIO.open;
    fileIO.open = async (...args) => {
      const handle = await openFile(...args);
      if (String(args[0]).startsWith(e.owner.quarantine + path.sep)) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          throw new Error('SYNTHETIC_PRIVATE_CLOSE_DETAIL');
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      const call = runSDK(e.owner, grant);
      const settled = await call.settled;
      assert.ok(settled.error);
    } finally {
      fileIO.open = openFile;
      syncBuiltinESMExports();
    }
    const first = e.owner.state();
    assert.deepEqual(first.current, { status: 'unknown', effect: 'unknown' });
    assert.equal(first.cleanup, 'pending');
    assert.throws(() => e.issue());
    assert.equal(JSON.parse(await e.owner.download({ grant_id: grant.grant_id })).status, 'refused');
    assert.deepEqual(e.owner.state().current, first.current);
    assert.ok(!JSON.stringify(e.owner.state()).includes('SYNTHETIC_PRIVATE_CLOSE_DETAIL'));
    await e.owner.stop();
    assert.equal(e.owner.state().cleanup, 'completed');
    assert.equal(e.owner.stats.requests, 1);
  });
  console.log(
    JSON.stringify(
      {
        checks: receipts,
        apiRequests: 0,
        runtime: {
          node: process.version,
          playwright: require('playwright/package.json').version,
          chromium: browser.version(),
        },
        limits:
          'Application bytes read <=65537; owned-file writes <=65536. Node HTTP parser and TCP/kernel may prebuffer more. No browser early-temp or OS/network hard-cap claim.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
