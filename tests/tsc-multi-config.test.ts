import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const cli = path.join(repoRoot, 'scripts/_vendor/tsc-multi/src/cli.ts');
const build = path.join(repoRoot, 'scripts/_vendor/tsc-multi/src/build.ts');
const register = createRequire(path.join(repoRoot, 'package.json')).resolve(
  'ts-node/register/transpile-only',
);

describe('tsc-multi worker-limit configuration', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-tsc-config-'));
    // Capture the build boundary while exercising the real CLI, config loader, and argument parser.
    // Worker timing is irrelevant to whether the selected configuration reaches the scheduler.
    writeFileSync(
      path.join(fixture, 'capture-build.cjs'),
      `require(${JSON.stringify(build)}).build = async (options) => {
  process.stdout.write(JSON.stringify({ maxWorkers: options.maxWorkers ?? null }));
  return 0;
};
`,
    );
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  test.each([
    { scenario: 'uses the configured limit without a flag', configured: 1, flag: undefined, expected: 1 },
    { scenario: 'allows a smaller explicit override', configured: 2, flag: 1, expected: 1 },
    { scenario: 'allows a larger explicit override', configured: 1, flag: 2, expected: 2 },
    {
      scenario: 'preserves the default when neither is set',
      configured: undefined,
      flag: undefined,
      expected: null,
    },
    { scenario: 'uses a flag without a configured limit', configured: undefined, flag: 3, expected: 3 },
    { scenario: 'passes explicit zero through for build validation', configured: 1, flag: 0, expected: 0 },
  ])('$scenario', ({ configured, flag, expected }) => {
    writeFileSync(path.join(fixture, 'tsc-multi.json'), JSON.stringify({ maxWorkers: configured }));
    const result = spawnSync(
      process.execPath,
      [
        '-r',
        register,
        '-r',
        path.join(fixture, 'capture-build.cjs'),
        cli,
        '--cwd',
        fixture,
        ...(flag === undefined ? [] : ['--maxWorkers', String(flag)]),
      ],
      { cwd: repoRoot, encoding: 'utf-8', timeout: 15_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ maxWorkers: expected });
  });
});
