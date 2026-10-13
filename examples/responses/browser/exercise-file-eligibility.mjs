// Finite eligibility reads on ordinary local controls; no external requests.
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { newUploadOwner } from './file-upload.mjs';
import { newDownloadOwner, digest } from './file-download.mjs';

const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  /* oxlint-disable eslint/no-await-in-loop -- Each held read must settle and clean its owner before the next case. */
  for (const direction of ['upload', 'download']) {
    for (const heldRead of direction === 'upload' ? [1, 2, 3] : [1, 2]) {
      for (const cancellation of ['owner', 'caller']) {
        const page = await browser.newPage();
        await page.setContent(
          '<section data-record-id="fixture"><input type=file><button>Result</button></section>',
        );
        const control = await page.locator(direction === 'upload' ? 'input' : 'button').elementHandle();
        const record = await page.locator('section').elementHandle();
        const create = direction === 'upload' ? newUploadOwner : newDownloadOwner;
        let approvals = 0;
        const owner = await create(
          page,
          { record, control, recordId: 'fixture', allowUpload: true, allowDownload: true },
          async () => {
            approvals += 1;
            return true;
          },
        );
        const reached = Promise.withResolvers();
        const released = Promise.withResolvers();
        const live = new AbortController();
        const original = control.evaluate.bind(control);
        const setFiles = control.setInputFiles.bind(control);
        let assignments = 0;
        control.setInputFiles = async (...args) => {
          assignments += 1;
          await setFiles(...args);
        };
        let reads = 0;
        control.evaluate = async (...args) => {
          reads += 1;
          if (reads === heldRead) {
            reached.resolve();
            await released.promise;
            if (heldRead === 3) {
              return true;
            }
            // Simulate the harmless late response from a now-disposed document.
            throw new Error('Late local eligibility response.');
          }
          return original(...args);
        };
        const bytes = Buffer.from('local fixture');
        let grant;
        if (direction === 'upload') {
          const name = owner.generatedName();
          await writeFile(path.join(owner.uploadRoot, name), bytes, { flag: 'wx', mode: 0o600 });
          grant = await owner.prepare(owner.uploadRoot, name, Date.now() + 20_000);
        } else {
          grant = owner.issue(
            { url: 'http://127.0.0.1:1/unused', count: bytes.length, sha256: digest(bytes) },
            Date.now() + 20_000,
          );
        }
        const pending = owner[`${direction}_file`]({ grant_id: grant.grant_id }, { signal: live.signal });
        let stopping;
        try {
          await reached.promise;
          if (cancellation === 'owner') {
            stopping = owner.stop();
          } else {
            live.abort();
          }
          const result = await Promise.race([
            Promise.all([pending, stopping]),
            delay(900).then(() => {
              throw new Error(`Upload/download eligibility read ${heldRead} blocked ${cancellation} Stop.`);
            }),
          ]);
          assert.equal(result[0].status, 'interrupted');
          const attempted = heldRead === 3;
          assert.equal(result[0].effect, attempted ? 'unknown' : 'none');
          assert.equal(approvals, Math.min(heldRead - 1, 1));
          assert.equal(assignments, Number(attempted));
          assert.deepEqual(owner.receipt(), {
            status: attempted ? 'unknown' : 'refused',
            attempted,
            completed: false,
          });
          if (direction === 'download') {
            assert.equal(owner.stats.requests, 0);
          }
          await owner.stop();
          await assert.rejects(access(owner.area), { code: 'ENOENT' });
          released.resolve();
          await delay(0);
          assert.equal(owner.receipt().completed, false);
          assert.equal(owner.state().cleanup, 'completed');
          checks += 1;
        } finally {
          released.resolve();
          await Promise.allSettled([pending, stopping]);
          await owner.stop();
          control.evaluate = original;
          await page.close();
        }
      }
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  console.log(JSON.stringify({ checks, api_calls: 0, vendor_calls: 0 }));
} finally {
  await browser.close();
}
