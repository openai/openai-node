// Local CDP and caller-bound file controls, with two independent local source services.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { createBrowserDriver } from './driver.mjs';
import { newUploadOwner } from './file-upload.mjs';
import { newDownloadOwner, digest } from './file-download.mjs';

const pageHTML = `<!doctype html><title>Archive desk</title>
<section data-record-id="LETTER-847"><input type=file aria-label="Attach manuscript"></section>
<section data-record-id="SCAN-619"><button>Retrieve signed scan</button></section>`;
const content = Buffer.from('Local manuscript '.repeat(3600));
const confirm = async () => true;
const execute = async (tools, member, grantId) => {
  const result = await tools.execute({
    type: 'function_call',
    status: 'completed',
    id: 'portable',
    call_id: 'portable',
    name: `browser_${member}`,
    arguments: JSON.stringify({ grant_id: grantId }),
  });
  return JSON.parse(result.output[0].text);
};
const sources = [];
let launched;
try {
  for (let index = 0; index < 2; index += 1) {
    const source = { requests: [], arrived: Promise.withResolvers(), release: Promise.withResolvers() };
    const server = createServer(async (request, response) => {
      if (request.url === '/desk') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(pageHTML);
        return;
      }
      source.requests.push({ url: request.url, headers: request.headers });
      source.arrived.resolve();
      const [mode] = request.url.split('?');
      if (mode === '/redirect') {
        response.writeHead(302, { location: '/scan?should-not-fetch' }).end();
        return;
      }
      const data = mode === '/large' ? Buffer.alloc(65_536 + 2048, 'x') : content;
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'identity' });
      if (mode === '/stall') {
        response.write(data.subarray(0, 8192));
        await source.release.promise;
        response.end(data.subarray(8192));
      } else {
        response.end(data);
      }
    });
    server.listen(0, '127.0.0.1');
    // oxlint-disable-next-line eslint/no-await-in-loop -- Record each live server for cleanup before attempting the next listen.
    await once(server, 'listening');
    Object.assign(source, { server, origin: `http://127.0.0.1:${server.address().port}` });
    sources.push(source);
  }
  const allocator = createServer();
  allocator.listen(0, '127.0.0.1');
  await once(allocator, 'listening');
  const { port } = allocator.address();
  allocator.close();
  await once(allocator, 'close');
  launched = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    args: [`--remote-debugging-port=${port}`],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR'].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
    ),
  });
  const attached = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = await attached.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  const pageURL = `${sources[0].origin}/desk`;
  const driver = createBrowserDriver(context, { ownedFixture: { urls: [pageURL], publicViewports: [] } });
  await driver.new_tab({ url: pageURL });
  const [page] = context.pages();
  let held = false;
  let offered = Promise.withResolvers();
  let consent = Promise.withResolvers();
  const approve = async () => {
    offered.resolve();
    if (held) {
      await consent.promise;
    }
    return true;
  };
  const upload = await newUploadOwner(
    page,
    {
      allowUpload: true,
      record: await page.locator('[data-record-id="LETTER-847"]').elementHandle(),
      control: await page.locator('input').elementHandle(),
      recordId: 'LETTER-847',
    },
    approve,
  );
  try {
    assert.equal(path.dirname(upload.area), tmpdir());
    const name = upload.generatedName();
    await writeFile(path.join(upload.uploadRoot, name), 'Archive from this run', { mode: 0o600, flag: 'wx' });
    const grant = await upload.prepare(upload.uploadRoot, name, Date.now() + 30_000);
    const tools = new BrowserToolset(
      {
        state: driver.state.bind(driver),
        upload_file: upload.upload_file.bind(upload),
      },
      { members: ['upload_file'], confirm },
    );
    const wrong = await execute(tools, 'upload_file', 'wrong');
    assert.equal(wrong.ok, false);
    const result = await execute(tools, 'upload_file', grant.grant_id);
    assert.deepEqual(result.result, {
      version: 1,
      status: 'completed',
      effect: 'completed',
      cleanup: 'not_started',
    });
    assert.equal(result.ok, true);
    assert.equal(await upload.control.evaluate((element) => element.files.length), 1);
    const replayed = await execute(tools, 'upload_file', grant.grant_id);
    assert.equal(replayed.ok, false);
  } finally {
    await upload.stop();
  }
  await assert.rejects(access(upload.area), { code: 'ENOENT' });

  // Construction must keep the caller's original scalar permissions and handles.
  /* oxlint-disable eslint/no-await-in-loop -- These cases share the same real CDP page, controls and approval gates. Each must finish and remove its staging before the next case changes those controls. */
  for (const [direction, timing] of ['upload', 'download'].flatMap((directionCase) =>
    ['during', 'after'].map((timingCase) => [directionCase, timingCase]),
  )) {
    const sending = direction === 'upload';
    const control = await page.locator(sending ? 'input' : 'button').elementHandle();
    if (sending) {
      await control.setInputFiles([]);
    }
    const recordId = sending ? 'LETTER-847' : 'SCAN-619';
    const releaseChild = Promise.withResolvers();
    let child;
    const owner = await (sending ? newUploadOwner : newDownloadOwner)(
      page,
      {
        [sending ? 'allowUpload' : 'allowDownload']: true,
        recordId,
        control,
        record: await page.locator(`[data-record-id="${recordId}"]`).elementHandle(),
      },
      async () => {
        await Promise.resolve();
        if (timing === 'during') {
          await owner.stop();
          assert.equal(owner.state().cleanup, 'pending');
        } else {
          child = (async () => {
            await releaseChild.promise;
            await owner.stop();
          })();
        }
        return true;
      },
    );
    const before = sources[0].requests.length;
    try {
      let grant;
      if (sending) {
        const name = owner.generatedName();
        await writeFile(path.join(owner.uploadRoot, name), content, { flag: 'wx', mode: 0o600 });
        grant = await owner.prepare(owner.uploadRoot, name, Date.now() + 30_000);
      } else {
        grant = owner.issue(
          {
            url: `${sources[0].origin}/scan?signature=local-child`,
            count: content.length,
            sha256: digest(content),
          },
          Date.now() + 30_000,
        );
      }
      const result = await owner[`${direction}_file`]({ grant_id: grant.grant_id });
      assert.equal(result.status, timing === 'during' ? 'interrupted' : 'completed');
      assert.equal(result.effect, timing === 'during' ? 'none' : 'completed');
      if (timing === 'after') {
        assert.equal(owner.state().cleanup, 'not_started');
        assert.ok(child);
        releaseChild.resolve();
        await child;
      }
      assert.equal(owner.state().cleanup, 'completed');
      assert.equal(sources[0].requests.length, before + (!sending && timing === 'after' ? 1 : 0));
      if (sending) {
        assert.equal(await control.evaluate((el) => el.files.length), timing === 'during' ? 0 : 1);
      }
      await assert.rejects(access(owner.area), { code: 'ENOENT' });
    } finally {
      releaseChild.resolve();
      await child;
      await owner.stop();
    }
  }
  for (const direction of ['upload', 'download']) {
    for (const changed of ['permission', 'binding']) {
      const uploadDirection = direction === 'upload';
      const record = await page
        .locator(`[data-record-id="${uploadDirection ? 'LETTER-847' : 'SCAN-619'}"]`)
        .elementHandle();
      const control = await page.locator(uploadDirection ? 'input' : 'button').elementHandle();
      const otherRecord = await page
        .locator(`[data-record-id="${uploadDirection ? 'SCAN-619' : 'LETTER-847'}"]`)
        .elementHandle();
      const otherControl = await page.locator(uploadDirection ? 'button' : 'input').elementHandle();
      const flag = uploadDirection ? 'allowUpload' : 'allowDownload';
      const configuration = {
        [flag]: changed !== 'permission',
        record: changed === 'binding' ? otherRecord : record,
        control: changed === 'binding' ? otherControl : control,
        recordId: uploadDirection ? 'LETTER-847' : 'SCAN-619',
      };
      const creating = (uploadDirection ? newUploadOwner : newDownloadOwner)(page, configuration, approve);
      Object.assign(configuration, {
        [flag]: true,
        record,
        control,
        recordId: uploadDirection ? 'LETTER-847' : 'SCAN-619',
      });
      const owner = await creating;
      try {
        if (uploadDirection) {
          const name = owner.generatedName();
          await writeFile(path.join(owner.uploadRoot, name), content, { mode: 0o600, flag: 'wx' });
          if (changed === 'permission') {
            await assert.rejects(owner.prepare(owner.uploadRoot, name, Date.now() + 30_000));
          } else {
            const grant = await owner.prepare(owner.uploadRoot, name, Date.now() + 30_000);
            const outcome = await owner.upload_file({ grant_id: grant.grant_id });
            assert.equal(outcome.status, 'refused');
          }
        } else {
          const source = { url: `${sources[0].origin}/scan`, count: content.length, sha256: digest(content) };
          if (changed === 'permission') {
            assert.throws(() => owner.issue(source, Date.now() + 30_000));
          } else {
            const grant = owner.issue(source, Date.now() + 30_000);
            const outcome = await owner.download_file({ grant_id: grant.grant_id });
            assert.equal(outcome.status, 'refused');
          }
        }
      } finally {
        await owner.stop();
        await assert.rejects(access(owner.area), { code: 'ENOENT' });
      }
    }
  }

  for (const [index, source] of sources.entries()) {
    for (const mode of [
      'scan',
      'digest',
      'large',
      'redirect',
      'stall',
      'replaced',
      'expired',
      'stop-approval',
      'stop-admitted',
    ]) {
      held = false;
      offered = Promise.withResolvers();
      consent = Promise.withResolvers();
      source.arrived = Promise.withResolvers();
      source.release = Promise.withResolvers();
      const record = await page.locator('[data-record-id="SCAN-619"]').elementHandle();
      const control = await page.locator('button').elementHandle();
      const download = await newDownloadOwner(
        page,
        { allowDownload: true, record, control, recordId: 'SCAN-619' },
        approve,
      );
      const before = source.requests.length;
      try {
        let sourceMode = mode;
        if (mode === 'stop-admitted') {
          sourceMode = 'stall';
        } else if (['digest', 'replaced', 'expired', 'stop-approval'].includes(mode)) {
          sourceMode = 'scan';
        }
        const metadata = {
          url: `${source.origin}/${sourceMode}?signature=local-${index}`,
          count: content.length,
          sha256: mode === 'digest' ? '0'.repeat(64) : digest(content),
        };
        if (mode === 'scan') {
          for (const url of [
            `${source.origin.replace('127.0.0.1', 'localhost')}/scan`,
            `${source.origin.replace('127.0.0.1', '@127.0.0.1')}/scan`,
            `${metadata.url}#fragment`,
            'https://user:secret@example.test/a',
            'ftp://127.0.0.1/scan',
            'https:user:secret@example.test/a',
            'https:/user:secret@example.test/a',
            'https:@example.test/a',
            'https:/@example.test/a',
            'https:example.test/a',
            'https:/example.test/a',
          ]) {
            assert.throws(() => download.issue({ ...metadata, url }, Date.now() + 30_000));
          }
        }
        const grant = download.issue(metadata, Date.now() + (mode === 'expired' ? 60 : 30_000));
        Object.assign(metadata, { url: 'http://127.0.0.1:1/changed', count: 0, sha256: '1'.repeat(64) });
        const tools = new BrowserToolset(
          {
            state: driver.state.bind(driver),
            download_file: download.download_file.bind(download),
          },
          { members: ['download_file'], confirm },
        );
        if (mode === 'expired') {
          await delay(80);
        }
        if (mode === 'replaced') {
          await control.evaluate((el) => el.replaceWith(el.cloneNode(true)));
        }
        let result;
        if (mode === 'scan') {
          held = true;
          const pending = execute(tools, 'download_file', grant.grant_id);
          try {
            await offered.promise;
            await assert.rejects(execute(tools, 'download_file', grant.grant_id), {
              name: 'TypeError',
              message: 'Helper is busy.',
            });
            const refused = await download.download_file({ grant_id: grant.grant_id });
            assert.deepEqual([refused.status, refused.effect], ['refused', 'none']);
          } finally {
            consent.resolve();
            result = await pending;
          }
        } else if (mode.startsWith('stop-')) {
          held = mode === 'stop-approval';
          const pending = download.download_file({ grant_id: grant.grant_id });
          await (held ? offered.promise : source.arrived.promise);
          const busy = download.download_file({ grant_id: grant.grant_id });
          const stopping = download.stop();
          const prior = await busy;
          assert.deepEqual([prior.status, prior.effect], ['refused', 'none']);
          consent.resolve();
          result = await pending;
          await stopping;
          assert.deepEqual([result.status, result.effect], ['interrupted', held ? 'none' : 'unknown']);
          assert.deepEqual([prior.status, prior.effect], ['refused', 'none']);
          assert.equal(source.requests.length - before, held ? 0 : 1);
          continue;
        } else if (mode === 'stall') {
          const controller = new AbortController();
          const pending = download.download_file({ grant_id: grant.grant_id }, { signal: controller.signal });
          await source.arrived.promise;
          controller.abort();
          result = await pending;
          assert.deepEqual(result, {
            version: 1,
            status: 'interrupted',
            effect: 'unknown',
            cleanup: 'not_started',
          });
          continue;
        } else {
          result = await execute(tools, 'download_file', grant.grant_id);
        }
        if (mode === 'scan') {
          assert.equal(result.ok, true);
          assert.equal(result.result.effect, 'completed');
          const replayed = await execute(tools, 'download_file', grant.grant_id);
          assert.equal(replayed.ok, false);
        } else {
          assert.equal(result.ok, false);
          assert.equal(result.result.effect, ['expired', 'replaced'].includes(mode) ? 'none' : 'unknown');
        }
        assert.equal(source.requests.length - before, ['expired', 'replaced'].includes(mode) ? 0 : 1);
        assert.doesNotMatch(JSON.stringify(result), /signature|sha256/u);
        assert.ok(download.stats.readBytes <= 65_537);
      } finally {
        consent.resolve();
        source.release.resolve();
        await download.stop();
        assert.equal(download.state().cleanup, 'completed');
        await assert.rejects(access(download.area), { code: 'ENOENT' });
      }
    }
    for (const { url, headers } of source.requests) {
      assert.match(url, /^\/(?:scan|large|redirect|stall)\?/u);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, undefined);
      assert.equal(headers['accept-encoding'], 'identity');
    }
  }
  for (const admitted of [false, true]) {
    held = !admitted;
    offered = Promise.withResolvers();
    consent = Promise.withResolvers();
    const selected = Promise.withResolvers();
    const released = Promise.withResolvers();
    const record = await page.locator('[data-record-id="LETTER-847"]').elementHandle();
    const control = await page.locator('input').elementHandle();
    await control.setInputFiles([]);
    const original = control.setInputFiles.bind(control);
    control.setInputFiles = async (...args) => {
      await original(...args);
      selected.resolve();
      await released.promise;
    };
    const owner = await newUploadOwner(
      page,
      { allowUpload: true, record, control, recordId: 'LETTER-847' },
      approve,
    );
    try {
      const name = owner.generatedName();
      await writeFile(path.join(owner.uploadRoot, name), content, { mode: 0o600, flag: 'wx' });
      const grant = await owner.prepare(owner.uploadRoot, name, Date.now() + 30_000);
      const pending = owner.upload_file({ grant_id: grant.grant_id });
      await (admitted ? selected.promise : offered.promise);
      const busy = owner.upload_file({ grant_id: grant.grant_id });
      const stopping = owner.stop();
      const prior = await busy;
      assert.deepEqual([prior.status, prior.effect], ['refused', 'none']);
      consent.resolve();
      released.resolve();
      const result = await pending;
      await stopping;
      assert.deepEqual([result.status, result.effect], ['interrupted', admitted ? 'unknown' : 'none']);
      assert.deepEqual([prior.status, prior.effect], ['refused', 'none']);
      assert.equal(await control.evaluate((el) => el.files[0]?.size ?? 0), admitted ? content.length : 0);
    } finally {
      consent.resolve();
      released.resolve();
      await owner.stop();
      await assert.rejects(access(owner.area), { code: 'ENOENT' });
      await original([]);
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  await context.close();
  console.log(
    'PASS Node CDP: SDK opt-in files, two sources, portable IDs, one-use/expiry/concurrent refusal, digest/cap/redirect/cancellation and cleanup',
  );
} finally {
  await launched?.close();
  for (const source of sources) {
    source.release.resolve();
    source.server.closeAllConnections();
    source.server.close();
    // oxlint-disable-next-line eslint/no-await-in-loop -- Retire each owned server before the next cleanup attempt.
    await once(source.server, 'close');
  }
}
