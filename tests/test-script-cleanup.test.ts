import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

const repoRoot = process.cwd();
const describeBash = process.platform === 'win32' ? describe.skip : describe;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

describeBash('scripts/test mock-server cleanup', () => {
  let fixture: string;
  let env: NodeJS.ProcessEnv;
  let existingProcess: ChildProcess | undefined;

  function writeExecutable(filename: string, interpreter: string, body: string): void {
    writeFileSync(path.join(fixture, filename), `#!/usr/bin/env ${interpreter}\n${body}\n`, { mode: 0o755 });
  }

  function fixturePid(filename = 'server.pid'): number {
    const pid = Number(readFileSync(path.join(fixture, filename), 'utf-8'));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    return pid;
  }

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-test-cleanup-'));
    env = {
      ...process.env,
      PATH: [path.join(fixture, 'bin'), path.dirname(process.execPath), process.env['PATH']].join(
        path.delimiter,
      ),
      FIXTURE_ROOT: fixture,
      OPENAI_TEST_SUITE: 'generated',
      TEST_API_BASE_URL: '',
      STARTUP_EXIT: '0',
      PAUSE_STARTUP: 'false',
      REUSE_HEALTHY: 'false',
      JEST_EXIT: '0',
    };
    for (const directory of ['scripts', 'bin', 'node_modules/.bin']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }
    for (const file of ['scripts/test', 'scripts/generated-test-patterns.json']) {
      copyFileSync(path.join(repoRoot, file), path.join(fixture, file));
    }
    writeExecutable('bin/curl', 'bash', '[ "$REUSE_HEALTHY" = true ] || [ -f "$FIXTURE_ROOT/mock.ready" ]');
    writeExecutable('bin/lsof', 'bash', 'touch "$FIXTURE_ROOT/lsof.called"\ncat "$FIXTURE_ROOT/server.pid"');
    writeExecutable('node_modules/.bin/jest', 'bash', 'touch "$FIXTURE_ROOT/jest.called"\nexit "$JEST_EXIT"');
    writeExecutable(
      'server.cjs',
      'node',
      `const fs = require('node:fs');
const root = process.env.FIXTURE_ROOT;
process.on('SIGTERM', () => { fs.writeFileSync(root + '/server.stopped', 'SIGTERM'); process.exit(0); });
fs.writeFileSync(root + '/server.pid', String(process.pid));
setInterval(() => {}, 1000);
process.send('ready');`,
    );
    writeExecutable(
      'scripts/mock',
      'node',
      `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = process.env.FIXTURE_ROOT;
fs.writeFileSync(root + '/mock.called', String(process.pid));
if (process.env.STARTUP_EXIT !== '0') process.exit(Number(process.env.STARTUP_EXIT));
const child = spawn(process.execPath, [root + '/server.cjs'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('error', () => process.exit(1));
child.once('message', () => {
  if (process.env.PAUSE_STARTUP === 'true') { fs.writeFileSync(root + '/startup.paused', ''); return; }
  fs.writeFileSync(root + '/mock.ready', '');
  child.disconnect();
  child.unref();
});`,
    );
  });

  afterEach(async () => {
    try {
      const pids = ['server.pid', 'mock.called']
        .filter((filename) => existsSync(path.join(fixture, filename)))
        .map((filename) => fixturePid(filename));
      for (const pid of pids) {
        if (isRunning(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      }
      await vi.waitFor(() => expect(pids.some(isRunning)).toBe(false));
    } finally {
      existingProcess?.kill('SIGTERM');
      existingProcess = undefined;
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  async function startExistingProcess(): Promise<void> {
    existingProcess = spawn(process.execPath, [path.join(fixture, 'server.cjs')], {
      env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await once(existingProcess, 'message');
  }

  function runTests(expectedExit: number): void {
    const result = spawnSync('bash', [path.join(fixture, 'scripts/test'), '--showConfig'], {
      cwd: fixture,
      env,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: expectedExit, stderr: '' });
  }

  test('does not kill an unrelated process when mock startup fails', async () => {
    await startExistingProcess();
    env['STARTUP_EXIT'] = '23';

    runTests(23);

    expect(existsSync(path.join(fixture, 'mock.called'))).toBe(true);
    expect(existsSync(path.join(fixture, 'jest.called'))).toBe(false);
    expect(existsSync(path.join(fixture, 'lsof.called'))).toBe(false);
    expect(isRunning(fixturePid())).toBe(true);
  });

  test.each([0, 17])('cleans up its started mock and preserves Jest exit %i', async (exitCode) => {
    env['JEST_EXIT'] = String(exitCode);

    runTests(exitCode);

    expect(existsSync(path.join(fixture, 'mock.called'))).toBe(true);
    expect(existsSync(path.join(fixture, 'jest.called'))).toBe(true);
    expect(existsSync(path.join(fixture, 'lsof.called'))).toBe(true);
    await vi.waitFor(() => expect(isRunning(fixturePid())).toBe(false));
    expect(readFileSync(path.join(fixture, 'server.stopped'), 'utf-8')).toBe('SIGTERM');
  });

  test.each([0, 17])('reuses a healthy mock after Jest exit %i', async (exitCode) => {
    await startExistingProcess();
    env['REUSE_HEALTHY'] = 'true';
    env['JEST_EXIT'] = String(exitCode);

    runTests(exitCode);

    expect(existsSync(path.join(fixture, 'mock.called'))).toBe(false);
    expect(existsSync(path.join(fixture, 'jest.called'))).toBe(true);
    expect(existsSync(path.join(fixture, 'lsof.called'))).toBe(false);
    expect(isRunning(fixturePid())).toBe(true);
  });

  test('cleans up its mock when the wrapper is terminated during startup', async () => {
    env['PAUSE_STARTUP'] = 'true';
    const wrapper = spawn('bash', [path.join(fixture, 'scripts/test')], {
      cwd: fixture,
      env,
      stdio: 'ignore',
    });
    const closed = once(wrapper, 'close');
    try {
      await vi.waitFor(() => expect(existsSync(path.join(fixture, 'startup.paused'))).toBe(true), {
        timeout: 5000,
      });
      expect(isRunning(fixturePid())).toBe(true);
      wrapper.kill('SIGTERM');
      expect(await closed).toEqual([null, 'SIGTERM']);
      await vi.waitFor(() => expect(isRunning(fixturePid())).toBe(false));
      expect(existsSync(path.join(fixture, 'lsof.called'))).toBe(true);
      expect(existsSync(path.join(fixture, 'jest.called'))).toBe(false);
    } finally {
      wrapper.kill('SIGTERM');
    }
  });
});
