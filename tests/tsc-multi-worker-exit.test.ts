import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const cli = path.join(repoRoot, 'scripts/_vendor/tsc-multi/src/cli.ts');
const register = createRequire(path.join(repoRoot, 'package.json')).resolve(
  'ts-node/register/transpile-only',
);
const testSignals = process.platform === 'win32' ? test.skip : test;

describe('tsc-multi compiler worker exits', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-tsc-worker-exit-'));
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function runWorkers(outcomes: (number | NodeJS.Signals)[]): number | null {
    const compiler = path.join(fixture, 'compiler.cjs');
    const invocations = path.join(fixture, 'invocations');
    writeFileSync(
      path.join(fixture, 'tsc-multi.json'),
      JSON.stringify({ targets: outcomes.map((_, index) => ({ extname: `.target${index}.js` })) }),
    );
    // The real worker loads this compiler; only that child process exits or receives the signal.
    writeFileSync(
      compiler,
      `const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const invocations = ${JSON.stringify(invocations)};
const index = existsSync(invocations) ? readFileSync(invocations, 'utf-8').length : 0;
appendFileSync(invocations, 'x');
const outcome = ${JSON.stringify(outcomes)}[index];
if (typeof outcome === 'string') {
  process.kill(process.pid, outcome);
} else {
  process.exit(outcome);
}
`,
    );

    const result = spawnSync(
      process.execPath,
      ['-r', register, cli, '--cwd', fixture, '--compiler', compiler, '--maxWorkers', '1'],
      { cwd: repoRoot, encoding: 'utf-8', timeout: 15_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(readFileSync(invocations, 'utf-8')).toBe('x'.repeat(outcomes.length));
    return result.status;
  }

  test.each([0, 23])('preserves numeric worker exit code %i', (code) => {
    expect(runWorkers([code])).toBe(code);
  });

  testSignals.each(['SIGTERM', 'SIGKILL'] as const)('fails when a compiler worker receives %s', (signal) => {
    expect(runWorkers([signal])).toBe(1);
  });

  testSignals('does not hide a later failed target after a signaled worker', () => {
    expect(runWorkers(['SIGTERM', 23])).toBe(1);
  });

  testSignals('preserves an earlier failed target when a later worker is signaled', () => {
    expect(runWorkers([23, 'SIGTERM'])).toBe(23);
  });
});
