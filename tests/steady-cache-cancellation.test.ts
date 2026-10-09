import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

const wrapperPath = path.join(process.cwd(), 'scripts/steady/cache.cjs');
const testSignals = process.platform === 'win32' ? test.skip : test;

describe('Steady cache wrapper cancellation', () => {
  let fixture: string;
  let cache: string;
  let running: ReturnType<typeof startWrapper> | undefined;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'steady-cache-cancel-')));
    cache = path.join(fixture, 'cache');
    mkdirSync(cache);
    // Observe real listener registration without replacing the wrapper or its signal handlers.
    writeFileSync(
      path.join(fixture, 'ready.cjs'),
      `process.on('newListener', (event) => {
  if (event === 'SIGTERM') setImmediate(() => console.log('WRAPPER_READY'));
});
`,
    );
  });

  afterEach(async () => {
    if (running) {
      if (running.child.exitCode === null && running.child.signalCode === null) {
        running.child.kill('SIGKILL');
      }
      await running.closed;
      running = undefined;
    }
    rmSync(fixture, { recursive: true, force: true });
  });

  function startWrapper(command: string) {
    const child = spawn(
      process.execPath,
      [
        '-r',
        path.join(fixture, 'ready.cjs'),
        wrapperPath,
        cache,
        path.join(cache, 'source-synthetic'),
        path.join(cache, 'deno-synthetic'),
        path.join(cache, 'deps-synthetic'),
        process.execPath,
        '-e',
        command,
      ],
      { stdio: 'pipe' },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stdin.end();
    const closed = once(child, 'close');
    const result = { child, closed, output: () => output };
    running = result;
    return result;
  }

  test.each([0, 23])('preserves ordinary command exit code %i and removes its lease', async (code) => {
    const wrapper = startWrapper(`console.log('CHILD_EXECUTED'); process.exit(${code});`);

    await expect(wrapper.closed).resolves.toEqual([code, null]);
    expect(wrapper.output()).toContain('CHILD_EXECUTED');
    expect(readdirSync(path.join(cache, '.leases'))).toEqual([]);
    expect(existsSync(path.join(cache, '.lifecycle-lock'))).toBe(false);
  });

  testSignals.each([
    { signal: 'SIGINT' as const, code: 130 },
    { signal: 'SIGTERM' as const, code: 143 },
  ])('cancels a pending command on $signal without taking another process lock', async ({ signal, code }) => {
    const lock = path.join(cache, '.lifecycle-lock');
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner'), 'another cache user');
    const wrapper = startWrapper("console.log('CHILD_EXECUTED')");
    await vi.waitFor(() => expect(wrapper.output()).toContain('WRAPPER_READY'), { timeout: 5000 });

    wrapper.child.kill(signal);

    // The other owner keeps its lock throughout cancellation; waiting for it is not cleanup.
    await vi.waitFor(() => expect(wrapper.child.exitCode).toBe(code), { timeout: 5000 });
    await expect(wrapper.closed).resolves.toEqual([code, null]);
    expect(wrapper.output()).not.toContain('CHILD_EXECUTED');
    expect(readFileSync(path.join(lock, 'owner'), 'utf-8')).toBe('another cache user');
    expect(readdirSync(path.join(cache, '.leases'))).toEqual([]);
  });

  testSignals.each([
    { signal: 'SIGINT' as const, code: 130 },
    { signal: 'SIGTERM' as const, code: 143 },
  ])('forwards $signal to a started command and removes its lease', async ({ signal, code }) => {
    const wrapper = startWrapper("console.log('CHILD_READY'); setTimeout(() => process.exit(97), 10_000)");
    await vi.waitFor(() => expect(wrapper.output()).toContain('CHILD_READY'), { timeout: 5000 });
    expect(readdirSync(path.join(cache, '.leases'))).toHaveLength(1);

    wrapper.child.kill(signal);

    await vi.waitFor(() => expect(wrapper.child.exitCode).toBe(code), { timeout: 5000 });
    await expect(wrapper.closed).resolves.toEqual([code, null]);
    expect(readdirSync(path.join(cache, '.leases'))).toEqual([]);
    expect(existsSync(path.join(cache, '.lifecycle-lock'))).toBe(false);
  });
});
