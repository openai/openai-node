import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

const wrapperPath = path.join(process.cwd(), 'scripts/steady/cache.cjs');
const testPermissions = process.platform === 'win32' || process.getuid?.() === 0 ? test.skip : test;

describe('Steady cache lease persistence failure', () => {
  let fixture: string;
  let cache: string;
  let leases: string;
  let running: ReturnType<typeof startWrapper> | undefined;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'steady-cache-lease-failure-')));
    cache = path.join(fixture, 'cache');
    leases = path.join(cache, '.leases');
    mkdirSync(leases, { recursive: true });
    writeFileSync(
      path.join(fixture, 'observe.cjs'),
      `const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const spawn = childProcess.spawn;
// Observe the real child without replacing spawning, filesystem writes, or events.
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  console.log('OWNED_CHILD_PID', child.pid ?? 'missing');
  child.once('exit', () => {
    console.log('LOCK_AT_CHILD_EXIT', fs.existsSync(path.join(process.argv[2], '.lifecycle-lock')));
  });
  return child;
};
`,
    );
    writeFileSync(
      path.join(fixture, 'command.cjs'),
      `console.log('COMMAND_READY', process.env.STEADY_CACHE_LEASE);
process.stdin.once('end', () => process.exit(Number(process.argv[2])));
process.stdin.resume();
`,
    );
  });

  afterEach(async () => {
    try {
      if (running) {
        // Release even the unfixed wrapper's unprotected child and let it be reaped.
        running.child.stdin.end();
        await running.closed;
        running = undefined;
      }
    } finally {
      chmodSync(leases, 0o755);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  function startWrapper(command = process.execPath, args = [path.join(fixture, 'command.cjs'), '0']) {
    const child = spawn(
      process.execPath,
      [
        '-r',
        path.join(fixture, 'observe.cjs'),
        wrapperPath,
        cache,
        path.join(cache, 'source-synthetic'),
        path.join(cache, 'deno-synthetic'),
        path.join(cache, 'deps-synthetic'),
        command,
        ...args,
      ],
      {
        stdio: 'pipe',
        // Contain a regression that signals a failed spawn before it has a PID.
        detached: process.platform !== 'win32',
        timeout: 10_000,
        killSignal: 'SIGKILL',
      },
    );
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const closed = once(child, 'close');
    const result = { child, closed, output: () => output, errors: () => errors };
    running = result;
    return result;
  }

  function makeLeasesReadOnly() {
    chmodSync(leases, 0o555);
    expect(() => accessSync(leases, constants.W_OK)).toThrow(/EACCES/u);
  }

  function expectCleanCache() {
    expect(readdirSync(leases)).toEqual([]);
    expect(existsSync(path.join(cache, '.lifecycle-lock'))).toBe(false);
  }

  testPermissions(
    'reaps a started command before releasing its lock or reporting a lease write error',
    async () => {
      makeLeasesReadOnly();
      const wrapper = startWrapper();

      await vi.waitFor(() => expect(wrapper.errors()).toContain('EACCES'), { timeout: 5000 });
      // The two output streams can be delivered independently; wait for the exit observation.
      await vi.waitFor(() => expect(wrapper.output()).toContain('LOCK_AT_CHILD_EXIT true'), {
        timeout: 2000,
      });

      const pid = Number(wrapper.output().match(/OWNED_CHILD_PID (?<pid>\d+)/u)?.groups?.['pid']);
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH/u);
      await expect(wrapper.closed).resolves.toEqual([1, null]);
      expect(wrapper.errors()).toContain('.json');
      expectCleanCache();
    },
  );

  testPermissions(
    'preserves the lease error when spawning also fails, without signaling a missing PID',
    async () => {
      makeLeasesReadOnly();
      const wrapper = startWrapper(path.join(fixture, 'missing-command'), []);

      await expect(wrapper.closed).resolves.toEqual([1, null]);
      expect(wrapper.output()).toContain('OWNED_CHILD_PID missing');
      expect(wrapper.errors()).toContain('EACCES');
      expect(wrapper.errors()).not.toContain('ENOENT');
      expectCleanCache();
    },
  );

  test.each([0, 23])(
    'keeps a writable lease without holding the lock and preserves exit code %i',
    async (code) => {
      const wrapper = startWrapper(process.execPath, [path.join(fixture, 'command.cjs'), String(code)]);
      await vi.waitFor(() => expect(wrapper.output()).toContain('COMMAND_READY 1'), { timeout: 5000 });

      expect(readdirSync(leases)).toHaveLength(1);
      expect(existsSync(path.join(cache, '.lifecycle-lock'))).toBe(false);
      wrapper.child.stdin.end();

      await expect(wrapper.closed).resolves.toEqual([code, null]);
      expect(wrapper.output()).toContain('LOCK_AT_CHILD_EXIT false');
      expect(wrapper.errors()).toBe('');
      expectCleanCache();
    },
  );

  test('preserves a spawn error when the lease is writable', async () => {
    const wrapper = startWrapper(path.join(fixture, 'missing-command'), []);

    await expect(wrapper.closed).resolves.toEqual([1, null]);
    expect(wrapper.output()).toContain('OWNED_CHILD_PID missing');
    expect(wrapper.errors()).toContain('ENOENT');
    expect(wrapper.errors()).not.toContain('EACCES');
    expectCleanCache();
  });
});
