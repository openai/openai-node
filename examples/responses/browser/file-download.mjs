// Optional example: one explicitly approved local fixture HTTP result.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileState,
  FileCleanupIncompleteError,
  approvingOwner,
  browserOutcome,
  waitForDecision,
  waitForFileCleanup,
} from './file-state.mjs';

const maxBytes = 64 * 1024;
const quantum = 8192;
const refused = () => ({ status: 'refused', attempted: false, completed: false });
const unknown = () => ({ status: 'unknown', attempted: true, completed: false });
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Wait for native backpressure without retaining listeners across read iterations.
function readable(response) {
  // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
  return new Promise((resolve, reject) => {
    const clear = () => {
      // oxlint-disable-next-line eslint/no-use-before-define -- Event cleanup runs only after all referenced callbacks are initialized.
      response.off('readable', ready);
      // oxlint-disable-next-line eslint/no-use-before-define -- Event cleanup runs only after all referenced callbacks are initialized.
      response.off('end', ready);
      // oxlint-disable-next-line eslint/no-use-before-define -- Event cleanup runs only after all referenced callbacks are initialized.
      response.off('close', ready);
      // oxlint-disable-next-line eslint/no-use-before-define -- Event cleanup runs only after all referenced callbacks are initialized.
      response.off('error', fail);
    };
    const ready = () => {
      clear();
      resolve();
    };
    const fail = (error) => {
      clear();
      reject(error);
    };
    response.once('readable', ready);
    response.once('end', ready);
    response.once('close', ready);
    response.once('error', fail);
  });
}

export async function newDownloadOwner(page, configuration, approve) {
  const enabled = configuration?.allowDownload === true;
  const { record, control, recordId } = configuration ?? {};
  const originalURL = page.url();
  const area = await mkdtemp(path.join(tmpdir(), 'openai-file-download-'));
  const quarantine = path.join(area, 'quarantine');
  let document;
  let documentDisposed = false;
  let cleanup = null;
  try {
    await mkdir(quarantine, { mode: 0o700 });
    if (!record || !control || typeof recordId !== 'string' || !recordId) {
      throw new Error('Result response refused.');
    }
    document = await page.evaluateHandle(() => window.document);
    if (page.url() !== originalURL) {
      throw new Error('Result response refused.');
    }
  } catch {
    try {
      await document?.dispose();
    } catch {
      // Preserve the initialization error while still removing local staging.
    } finally {
      await rm(area, { recursive: true, force: true });
    }
    throw new Error('Result owner initialization refused.');
  }
  let session = randomBytes(16).toString('hex');
  let grant = null;
  let live = true;
  let work = null;
  let last = refused();
  const state = new FileState('download');
  let req = null;
  const abort = new AbortController();
  // Trusted diagnostics only, never put in a model receipt.
  const stats = { requests: 0, readBytes: 0, writtenBytes: 0, peakFileBytes: 0 };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Serialized into the page with this owner's handles.
  const eligible = (el, [doc, row, id]) =>
    el.ownerDocument === doc &&
    doc === window.document &&
    el.isConnected &&
    row.isConnected &&
    row.dataset.recordId === id &&
    el.closest('[data-record-id]') === row &&
    el.matches('button:not(:disabled)');
  async function transfer(args, signal) {
    if (!live || work) {
      state.transfer('refused', 'none', false);
      const receipt = JSON.stringify(refused());
      return { receipt, outcome: browserOutcome(receipt, false, state.cleanup) };
    }
    state.transfer('in_progress', 'none');
    // oxlint-disable-next-line promise/prefer-await-to-then, eslint/complexity -- Register ownership or rejection handling before a held operation can reenter. Keep this single owned transfer or fixture response transaction in order.
    work = Promise.resolve().then(async () => {
      const chosen = grant;
      let admitted = false;
      let fd;
      let file;
      let response;
      let timer;
      let outcome;
      const expired = () => Date.now() >= chosen.expiresAt;
      try {
        if (
          !chosen ||
          Object.keys(args).length !== 1 ||
          args.grant_id !== chosen.id ||
          chosen.session !== session ||
          expired() ||
          abort.signal.aborted ||
          signal?.aborted ||
          page.url() !== originalURL ||
          !(await waitForDecision(
            () => control.evaluate(eligible, [document, record, recordId]),
            signal ? AbortSignal.any([abort.signal, signal]) : abort.signal,
          ))
        ) {
          throw new Error('Result response refused.');
        }
        const approval = { owner: state, active: true };
        let agreed;
        try {
          agreed = await waitForDecision(
            () =>
              approvingOwner.run(approval, () =>
                approve(
                  Object.freeze({
                    label: 'Prepared fixture result',
                    count: chosen.count,
                    sha256: chosen.sha256,
                  }),
                ),
              ),
            signal ? AbortSignal.any([abort.signal, signal]) : abort.signal,
          );
        } finally {
          // Child tasks retain the token but cannot reenter after approval ends.
          approval.active = false;
        }
        const current = await waitForDecision(
          () => control.evaluate(eligible, [document, record, recordId]),
          signal ? AbortSignal.any([abort.signal, signal]) : abort.signal,
        );
        if (
          agreed !== true ||
          !live ||
          abort.signal.aborted ||
          signal?.aborted ||
          expired() ||
          grant !== chosen ||
          chosen.session !== session ||
          page.url() !== originalURL ||
          !current
        ) {
          throw new Error('Result response refused.');
        }
        // Consume before the first possible GET; no automatic retry or redirect.
        grant = null;
        admitted = true;
        last = unknown();
        state.transfer('in_progress', 'unknown');
        const deadline = chosen.expiresAt;
        // oxlint-disable-next-line promise/avoid-new -- Bridge native events or the exercise's explicitly released gate.
        response = await new Promise((resolve, reject) => {
          stats.requests += 1;
          const url = new URL(chosen.url);
          req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method: 'GET',
            agent: false,
            maxHeaderSize: 8192,
            headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
            signal: signal ? AbortSignal.any([abort.signal, signal]) : abort.signal,
          });
          req.once('response', (incoming) => {
            // Keep early errors handled while file creation awaits; the read
            // loop still rejects on incoming.errored/incomplete.
            incoming.on('error', () => {
              // The read loop inspects incoming.errored after file creation.
            });
            resolve(incoming);
          });
          req.on('error', reject);
          timer = setTimeout(
            () => req.destroy(new Error('Result request expired.')),
            Math.max(1, deadline - Date.now()),
          );
          req.end();
        });
        const declared = response.headers['content-length'];
        if (
          response.statusCode !== 200 ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
          response.headers['content-type'] !== 'application/octet-stream' ||
          (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) !== chosen.count))
        ) {
          throw new Error('Result response refused.');
        }
        file = path.join(quarantine, `q_${randomBytes(12).toString('hex')}`);
        fd = await open(file, 'wx', 0o600);
        const hash = createHash('sha256');
        while (true) {
          if (
            !live ||
            abort.signal.aborted ||
            signal?.aborted ||
            Date.now() >= deadline ||
            response.errored ||
            (response.destroyed && !response.readableEnded)
          ) {
            throw new Error('Result response refused.');
          }
          const chunk = response.read(Math.min(quantum, maxBytes - stats.readBytes + 1));
          if (chunk) {
            stats.readBytes += chunk.length;
            if (stats.readBytes > maxBytes) {
              throw new Error('Result response refused.');
            }
            hash.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
              const wrote = await fd.write(chunk, offset, chunk.length - offset, stats.writtenBytes);
              if (!wrote.bytesWritten) {
                throw new Error('Result response refused.');
              }
              offset += wrote.bytesWritten;
              stats.writtenBytes += wrote.bytesWritten;
            }
            // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
            const writtenFile = await fd.stat();
            stats.peakFileBytes = Math.max(stats.peakFileBytes, writtenFile.size);
            continue;
          }
          if (response.readableEnded) {
            break;
          }
          // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
          await readable(response);
        }
        const actualDigest = hash.digest('hex');
        await fd.close();
        fd = null;
        const stillCurrent = await waitForDecision(
          () => control.evaluate(eligible, [document, record, recordId]),
          signal ? AbortSignal.any([abort.signal, signal]) : abort.signal,
        );
        if (
          !response.complete ||
          !live ||
          abort.signal.aborted ||
          signal?.aborted ||
          Date.now() >= deadline ||
          chosen.session !== session ||
          page.url() !== originalURL ||
          !stillCurrent ||
          stats.readBytes !== chosen.count ||
          actualDigest !== chosen.sha256
        ) {
          throw new Error('Result response refused.');
        }
        last = {
          status: 'completed',
          attempted: true,
          completed: true,
          count: stats.readBytes,
          sha256: actualDigest,
        };
      } catch {
        last = admitted ? unknown() : refused();
        if (
          !admitted &&
          chosen &&
          grant === chosen &&
          (abort.signal.aborted || signal?.aborted || expired() || chosen.session !== session)
        ) {
          grant = null;
        }
      } finally {
        outcome = browserOutcome(
          JSON.stringify(last),
          abort.signal.aborted || signal?.aborted,
          state.cleanup,
        );
        state.transfer(outcome.status, outcome.effect);
        clearTimeout(timer);
        req?.destroy();
        response?.destroy();
        await fd?.close();
        if (admitted && !last.completed) {
          live = false;
          if (file) {
            await rm(file, { force: true });
          }
        }
      }
      return { receipt: JSON.stringify(last), outcome };
    });
    try {
      return await work;
    } catch {
      live = false;
      state.clean('pending');
      throw new Error('Result cleanup incomplete.');
    } finally {
      work = null;
      if (state.cleanup === 'pending') {
        try {
          // oxlint-disable-next-line eslint/no-use-before-define -- transfer can only run through the initialized owner.
          await owner.stop();
        } catch (error) {
          if (!(error instanceof FileCleanupIncompleteError)) {
            // oxlint-disable-next-line eslint/no-unsafe-finally -- A real staging/disposal error must still fail the transfer.
            throw error;
          }
        }
      }
    }
  }
  const owner = {
    area,
    quarantine,
    control,
    abort,
    get stats() {
      return { ...stats };
    },
    receipt: () => ({ ...last }),
    state: () => state.snapshot(),
    changeSession: () => {
      session = randomBytes(16).toString('hex');
    },
    // oxlint-disable-next-line eslint/complexity -- Validate one grant's trusted source, original permission and one-use lifetime together before storing it.
    issue(source, expiresAt) {
      if (!work && grant && (grant.expiresAt <= Date.now() || grant.session !== session)) {
        grant = null;
      }
      const metadata = source && typeof source === 'object' ? { ...source } : {};
      let url;
      try {
        url = new URL(metadata.url);
      } catch {
        // Refuse below with the other invalid trusted metadata.
      }
      if (
        !enabled ||
        !live ||
        work ||
        grant ||
        stats.requests !== 0 ||
        Object.keys(metadata).length !== 3 ||
        typeof metadata.url !== 'string' ||
        !url ||
        url.username ||
        url.password ||
        /^https?:\/\/[^/?#]*@/iu.test(metadata.url) ||
        metadata.url.includes('#') ||
        // oxlint-disable-next-line eslint/no-control-regex -- Refuse whitespace/control normalization before passing a trusted URL to the native HTTP client.
        /[\u0000-\u0020]/u.test(metadata.url) ||
        !(
          (url.protocol === 'https:' && /^https:\/\/[^/?#@\\]+(?:\/|\?|$)/iu.test(metadata.url)) ||
          (url.protocol === 'http:' &&
            /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|\?|$)/u.test(metadata.url))
        ) ||
        !Number.isSafeInteger(metadata.count) ||
        metadata.count < 0 ||
        metadata.count > maxBytes ||
        typeof metadata.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(metadata.sha256) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + 30_000
      ) {
        state.prepare('refused');
        throw new Error('Result grant refused.');
      }
      grant = {
        id: randomBytes(24).toString('hex'),
        session,
        count: metadata.count,
        sha256: metadata.sha256,
        url: url.href,
        expiresAt,
      };
      return { grant_id: grant.id, label: 'Prepared fixture result' };
    },
    async stop() {
      state.clean('pending');
      live = false;
      abort.abort();
      req?.destroy();
      const approval = approvingOwner.getStore();
      if (approval?.owner === state && approval.active) {
        return;
      }
      await work?.catch(() => {
        // The caller receives the rejection; Stop still owns cleanup.
      });
      grant = null;
      if (!cleanup) {
        // oxlint-disable-next-line promise/prefer-await-to-then -- Bind cleanup ownership before native disposal can yield.
        cleanup = Promise.resolve().then(async () => {
          await rm(area, { recursive: true, force: true });
          if (!documentDisposed) {
            await document.dispose();
            documentDisposed = true;
          }
          state.clean('completed');
        });
        const pending = cleanup;
        // oxlint-disable-next-line promise/prefer-await-to-then -- A late failure must release only this cached cleanup for retry.
        void pending.catch(() => {
          if (cleanup === pending) {
            cleanup = null;
          }
        });
      }
      await waitForFileCleanup(cleanup);
    },
    async download_file(args, { signal } = {}) {
      const { outcome } = await transfer(args, signal);
      return outcome;
    },
    async download(args, { signal } = {}) {
      const { receipt } = await transfer(args, signal);
      return receipt;
    },
  };
  return owner;
}
