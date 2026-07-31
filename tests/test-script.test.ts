import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const testScriptPath = join(process.cwd(), 'scripts/test');

describe('scripts/test', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'openai-node-test-script-'));

    mkdirSync(join(fixtureDir, 'scripts'), { recursive: true });
    mkdirSync(join(fixtureDir, 'node_modules/.bin'), { recursive: true });
    mkdirSync(join(fixtureDir, 'bin'), { recursive: true });

    copyFileSync(testScriptPath, join(fixtureDir, 'scripts/test'));
    chmodSync(join(fixtureDir, 'scripts/test'), 0o755);

    writeExecutable(
      join(fixtureDir, 'bin/curl'),
      `#!/usr/bin/env bash
exit 0
`,
    );
    writeExecutable(
      join(fixtureDir, 'node_modules/.bin/jest'),
      `#!/usr/bin/env bash
printf '%s\\0' "$@" > "$JEST_ARGS_FILE"
`,
    );
    writeExecutable(
      join(fixtureDir, 'node_modules/.bin/vitest'),
      `#!/usr/bin/env bash
printf '%s\\0' "$@" > "$VITEST_ARGS_FILE"
`,
    );
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function writeExecutable(path: string, contents: string) {
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
  }

  function runTestScript(args: string[], suite = 'all'): { jestArgs: string[]; vitestArgs: string[] } {
    const jestArgsFile = join(fixtureDir, 'jest-args');
    const vitestArgsFile = join(fixtureDir, 'vitest-args');
    const result = spawnSync(join(fixtureDir, 'scripts/test'), args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        JEST_ARGS_FILE: jestArgsFile,
        OPENAI_TEST_SUITE: suite,
        PATH: `${join(fixtureDir, 'bin')}:${process.env['PATH']}`,
        VITEST_ARGS_FILE: vitestArgsFile,
      },
    });

    if (result.status !== 0) {
      throw new Error(
        `scripts/test exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    const readArgs = (path: string) =>
      existsSync(path) ? readFileSync(path, 'utf8').split('\0').slice(0, -1) : [];

    return { jestArgs: readArgs(jestArgsFile), vitestArgs: readArgs(vitestArgsFile) };
  }

  test('runs handwritten Vitest tests before generated serial Jest tests by default', () => {
    expect(runTestScript(['--showConfig'])).toEqual({
      jestArgs: ['--runInBand', '--showConfig'],
      vitestArgs: ['run', '--config', 'vitest.config.mts'],
    });
  });

  test('runs only handwritten Vitest tests for the unit suite', () => {
    expect(runTestScript(['tests/lib/parser.test.ts'], 'unit')).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts'],
    });
  });

  test('runs only generated Jest tests for the generated suite', () => {
    expect(runTestScript(['--showConfig'], 'generated')).toEqual({
      jestArgs: ['--runInBand', '--showConfig'],
      vitestArgs: [],
    });
  });

  test('routes handwritten path filters only to Vitest', () => {
    expect(runTestScript(['tests/lib/parser.test.ts'])).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts'],
    });
  });

  test('accepts the package-manager argument separator before handwritten filters', () => {
    expect(runTestScript(['--', 'tests/lib/parser.test.ts'])).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts'],
    });
  });

  test('routes generated path filters only to Jest', () => {
    expect(runTestScript(['tests/api-resources/models.test.ts'])).toEqual({
      jestArgs: ['--runInBand', 'tests/api-resources/models.test.ts'],
      vitestArgs: [],
    });
  });

  test('routes generated top-level client tests only to Jest', () => {
    expect(runTestScript(['tests/index.test.ts'])).toEqual({
      jestArgs: ['--runInBand', 'tests/index.test.ts'],
      vitestArgs: [],
    });
  });

  test('splits handwritten and generated path filters between their runners', () => {
    expect(runTestScript(['tests/lib/parser.test.ts', 'tests/api-resources/models.test.ts'])).toEqual({
      jestArgs: ['--runInBand', 'tests/api-resources/models.test.ts'],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts'],
    });
  });

  test('does not forward Jest-only worker options to a filtered Vitest run', () => {
    expect(runTestScript(['tests/lib/parser.test.ts', '--runInBand'])).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts'],
    });
  });

  test.each([
    { label: '--maxWorkers value', args: ['--maxWorkers', '2'] },
    { label: '--maxWorkers=value', args: ['--maxWorkers=2'] },
    { label: '--max-workers value', args: ['--max-workers', '2'] },
    { label: '--max-workers=value', args: ['--max-workers=2'] },
    { label: '-w value', args: ['-w', '2'] },
    { label: '-w=value', args: ['-w=2'] },
    { label: '-wvalue', args: ['-w2'] },
    { label: '--run-in-band', args: ['--run-in-band'] },
  ])('preserves explicit worker arguments: $label', ({ args }) => {
    expect(runTestScript(['--showConfig', ...args])).toEqual({
      jestArgs: ['--showConfig', ...args],
      vitestArgs: ['run', '--config', 'vitest.config.mts'],
    });
  });
});
