'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setInterval: interval } = require('node:timers/promises');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');

const MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

// Serialize lease changes and pruning, never the commands using the cache.
async function locked(cache, action, signal) {
  const lock = path.join(cache, '.lifecycle-lock');
  const deadline = performance.now() + 10_000;
  for await (const tick of interval(50, undefined, { signal })) {
    void tick;
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      if (performance.now() >= deadline) {
        throw new Error(`Steady cache is locked. If no install or mock is running, remove ${lock}.`, {
          cause: error,
        });
      }
    }
  }
  try {
    signal?.throwIfAborted();
    return await action();
  } finally {
    fs.rmdirSync(lock);
  }
}

function prune(cache, selected, now = Date.now()) {
  const protectedNames = new Set(selected);
  const leases = path.join(cache, '.leases');
  for (const name of fs.readdirSync(leases)) {
    const lease = path.join(leases, name);
    const { pids, entries } = JSON.parse(fs.readFileSync(lease, 'utf-8'));
    const alive = pids.some((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') {
          return false;
        }
        if (error.code === 'EPERM') {
          return true;
        }
        throw error;
      }
    });
    if (!alive) {
      fs.unlinkSync(lease);
      continue;
    }
    for (const entry of entries) {
      protectedNames.add(entry);
    }
  }
  for (const name of fs.readdirSync(cache)) {
    if (protectedNames.has(name) || !/^(?:source-|deno-|deps-)/u.test(name)) {
      continue;
    }
    const entry = path.join(cache, name);
    const stat = fs.lstatSync(entry);
    if (!stat.isDirectory() || stat.isSymbolicLink() || now - stat.mtimeMs < MAX_IDLE_MS) {
      continue;
    }
    // No registered process can start using this generation while the lock is held.
    fs.rmSync(entry, { recursive: true });
  }
}

async function run(cache, selected, command, args) {
  fs.mkdirSync(cache, { recursive: true });
  if (fs.realpathSync(cache) !== path.resolve(cache)) {
    throw new Error('Linked Steady cache.');
  }
  const leases = path.join(cache, '.leases');
  fs.mkdirSync(leases, { recursive: true });
  const lease = path.join(leases, `${process.pid}-${randomUUID()}.json`);
  let child;
  let cancelledBeforeSpawn = false;
  const pending = new AbortController();
  const forward = (signal) => {
    if (child) {
      child.kill(signal);
    } else {
      pending.abort(signal);
    }
  };
  const onTerm = () => forward('SIGTERM');
  const onInt = () => forward('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  try {
    const { exited } = await locked(
      cache,
      async () => {
        prune(cache, selected);
        child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, STEADY_CACHE_LEASE: '1' } });
        const exit = once(child, 'exit');
        void exit.catch(() => {
          // Rollback reports the lease error after the child has closed.
        });
        const { promise: closed, resolve } = Promise.withResolvers();
        child.once('close', resolve);
        try {
          fs.writeFileSync(
            lease,
            JSON.stringify({ pids: [process.pid, child.pid].filter(Boolean), entries: selected }),
            { flag: 'wx' },
          );
        } catch (error) {
          if (child.pid !== undefined) {
            child.kill('SIGKILL');
          }
          await closed;
          throw error;
        }
        return { exited: exit };
      },
      pending.signal,
    );
    const [code, signal] = await exited;
    return code ?? (signal === 'SIGINT' ? 130 : 143);
  } catch (error) {
    const { reason } = pending.signal;
    if (
      !child &&
      pending.signal.aborted &&
      (error === reason || (error?.name === 'AbortError' && error.cause === reason))
    ) {
      cancelledBeforeSpawn = true;
      return reason === 'SIGINT' ? 130 : 143;
    }
    throw error;
  } finally {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    if (!cancelledBeforeSpawn) {
      await locked(cache, () => {
        // Start the idle lifetime when the last command finishes using an entry.
        const now = new Date();
        for (const name of selected) {
          const entry = path.join(cache, name);
          if (fs.existsSync(entry)) {
            fs.utimesSync(entry, now, now);
          }
        }
        if (fs.existsSync(lease)) {
          fs.unlinkSync(lease);
        }
        prune(cache, selected);
      });
    }
  }
}

module.exports = { MAX_IDLE_MS, locked, prune, run };
async function main() {
  const [cache, source, runtime, dependencies, command, ...args] = process.argv.slice(2);
  try {
    process.exitCode = await run(
      cache,
      [source, runtime, dependencies].map((entry) => path.basename(entry)),
      command,
      args,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
if (require.main === module) {
  void main();
}
