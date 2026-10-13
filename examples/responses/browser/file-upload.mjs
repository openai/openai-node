// Optional example: newly-created private local staging, no existing host roots.
import { constants } from 'node:fs';
import { lstat, open, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
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

const cap = 64 * 1024;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refusal = () => ({ status: 'refused', attempted: false, completed: false });
const unknown = () => ({ status: 'unknown', attempted: true, completed: false });

export async function newUploadOwner(
  page,
  configuration,
  approve,
  afterStat = async () => {
    // No read-boundary hook unless the exercise supplies one.
  },
) {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw new Error(
      'Uploads are not supported on this platform: non-following, nonblocking file opens are required.',
    );
  }
  const allowed = configuration?.allowUpload === true;
  const { record, control, recordId } = configuration ?? {};
  const expectedURL = page.url();
  // Only a caller-created private area here, never an arbitrary existing directory.
  const area = await mkdtemp(path.join(tmpdir(), 'openai-file-upload-'));
  const uploadRoot = path.join(area, 'upload');
  const quarantine = path.join(area, 'quarantine');
  let document;
  let documentDisposed = false;
  let cleanup = null;
  let session;
  try {
    await mkdir(uploadRoot, { mode: 0o700 });
    await mkdir(quarantine, { mode: 0o700 });
    if (!record || !control || typeof recordId !== 'string' || !recordId) {
      throw new Error('File owner initialization refused.');
    }
    session = randomBytes(16).toString('hex');
    document = await page.evaluateHandle(() => window.document);
    if (expectedURL !== page.url()) {
      throw new Error('File owner initialization refused.');
    }
  } catch {
    // No owner escaped, so only this construction owns cleanup for the new area.
    try {
      await document?.dispose();
    } catch {
      // Preserve the initialization error while still removing local staging.
    } finally {
      await rm(area, { recursive: true, force: true });
    }
    throw new Error('File owner initialization refused.');
  }
  let grant = null;
  let revoked = false;
  let activeSession = session;
  let work = null;
  let last = refusal();
  const state = new FileState('upload');
  const abort = new AbortController();
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Serialized into the page with this owner's handles.
  const eligibleControl = (el, [doc, row, id]) =>
    el.ownerDocument === doc &&
    doc === window.document &&
    el.isConnected &&
    row.isConnected &&
    row.dataset.recordId === id &&
    el.closest('[data-record-id]') === row &&
    el.matches('input[type=file]:not(:disabled)');

  async function transfer(args, signal) {
    if (work || revoked) {
      state.transfer('refused', 'none', false);
      const receipt = JSON.stringify(refusal());
      return { receipt, outcome: browserOutcome(receipt, false, state.cleanup) };
    }
    state.transfer('in_progress', 'none');
    const currentSignal = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
    // oxlint-disable-next-line eslint/complexity -- Keep this single owned transfer or fixture response transaction in order.
    const task = async () => {
      let admitted = false;
      let chosen;
      let outcome;
      try {
        chosen = grant;
        if (
          !chosen ||
          Object.keys(args).length !== 1 ||
          args.grant_id !== chosen.id ||
          chosen.session !== activeSession ||
          chosen.expiresAt <= Date.now() ||
          abort.signal.aborted ||
          signal?.aborted ||
          page.url() !== expectedURL ||
          !(await waitForDecision(
            () => control.evaluate(eligibleControl, [document, record, recordId]),
            currentSignal,
          ))
        ) {
          throw new Error('File transfer refused.');
        }
        // This function owns approval. BrowserToolset.confirm grants no file permission.
        const approval = { owner: state, active: true };
        let approved;
        try {
          approved = await waitForDecision(
            () =>
              approvingOwner.run(approval, () =>
                approve(
                  Object.freeze({
                    label: 'Approved fixture document',
                    count: chosen.count,
                    sha256: chosen.sha256,
                  }),
                ),
              ),
            currentSignal,
          );
        } finally {
          // Child tasks retain the token but cannot reenter after approval ends.
          approval.active = false;
        }
        const eligible = await waitForDecision(
          () => control.evaluate(eligibleControl, [document, record, recordId]),
          currentSignal,
        );
        if (
          approved !== true ||
          revoked ||
          abort.signal.aborted ||
          signal?.aborted ||
          grant !== chosen ||
          chosen.expiresAt <= Date.now() ||
          chosen.session !== activeSession ||
          page.url() !== expectedURL ||
          !eligible
        ) {
          throw new Error('File transfer refused.');
        }
        // Native setInputFiles begins the transfer; no atomic page check/assignment promise.
        grant = null;
        admitted = true;
        last = unknown();
        state.transfer('in_progress', 'unknown');
        await control.setInputFiles({
          name: 'approved.bin',
          mimeType: 'application/octet-stream',
          buffer: chosen.bytes,
        });
        const stillOwned =
          !revoked &&
          !abort.signal.aborted &&
          !signal?.aborted &&
          chosen.session === activeSession &&
          page.url() === expectedURL &&
          (await waitForDecision(
            () => control.evaluate(eligibleControl, [document, record, recordId]),
            currentSignal,
          ));
        if (stillOwned) {
          last = {
            status: 'completed',
            attempted: true,
            completed: true,
            count: chosen.count,
            sha256: chosen.sha256,
          };
        }
      } catch {
        last = admitted ? unknown() : refusal();
        if (
          !admitted &&
          chosen &&
          grant === chosen &&
          (abort.signal.aborted ||
            signal?.aborted ||
            chosen.expiresAt <= Date.now() ||
            chosen.session !== activeSession)
        ) {
          chosen?.bytes.fill(0);
          grant = null;
        }
      } finally {
        outcome = browserOutcome(
          JSON.stringify(last),
          abort.signal.aborted || signal?.aborted,
          state.cleanup,
        );
        state.transfer(outcome.status, outcome.effect);
        if (admitted) {
          chosen.bytes.fill(0);
          if (!last.completed) {
            revoked = true;
          }
        }
      }
      return { receipt: JSON.stringify(last), outcome };
    };
    // oxlint-disable-next-line promise/prefer-await-to-then -- Register ownership or rejection handling before a held operation can reenter.
    work = Promise.resolve().then(task);
    try {
      return await work;
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
    uploadRoot,
    quarantine,
    control,
    abort,
    generatedName: () => `f_${randomBytes(12).toString('hex')}`,
    receipt: () => ({ ...last }),
    state: () => state.snapshot(),
    changeSession: () => {
      activeSession = randomBytes(16).toString('hex');
    },
    async prepare(root, name, expiresAt) {
      if (!work && grant && (grant.expiresAt <= Date.now() || grant.session !== activeSession)) {
        grant.bytes.fill(0);
        grant = null;
      }
      if (
        !allowed ||
        revoked ||
        work ||
        grant ||
        root !== uploadRoot ||
        typeof name !== 'string' ||
        !/^f_[a-f0-9]{24}$/u.test(name) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + 30_000
      ) {
        state.prepare('refused');
        throw new Error('File preparation refused.');
      }
      const preparedSession = activeSession;
      // Bind the existing owner slot before any IO or caller hook can reenter.
      // oxlint-disable-next-line promise/prefer-await-to-then, eslint/complexity -- Register ownership or rejection handling before a held operation can reenter. Keep this single owned transfer or fixture response transaction in order.
      work = Promise.resolve().then(async () => {
        let bytes;
        let fd;
        let frozen;
        try {
          const rootStat = await lstat(uploadRoot);
          const entry = path.join(uploadRoot, name);
          const pre = await lstat(entry);
          if (
            rootStat.isSymbolicLink() ||
            !rootStat.isDirectory() ||
            pre.isSymbolicLink() ||
            !pre.isFile() ||
            pre.size > cap
          ) {
            throw new Error('File preparation refused.');
          }
          // oxlint-disable-next-line eslint/no-bitwise -- Native file flags and permissions are bitmasks.
          fd = await open(entry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const checked = await fd.stat();
          if (!checked.isFile() || checked.size > cap || checked.dev !== pre.dev || checked.ino !== pre.ino) {
            throw new Error('File preparation refused.');
          }
          // Exercise hook: grow the real opened file after this stat.
          await afterStat();
          bytes = Buffer.alloc(cap + 1);
          let count = 0;
          while (count < bytes.length) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Each bounded read, write, or fixture action depends on the preceding one.
            const got = await fd.read(bytes, count, bytes.length - count, count);
            if (!got.bytesRead) {
              break;
            }
            count += got.bytesRead;
          }
          if (count > cap) {
            throw new Error('File preparation refused.');
          }
          frozen = Buffer.from(bytes.subarray(0, count));
        } catch {
          throw new Error('File preparation refused.');
        } finally {
          bytes?.fill(0);
          await fd?.close();
        }
        // Closing the descriptor also awaits. Never publish a grant if Stop,
        // expiry or a session change happened during that last owned operation.
        if (revoked || abort.signal.aborted || preparedSession !== activeSession || expiresAt <= Date.now()) {
          frozen.fill(0);
          throw new Error('File preparation refused.');
        }
        grant = {
          id: randomBytes(24).toString('hex'),
          session: preparedSession,
          bytes: frozen,
          count: frozen.length,
          sha256: digest(frozen),
          expiresAt,
        };
        return { grant_id: grant.id, label: 'Approved fixture document' };
      });
      try {
        return await work;
      } catch {
        state.prepare(abort.signal.aborted ? 'interrupted' : 'refused');
        throw new Error('File preparation refused.');
      } finally {
        work = null;
      }
    },
    async stop() {
      state.clean('pending');
      revoked = true;
      abort.abort();
      const approval = approvingOwner.getStore();
      if (approval?.owner === state && approval.active) {
        return;
      }
      // Drain preparation and any admitted transfer before removing staging.
      await work?.catch(() => {
        // The caller receives the rejection; Stop still owns cleanup.
      });
      grant?.bytes.fill(0);
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
    async upload_file(args, { signal } = {}) {
      const { outcome } = await transfer(args, signal);
      return outcome;
    },
    async upload(args, { signal } = {}) {
      const { receipt } = await transfer(args, signal);
      return receipt;
    },
  };
  return owner;
}
