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

describe('Steady cache lock clock corrections', () => {
  let fixture: string;
  let cache: string;
  let lock: string;
  let running: ReturnType<typeof startWrapper> | undefined;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'steady-cache-clock-')));
    cache = path.join(fixture, 'cache');
    lock = path.join(cache, '.lifecycle-lock');
    mkdirSync(lock, { recursive: true });
    writeFileSync(path.join(lock, 'owner'), 'another cache user');
    writeFileSync(path.join(fixture, 'command.cjs'), "console.log('CHILD_EXECUTED');\n");
    writeFileSync(
      path.join(fixture, 'clock.cjs'),
      `const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const wallNow = Date.now;
const monotonicNow = performance.now.bind(performance);
const backward = process.env.STEADY_TEST_CLOCK === 'backward';
let shifted = false;
if (backward) {
  Object.defineProperty(performance, 'now', { value: () => monotonicNow() * 100 });
}
// Establish the deadline before applying the wall-clock correction.
process.on('newListener', (event) => {
  if (event === 'SIGTERM') setImmediate(() => {
    Date.now = () => wallNow() + (backward ? -60_000 : 60_000);
    shifted = true;
    console.log('CLOCK_SHIFTED');
  });
});
// Observe a real failed acquisition after the clock step; preserve its result.
const mkdir = fs.mkdirSync;
fs.mkdirSync = (...args) => {
  try {
    return mkdir(...args);
  } catch (error) {
    if (shifted && args[0] === path.join(process.argv[2], '.lifecycle-lock') && error.code === 'EEXIST') {
      console.log('LOCK_CONTENDED');
    }
    throw error;
  }
};
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

  function startWrapper(direction: 'backward' | 'forward') {
    const child = spawn(
      process.execPath,
      [
        '-r',
        path.join(fixture, 'clock.cjs'),
        wrapperPath,
        cache,
        path.join(cache, 'source-synthetic'),
        path.join(cache, 'deno-synthetic'),
        path.join(cache, 'deps-synthetic'),
        process.execPath,
        path.join(fixture, 'command.cjs'),
      ],
      { env: { ...process.env, STEADY_TEST_CLOCK: direction }, stdio: 'pipe' },
    );
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdin.end();
    const closed = once(child, 'close');
    const result = { child, closed, output: () => output, errors: () => errors };
    running = result;
    return result;
  }

  test('expires the acquisition budget despite a backward wall-clock correction', async () => {
    const wrapper = startWrapper('backward');
    await vi.waitFor(() => expect(wrapper.output()).toContain('CLOCK_SHIFTED'), { timeout: 5000 });

    // Only the monotonic clock is accelerated; the real lock stays occupied.
    await vi.waitFor(() => expect(wrapper.child.exitCode).toBe(1), { timeout: 2000 });

    await expect(wrapper.closed).resolves.toEqual([1, null]);
    expect(wrapper.errors()).toContain('Steady cache is locked.');
    expect(wrapper.output()).not.toContain('CHILD_EXECUTED');
    expect(readFileSync(path.join(lock, 'owner'), 'utf-8')).toBe('another cache user');
    expect(readdirSync(path.join(cache, '.leases'))).toEqual([]);
  });

  test('does not expire the acquisition budget after a forward wall-clock correction', async () => {
    const wrapper = startWrapper('forward');
    await vi.waitFor(() => expect(wrapper.output()).toContain('LOCK_CONTENDED'), { timeout: 5000 });
    expect(readFileSync(path.join(lock, 'owner'), 'utf-8')).toBe('another cache user');
    rmSync(lock, { recursive: true });

    await expect(wrapper.closed).resolves.toEqual([0, null]);
    expect(wrapper.output()).toContain('CHILD_EXECUTED');
    expect(wrapper.errors()).not.toContain('Steady cache is locked.');
    expect(readdirSync(path.join(cache, '.leases'))).toEqual([]);
    expect(existsSync(lock)).toBe(false);
  });
});
