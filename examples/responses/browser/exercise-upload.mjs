import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, appendFile, mkdir, rename, symlink, lstat, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { newUploadOwner, digest } from './file-upload.mjs';

const require = createRequire(import.meta.url);

const html = await readFile(new URL('file-upload.html', import.meta.url));
const serverReceipts = [];
const scenarios = [];
const bytes = Buffer.from('PRIVATE_SYNTHETIC_DOCUMENT_only_fixture_16\n');
const newBytes = Buffer.from('REPLACED_DO_NOT_SUBSTITUTE\n');
const deferred = () => {
  let release;
  // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
};
const server = createServer(async (req, res) => {
  if (req.url === '/fixture') {
    return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  }
  if (req.url === '/uploaded' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    serverReceipts.push({ count: body.length, sha256: digest(body) });
    return res.end('Received');
  }
  if (req.url === '/unsolicited') {
    return res
      .writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="../../SUGGESTED_PRIVATE_FILE"',
      })
      .end(bytes);
  }
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  },
});

function ordinary(owner, permitted, suppliedArgs, readState = false) {
  const callArgs = suppliedArgs === undefined ? { grant_id: permitted?.grant_id } : suppliedArgs;
  const bodies = [];
  const client = new OpenAI({
    apiKey: 'synthetic-unused',
    baseURL: 'http://fixture.invalid/v1',
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert.ok(bodies.length <= 2, 'no upload retry');
      const output =
        bodies.length === 1
          ? [
              {
                type: 'function_call',
                name: readState ? 'file_status' : 'upload',
                call_id: 'transfer-one',
                status: 'completed',
                arguments: JSON.stringify(readState ? {} : callArgs),
              },
            ]
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
          name: 'upload',
          description: 'Upload the approved fixture document.',
          strict: true,
          parameters: {
            type: 'object',
            properties: { grant_id: { type: 'string' } },
            required: ['grant_id'],
            additionalProperties: false,
          },
        },
        execute: (args) => owner.upload(args),
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
  const task = runner.run(
    client,
    { model: '', input: 'Use the approved document.', store: false },
    // A status read is a separate, explicitly authorized run after Stop.
    { maxSteps: 3, signal: readState ? undefined : owner.abort.signal },
  );
  // A rejection handler is attached immediately while the test holds approval or native input.
  // oxlint-disable-next-line promise/prefer-await-to-then -- Register ownership or rejection handling before a held operation can reenter.
  const settlement = task.then(
    (value) => ({ value }),
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection immediately while the fixture holds the operation.
    (error) => ({ error }),
  );
  return { settlement, bodies };
}

async function run(
  name,
  body,
  suppliedConfig,
  confirm = async () => true,
  afterStat = async () => {
    // No read-boundary hook unless the case supplies one.
  },
) {
  const config = suppliedConfig === undefined ? { allowUpload: true } : suppliedConfig;
  const context = await browser.newContext({
    viewport: { width: 1024, height: 720 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const page = await context.newPage();
  let blocked = 0;
  page.on('download', async (download) => {
    await download.cancel();
    blocked += 1;
  });
  await page.goto(url);
  const owner = await newUploadOwner(
    page,
    {
      ...config,
      record: await page.locator('[data-record-id="transfer-case"]').elementHandle(),
      control: await page.locator('input[type=file]').elementHandle(),
      recordId: 'transfer-case',
    },
    confirm,
    afterStat,
  );
  const start = serverReceipts.length;
  const deliveries = [];
  const method = owner.control.setInputFiles.bind(owner.control);
  let fault = async (payload) => method(payload);
  owner.control.setInputFiles = async (payload) => {
    deliveries.push({ count: payload.buffer.length, sha256: digest(payload.buffer) });
    return fault(payload);
  };
  try {
    const earlierReceipt = await body({
      context,
      page,
      owner,
      deliveries,
      start,
      fault: (value) => {
        fault = value;
      },
      method,
      blocked: () => blocked,
    });
    const receipt = owner.receipt();
    // Function receipts must contain no path, file name, control ID, file contents or browser errors.
    const rendered = JSON.stringify([receipt, owner.state()]);
    for (const secret of [
      owner.area,
      'approved.bin',
      'f_',
      bytes.toString(),
      newBytes.toString(),
      'SUGGESTED_PRIVATE_FILE',
      'file:',
      'http:',
      'Error',
      'input[type=file]',
    ]) {
      assert.ok(!rendered.includes(secret), `${name}: private receipt ${secret}`);
    }
    scenarios.push({
      name,
      firstDelivery: deliveries,
      endpoint: serverReceipts.slice(start),
      earlierReceipt,
      lastCallReceipt: receipt,
      blocked,
    });
  } finally {
    await owner.stop();
    assert.equal(owner.state().cleanup, 'completed');
    await context.close();
    await assert.rejects(access(owner.area), 'owner must remove only its private staging');
  }
}

async function source(owner, content = bytes) {
  const name = owner.generatedName();
  await writeFile(path.join(owner.uploadRoot, name), content, { mode: 0o600, flag: 'wx' });
  return name;
}
async function grant(owner, name, expiry = Date.now() + 20_000) {
  return owner.prepare(owner.uploadRoot, name, expiry);
}
async function endpoint(page, expected) {
  await page.waitForFunction(() => document.querySelector('#result')?.textContent === 'Received', {
    timeout: 2000,
  });
  assert.deepEqual(serverReceipts.at(-1), { count: expected.length, sha256: digest(expected) });
}
function noTransfer(check) {
  assert.equal(check.deliveries.length, 0, 'first renderer/Playwright delivery');
  assert.equal(serverReceipts.length, check.start, 'fixture endpoint received bytes');
}
async function accepted(check, supplied) {
  const call = ordinary(check.owner, supplied);
  const result = await call.settlement;
  assert.ok(!result.error, result.error?.message);
  await endpoint(check.page, bytes);
  assert.equal(call.bodies.length, 2);
  const receipt = JSON.parse(
    call.bodies[1].input.find((candidate) => candidate.type === 'function_call_output').output,
  );
  assert.deepEqual(receipt, {
    status: 'completed',
    attempted: true,
    completed: true,
    count: bytes.length,
    sha256: digest(bytes),
  });
  assert.equal(check.deliveries.length, 1);
  assert.deepEqual(check.owner.state().current, { status: 'completed', effect: 'completed' });
  assert.equal(check.owner.state().cleanup, 'not_started');
  return receipt;
}
async function denied(check, supplied, args) {
  const result = await ordinary(check.owner, supplied, args).settlement;
  assert.ok(!result.error, result.error?.message);
  assert.deepEqual(check.owner.receipt(), { status: 'refused', attempted: false, completed: false });
  noTransfer(check);
}

try {
  const copiedConfig = { allowUpload: true };
  await run(
    'positive, detached label, copied allow and no grant reuse',
    async (check) => {
      copiedConfig.allowUpload = false;
      const configName = await source(check.owner);
      const permitted = await grant(check.owner, configName);
      permitted.label = '../../SUGGESTED_PRIVATE_FILE\u0000';
      const firstReceipt = await accepted(check, permitted);
      assert.equal(JSON.parse(await check.owner.upload({ grant_id: permitted.grant_id })).status, 'refused');
      assert.equal(check.deliveries.length, 1);
      return firstReceipt;
    },
    copiedConfig,
  );
  const copiedDenial = { allowUpload: false };
  await run(
    'copied denial cannot acquire permission later',
    async (check) => {
      copiedDenial.allowUpload = true;
      await assert.rejects(
        grant(check.owner, await source(check.owner)),
        /^Error: File preparation refused\.$/u,
      );
      noTransfer(check);
    },
    copiedDenial,
  );
  await run(
    'default configuration denies all',
    async (check) => {
      const name = await source(check.owner);
      await assert.rejects(grant(check.owner, name), /^Error: File preparation refused\.$/u);
      noTransfer(check);
    },
    null,
  );
  for (const input of [
    '../outside',
    '/tmp/PRIVATE',
    '\\\\remote\\share',
    'file:///tmp/P',
    'https://host/P',
    '..',
    'x/y',
    `f_${'0'.repeat(24)}\u0000`,
    'CON',
    `f_${'0'.repeat(3000)}`,
    42,
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await run(`lexical_${scenarios.length}`, async (check) => {
      await assert.rejects(
        check.owner.prepare(check.owner.uploadRoot, input, Date.now() + 20_000),
        /^Error: File preparation refused\.$/u,
      );
      noTransfer(check);
    });
  }
  for (const variant of [
    'outside-root',
    'quarantine-root',
    'symlink-file',
    'symlink-root',
    'directory',
    'fifo',
    'oversized',
    'expiry-in-past',
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await run(variant, async (check) => {
      const { owner } = check;
      const name = owner.generatedName();
      let root = owner.uploadRoot;
      let expiry = Date.now() + 20_000;
      const target = path.join(root, name);
      if (variant === 'outside-root') {
        root = owner.area;
      } else if (variant === 'quarantine-root') {
        root = owner.quarantine;
      } else if (variant === 'symlink-file') {
        const existing = await source(owner);
        await symlink(path.join(root, existing), target);
      } else if (variant === 'symlink-root') {
        await rename(root, path.join(owner.area, 'saved'));
        await symlink(path.join(owner.area, 'saved'), root);
        await writeFile(target, bytes);
      } else if (variant === 'directory') {
        await mkdir(target);
      } else if (variant === 'fifo') {
        const child = spawn('/usr/bin/mkfifo', [target], { stdio: 'ignore' });
        const [rc] = await once(child, 'exit');
        assert.equal(rc, 0);
        const fifo = await lstat(target);
        assert.ok(fifo.isFIFO());
      } else if (variant === 'oversized') {
        await writeFile(target, Buffer.alloc(65_537));
      } else if (variant === 'expiry-in-past') {
        await writeFile(target, bytes);
        expiry = Date.now() - 1;
      }
      await assert.rejects(owner.prepare(root, name, expiry), /^Error: File preparation refused\.$/u);
      noTransfer(check);
    });
  }
  let growing;
  await run(
    'file grows after fstat; bounded read detects overflow',
    async (check) => {
      growing = path.join(check.owner.uploadRoot, await source(check.owner));
      await assert.rejects(
        grant(check.owner, path.basename(growing)),
        /^Error: File preparation refused\.$/u,
      );
      noTransfer(check);
    },
    { allowUpload: true },
    async () => true,
    () => appendFile(growing, Buffer.alloc(65_536)),
  );

  for (const decision of [false, null, 'true', 1, {}, []]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await run(
      `strict approval_${scenarios.length}`,
      async (check) => {
        await denied(check, await grant(check.owner, await source(check.owner)));
      },
      { allowUpload: true },
      async () => decision,
    );
  }
  for (const action of [
    'replace-source',
    'replace-control',
    'replace-record',
    'changed-record',
    'new-document',
    'new-session',
    'expiry-held',
    'cancel-held',
    'extra-model-args',
  ]) {
    const approval = deferred();
    const seen = deferred();
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await run(
      action,
      async (check) => {
        const { owner, page } = check;
        const name = await source(owner);
        const expiry = action === 'expiry-held' ? Date.now() + 200 : Date.now() + 20_000;
        const permitted = await grant(owner, name, expiry);
        if (action === 'extra-model-args') {
          await denied(check, permitted, { grant_id: permitted.grant_id, path: '/tmp/PRIVATE' });
          return;
        }
        const call = ordinary(owner, permitted);
        await seen.promise;
        noTransfer(check);
        let stopping;
        if (action === 'replace-source') {
          await rename(path.join(owner.uploadRoot, name), path.join(owner.area, 'old'));
          await writeFile(path.join(owner.uploadRoot, name), newBytes);
        }
        if (action === 'replace-control') {
          await page.evaluate(() => {
            const el = document.querySelector('input');
            el.replaceWith(el.cloneNode(true));
          });
        }
        if (action === 'replace-record') {
          await page.evaluate(() => {
            const row = document.querySelector('section');
            row.replaceWith(row.cloneNode(true));
          });
        }
        if (action === 'changed-record') {
          await page.evaluate(() => {
            document.querySelector('section').dataset.recordId = 'other';
          });
        }
        if (action === 'new-document') {
          await page.reload();
        }
        if (action === 'new-session') {
          owner.changeSession();
        }
        if (action === 'expiry-held') {
          await delay(Math.max(0, expiry - Date.now() + 20));
        }
        if (action === 'cancel-held') {
          stopping = owner.stop();
          try {
            await Promise.race([
              stopping,
              delay(2000, undefined, { ref: false }).then(() => {
                throw new Error('Stop waited for the pending approval.');
              }),
            ]);
            await assert.rejects(access(owner.area));
          } finally {
            approval.resolve(true);
          }
        }
        approval.resolve(true);
        const result = await call.settlement;
        if (action === 'cancel-held') {
          assert.ok(result.error);
          await stopping;
        } else {
          assert.ok(!result.error, result.error?.message);
        }
        if (action === 'replace-source') {
          await endpoint(page, bytes);
          assert.deepEqual(check.deliveries, [{ count: bytes.length, sha256: digest(bytes) }]);
        } else {
          noTransfer(check);
        }
      },
      { allowUpload: true },
      async (snapshot) => {
        assert.deepEqual(Object.keys(snapshot).toSorted(), ['count', 'label', 'sha256']);
        seen.resolve();
        return approval.promise;
      },
    );
  }

  for (const action of [
    'lost-before-native',
    'lost-after-native',
    'cancel-before-native',
    'cancel-after-native',
    'replace-control-before-native',
    'replace-control-after-native',
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
    await run(action, async (check) => {
      const { owner, page, method } = check;
      const entered = deferred();
      const release = deferred();
      check.fault(async (payload) => {
        if (action.endsWith('after-native')) {
          await method(payload);
          await endpoint(page, bytes);
        }
        entered.resolve();
        await release.promise;
        if (action.startsWith('lost')) {
          throw new Error('PRIVATE_PLAYWRIGHT_PATH');
        }
        if (action.endsWith('before-native')) {
          await method(payload);
        }
      });
      const permitted = await grant(owner, await source(owner));
      const call = ordinary(owner, permitted);
      await entered.promise;
      assert.equal(check.deliveries.length, 1, 'payload already handed to Playwright boundary');
      assert.deepEqual(owner.state().current, { status: 'in_progress', effect: 'unknown' });
      let stopped = false;
      let stopping;
      if (action.startsWith('cancel')) {
        stopping = owner.stop().then(() => {
          stopped = true;
        });
        await Promise.resolve();
        assert.equal(stopped, false, 'Stop must drain pending native operation');
        assert.equal(owner.state().cleanup, 'pending');
        for (let i = 0; i < 35; i += 1) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Each rejection must settle before inspecting the bounded owner history.
          assert.equal(JSON.parse(await owner.upload({ grant_id: permitted.grant_id })).status, 'refused');
        }
        assert.deepEqual(owner.state().current, { status: 'in_progress', effect: 'unknown' });
        assert.equal(owner.state().earlier_omitted, true);
        assert.equal(owner.state().recent.length, 32);
      }
      if (action.startsWith('replace-control')) {
        await page.evaluate(() => {
          const original = document.querySelector('input');
          original.replaceWith(original.cloneNode(true));
        });
      }
      release.resolve();
      const outcome = await call.settlement;
      if (stopping) {
        assert.ok(outcome.error);
        await stopping;
      } else {
        assert.ok(!outcome.error, outcome.error?.message);
      }
      assert.deepEqual(owner.receipt(), { status: 'unknown', attempted: true, completed: false });
      assert.deepEqual(owner.state().current, {
        status: stopping ? 'interrupted' : 'unknown',
        effect: 'unknown',
      });
      if (stopping) {
        const exposed = owner.state();
        exposed.current.status = 'completed';
        exposed.recent[0].status = 'completed';
        exposed.recent.length = 0;
        const read = ordinary(owner, null, {}, true);
        const result = await read.settlement;
        assert.ok(!result.error);
        const replay = read.bodies[1].input.find((item) => item.type === 'function_call_output');
        assert.deepEqual(JSON.parse(replay.output), owner.state());
        assert.equal(owner.state().current.status, 'interrupted');
        assert.equal(owner.state().cleanup, 'completed');
      }
      assert.equal(JSON.parse(await owner.upload({ grant_id: permitted.grant_id })).status, 'refused');
      assert.equal(check.deliveries.length, 1);
      if (action === 'lost-before-native') {
        assert.equal(serverReceipts.length, check.start);
      } else if (action === 'replace-control-before-native') {
        // The already-admitted Playwright call may still fire the detached original
        // control's change handler. It may not fill the replacement or retry.
        const received = serverReceipts.slice(check.start);
        assert.ok(received.length <= 1);
        if (received.length) {
          assert.deepEqual(received[0], { count: bytes.length, sha256: digest(bytes) });
        }
        assert.equal(await page.locator('input').evaluate((el) => el.files.length), 0);
      } else {
        await endpoint(page, bytes);
        assert.equal(serverReceipts.length, check.start + 1);
      }
    });
  }

  await run('unsolicited download cancelled; no automatic grant', async (check) => {
    await check.page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/unsolicited';
      a.download = 'SUGGESTED_PRIVATE_FILE';
      document.body.append(a);
      a.click();
    });
    for (let index = 0; index < 100 && !check.blocked(); index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
      await delay(20);
    }
    assert.equal(check.blocked(), 1);
    await denied(check, { grant_id: 'untrusted-download' });
  });
  console.log(
    JSON.stringify(
      {
        checks: scenarios,
        sdkRequests: 'fake transport only; max2 per run',
        apiRequests: 0,
        runtime: {
          node: process.version,
          playwright: require('playwright/package.json').version,
          chromium: browser.version(),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
  await new Promise((resolve) => {
    server.close(resolve);
  });
}
