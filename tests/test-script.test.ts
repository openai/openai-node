import {
  chmodSync,
  copyFileSync,
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
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function writeExecutable(path: string, contents: string) {
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
  }

  function runTestScript(...args: string[]): string[] {
    const jestArgsFile = join(fixtureDir, 'jest-args');
    const result = spawnSync(join(fixtureDir, 'scripts/test'), args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        JEST_ARGS_FILE: jestArgsFile,
        PATH: `${join(fixtureDir, 'bin')}:${process.env['PATH']}`,
      },
    });

    if (result.status !== 0) {
      throw new Error(
        `scripts/test exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    return readFileSync(jestArgsFile, 'utf8').split('\0').slice(0, -1);
  }

  test('defaults to serial Jest execution with the local Steady server', () => {
    expect(runTestScript('--showConfig')).toEqual(['--runInBand', '--showConfig']);
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
    expect(runTestScript('--showConfig', ...args)).toEqual(['--showConfig', ...args]);
  });
});
