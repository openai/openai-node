import { mkdtemp, open, rename, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** One private, non-resumable phase. Close only after its complete runner promise settles. */
export async function createDesktopLedger(runId) {
  const directory = await mkdtemp(path.join(tmpdir(), 'desktop-evidence-'));
  const original = await lstat(directory);
  const target = path.join(directory, 'checkpoint.json');
  let revision = 0;
  let writing = false;
  let failed = false;
  let closing;
  return {
    runId,
    directory,
    async save(checkpoint) {
      const { revision: nextRevision, run_id: checkpointRun } = checkpoint;
      if (
        closing ||
        failed ||
        writing ||
        checkpointRun !== runId ||
        !Number.isSafeInteger(nextRevision) ||
        nextRevision <= revision
      ) {
        throw new Error('Private desktop checkpoint is not the next owned write.');
      }
      const serialized = JSON.stringify(checkpoint);
      writing = true;
      const temporary = path.join(directory, `${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(serialized);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
        const folder = await open(directory, 'r');
        try {
          await folder.sync();
        } finally {
          await folder.close();
        }
        revision = nextRevision;
      } catch {
        failed = true;
        try {
          await rm(temporary, { force: true });
        } catch {
          // The failed phase retains its private directory until close can remove it.
        }
        throw new Error('Private desktop checkpoint could not be committed.');
      } finally {
        writing = false;
      }
    },
    close() {
      if (writing) {
        return Promise.reject(new Error('Wait for the desktop runner before removing its checkpoint.'));
      }
      closing ??= (async () => {
        const current = await lstat(directory);
        if (current.ino !== original.ino || current.uid !== process.getuid() || !current.isDirectory()) {
          throw new Error('Private desktop checkpoint ownership changed.');
        }
        await rm(directory, { recursive: true });
      })();
      return closing;
    },
  };
}
