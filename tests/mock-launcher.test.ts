import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const steadyArguments = [
  '--host',
  '127.0.0.1',
  '-p',
  '4010',
  '--validator-query-array-format=brackets',
  '--validator-form-array-format=brackets',
  '--validator-query-object-format=brackets',
  '--validator-form-object-format=brackets',
];

function writeExecutable(filename: string, source: string) {
  writeFileSync(filename, `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
}

describe('Steady mock launcher', () => {
  test.each([
    ['foreground', false],
    ['daemon', true],
  ])('runs the locked local binary without pnpm in %s mode', (_mode, daemon) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-mock-launcher-'));
    const checkout = path.join(fixture, 'checkout');
    const executableDirectory = path.join(fixture, 'executables');
    const observationsFile = path.join(fixture, 'steady.jsonl');
    const pnpmInvocation = path.join(fixture, 'pnpm-invoked');
    const url = 'fixtures/spec with spaces; $(touch shell-injection).yml';

    try {
      mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
      mkdirSync(path.join(checkout, 'node_modules/.bin'), { recursive: true });
      mkdirSync(executableDirectory);
      writeFileSync(path.join(checkout, 'scripts/mock'), readFileSync(path.join(root, 'scripts/mock')));

      writeExecutable(
        path.join(checkout, 'node_modules/.bin/steady'),
        [
          "const fs = require('node:fs');",
          'const args = process.argv.slice(2);',
          'const observation = { args, cwd: process.cwd(), node: process.version };',
          "fs.appendFileSync(process.env.STEADY_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
          "if (args[0] === '--version') process.stdout.write('0.22.2\\n');",
          "else if (process.env.STEADY_DAEMON === 'true') setTimeout(() => {}, 500);",
        ].join('\n'),
      );
      writeExecutable(
        path.join(executableDirectory, 'pnpm'),
        [
          "require('node:fs').writeFileSync(process.env.PNPM_INVOCATION, process.version);",
          "process.stderr.write('pnpm must not start on the SDK runtime\\n');",
          'process.exit(92);',
        ].join('\n'),
      );
      writeExecutable(
        path.join(executableDirectory, 'curl'),
        [
          "const fs = require('node:fs');",
          "const observations = fs.existsSync(process.env.STEADY_OBSERVATIONS) ? fs.readFileSync(process.env.STEADY_OBSERVATIONS, 'utf8').trim().split('\\n') : [];",
          "process.exit(observations.some((line) => JSON.parse(line).args[0] !== '--version') ? 0 : 1);",
        ].join('\n'),
      );

      const result = spawnSync(
        'bash',
        [path.join(checkout, 'scripts/mock'), url, ...(daemon ? ['--daemon'] : [])],
        {
          cwd: fixture,
          encoding: 'utf-8',
          env: {
            ...process.env,
            PATH: `${executableDirectory}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env['PATH']}`,
            STEADY_DAEMON: String(daemon),
            STEADY_OBSERVATIONS: observationsFile,
            PNPM_INVOCATION: pnpmInvocation,
          },
          timeout: 5000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(existsSync(pnpmInvocation)).toBe(false);
      expect(existsSync(path.join(checkout, 'shell-injection'))).toBe(false);

      const observations = readFileSync(observationsFile, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { args: string[]; cwd: string; node: string });
      const cwd = realpathSync(checkout);
      const expected = { args: [...steadyArguments, url], cwd, node: process.version };

      expect(observations).toEqual(
        daemon ? [{ args: ['--version'], cwd, node: process.version }, expected] : [expected],
      );
      if (daemon) {
        expect(result.stdout).toContain('Waiting for server');
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
