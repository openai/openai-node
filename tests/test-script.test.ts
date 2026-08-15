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
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import jestConfig from '../jest.config';
import generatedTestPatterns from '../scripts/generated-test-patterns.json';

const testScriptPath = path.join(process.cwd(), 'scripts/test');
const generatedTestPatternsPath = path.join(process.cwd(), 'scripts/generated-test-patterns.json');
const generatedTopLevelTests = generatedTestPatterns
  .filter((pattern) => pattern.endsWith('.test.ts'))
  .map((pattern) => path.basename(pattern));

function toBashPath(path: string): string {
  if (process.platform !== 'win32') {
    return path;
  }
  return path
    .replace(/^[A-Za-z]:[\\/]/u, (prefix) => `/${prefix.charAt(0).toLowerCase()}/`)
    .split('\\')
    .join('/');
}

function toBashArgument(arg: string): string {
  if (process.platform !== 'win32' || !/^[A-Za-z]:[\\/]/u.test(arg)) {
    return arg;
  }
  return arg.split('\\').join('/');
}

describe('scripts/test', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'openai-node-test-script-'));

    mkdirSync(path.join(fixtureDir, 'scripts'), { recursive: true });
    mkdirSync(path.join(fixtureDir, 'node_modules/.bin'), { recursive: true });
    mkdirSync(path.join(fixtureDir, 'bin'), { recursive: true });

    copyFileSync(testScriptPath, path.join(fixtureDir, 'scripts/test'));
    copyFileSync(generatedTestPatternsPath, path.join(fixtureDir, 'scripts/generated-test-patterns.json'));
    chmodSync(path.join(fixtureDir, 'scripts/test'), 0o755);

    writeExecutable(
      path.join(fixtureDir, 'bin/curl'),
      `#!/usr/bin/env bash
exit 0
`,
    );
    writeExecutable(
      path.join(fixtureDir, 'node_modules/.bin/jest'),
      `#!/usr/bin/env bash
printf '%s\\0' "$@" > "$JEST_ARGS_FILE"
`,
    );
    writeExecutable(
      path.join(fixtureDir, 'node_modules/.bin/vitest'),
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
    const jestArgsFile = path.join(fixtureDir, 'jest-args');
    const vitestArgsFile = path.join(fixtureDir, 'vitest-args');
    const result = spawnSync(
      'bash',
      [
        '-c',
        'PATH="$1:$PATH"; shift; exec "$@"',
        'bash',
        toBashPath(path.join(fixtureDir, 'bin')),
        toBashPath(path.join(fixtureDir, 'scripts/test')),
        ...args.map(toBashArgument),
      ],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          JEST_ARGS_FILE: toBashPath(jestArgsFile),
          OPENAI_TEST_SUITE: suite,
          VITEST_ARGS_FILE: toBashPath(vitestArgsFile),
        },
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `scripts/test exited with ${result.status}\nerror:\n${result.error?.message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    const readArgs = (path: string) =>
      existsSync(path) ? readFileSync(path, 'utf-8').split('\0').slice(0, -1) : [];

    return { jestArgs: readArgs(jestArgsFile), vitestArgs: readArgs(vitestArgsFile) };
  }

  test('keeps Jest limited to the canonical generated suites without a Vitest compatibility layer', () => {
    expect(jestConfig.setupFiles).toEqual(['<rootDir>/scripts/jest-setup.ts']);
    expect(jestConfig.testMatch).toEqual(
      generatedTestPatterns.map(
        (pattern) => `<rootDir>/${pattern}${pattern.endsWith('.test.ts') ? '' : '/**/*.test.ts'}`,
      ),
    );
    expect(jestConfig.moduleNameMapper).not.toHaveProperty('^vitest$');
  });

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

  test.each(generatedTopLevelTests)('routes manifest-listed top-level test %s only to Jest', (file) => {
    const testPath = `tests/${file}`;

    expect(runTestScript([testPath])).toEqual({
      jestArgs: ['--runInBand', testPath],
      vitestArgs: [],
    });
  });

  test.each([
    { label: 'relative', testPath: './tests/index.test.ts', expectedTestPath: './tests/index.test.ts' },
    {
      label: 'absolute',
      testPath: path.join(process.cwd(), 'tests/index.test.ts'),
      expectedTestPath: toBashArgument(path.join(process.cwd(), 'tests/index.test.ts')),
    },
  ])('routes $label generated path filters only to Jest', ({ testPath, expectedTestPath }) => {
    expect(runTestScript([testPath])).toEqual({
      jestArgs: ['--runInBand', expectedTestPath],
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

  test('forwards worker limits to both runners for the full suite', () => {
    expect(runTestScript(['--maxWorkers=1'])).toEqual({
      jestArgs: ['--maxWorkers=1'],
      vitestArgs: ['run', '--config', 'vitest.config.mts', '--maxWorkers=1'],
    });
  });

  test('forwards worker limits to filtered handwritten tests', () => {
    expect(runTestScript(['tests/lib/parser.test.ts', '--maxWorkers', '1'])).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', 'tests/lib/parser.test.ts', '--maxWorkers', '1'],
    });
  });

  test('forwards worker limits to the unit-only suite', () => {
    expect(runTestScript(['--max-workers', '1'], 'unit')).toEqual({
      jestArgs: [],
      vitestArgs: ['run', '--config', 'vitest.config.mts', '--maxWorkers', '1'],
    });
  });

  test('preserves worker limits for the generated-only suite', () => {
    expect(runTestScript(['--maxWorkers=1'], 'generated')).toEqual({
      jestArgs: ['--maxWorkers=1'],
      vitestArgs: [],
    });
  });

  test('does not forward Jest-only worker options to an unfiltered Vitest run', () => {
    expect(runTestScript(['--showConfig', '--run-in-band'])).toEqual({
      jestArgs: ['--showConfig', '--run-in-band'],
      vitestArgs: ['run', '--config', 'vitest.config.mts'],
    });
  });

  test.each([
    { label: '--maxWorkers value', args: ['--maxWorkers', '2'], vitestArgs: ['--maxWorkers', '2'] },
    { label: '--maxWorkers=value', args: ['--maxWorkers=2'], vitestArgs: ['--maxWorkers=2'] },
    { label: '--max-workers value', args: ['--max-workers', '2'], vitestArgs: ['--maxWorkers', '2'] },
    { label: '--max-workers=value', args: ['--max-workers=2'], vitestArgs: ['--maxWorkers=2'] },
    { label: '-w value', args: ['-w', '2'], vitestArgs: ['--maxWorkers', '2'] },
    { label: '-w=value', args: ['-w=2'], vitestArgs: ['--maxWorkers=2'] },
    { label: '-wvalue', args: ['-w2'], vitestArgs: ['--maxWorkers=2'] },
  ])('forwards explicit worker arguments to both runners: $label', ({ args, vitestArgs }) => {
    expect(runTestScript(['--showConfig', ...args])).toEqual({
      jestArgs: ['--showConfig', ...args],
      vitestArgs: ['run', '--config', 'vitest.config.mts', ...vitestArgs],
    });
  });
});
