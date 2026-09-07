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

function writeShellExecutable(filename: string, source: string) {
  writeFileSync(filename, `#!/usr/bin/env bash\n${source}\n`, { mode: 0o755 });
}

function isProcessRunning(pid: number): boolean {
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

function readPid(filename: string): number | undefined {
  if (!existsSync(filename)) {
    return undefined;
  }

  const pid = Number(readFileSync(filename, 'utf-8'));
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

describe('Steady mock launcher', () => {
  test.each([
    ['foreground', false],
    ['daemon', true],
  ])('runs the pinned local launcher without pnpm in %s mode', (_mode, daemon) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-mock-launcher-'));
    const checkout = path.join(fixture, 'checkout');
    const executableDirectory = path.join(fixture, 'executables');
    const observationsFile = path.join(fixture, 'steady.jsonl');
    const pnpmInvocation = path.join(fixture, 'pnpm-invoked');
    const steadyPidFile = path.join(fixture, 'steady.pid');
    const url = 'fixtures/spec with spaces; $(touch shell-injection).yml';
    let steadyPid: number | undefined;

    try {
      mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
      mkdirSync(executableDirectory);
      writeFileSync(path.join(checkout, 'scripts/mock'), readFileSync(path.join(root, 'scripts/mock')));

      writeExecutable(
        path.join(checkout, 'scripts/run-steady'),
        [
          "const fs = require('node:fs');",
          'const args = process.argv.slice(2);',
          'const observation = { args, cwd: process.cwd(), node: process.version };',
          "if (args[0] !== '--version' && process.env.STEADY_DAEMON === 'true') {",
          '  fs.writeFileSync(process.env.STEADY_PID_FILE, String(process.pid));',
          '}',
          "fs.appendFileSync(process.env.STEADY_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
          "if (args[0] === '--version') process.stdout.write('0.22.2\\n');",
          "else if (process.env.STEADY_DAEMON === 'true') {",
          "  process.on('SIGTERM', () => process.exit(0));",
          '  setInterval(() => {}, 1000);',
          '}',
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
          "const daemonStarted = observations.some((line) => JSON.parse(line).args[0] !== '--version');",
          'process.exit(daemonStarted && fs.existsSync(process.env.STEADY_PID_FILE) ? 0 : 1);',
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
            STEADY_PID_FILE: steadyPidFile,
            PNPM_INVOCATION: pnpmInvocation,
          },
          timeout: 5000,
        },
      );
      if (daemon) {
        steadyPid = readPid(steadyPidFile);
      }

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
        expect(steadyPid).toBeDefined();
        if (steadyPid !== undefined) {
          expect(isProcessRunning(steadyPid)).toBe(true);
        }
      }
    } finally {
      steadyPid ??= readPid(steadyPidFile);
      if (steadyPid !== undefined && isProcessRunning(steadyPid)) {
        process.kill(steadyPid, 'SIGTERM');
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('preserves the startup failure after the daemon exits early', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-mock-launcher-exit-'));
    const checkout = path.join(fixture, 'checkout');
    const executableDirectory = path.join(fixture, 'executables');

    try {
      mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
      mkdirSync(executableDirectory);
      writeFileSync(path.join(checkout, 'scripts/mock'), readFileSync(path.join(root, 'scripts/mock')));

      writeShellExecutable(
        path.join(checkout, 'scripts/run-steady'),
        `if [[ "\${1-}" == "--version" ]]; then
  echo "0.22.2"
  exit 0
fi
echo "synthetic startup failure" >&2
exit 23`,
      );
      writeShellExecutable(path.join(executableDirectory, 'curl'), 'exit 1');

      const result = spawnSync('bash', [path.join(checkout, 'scripts/mock'), 'synthetic.yml', '--daemon'], {
        cwd: fixture,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${executableDirectory}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env['PATH']}`,
        },
        timeout: 5000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('synthetic startup failure');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('terminates the daemon if it times out before becoming healthy', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-mock-launcher-timeout-'));
    const checkout = path.join(fixture, 'checkout');
    const bashEnvironment = path.join(fixture, 'bash-env');
    const steadyPidFile = path.join(fixture, 'steady.pid');
    let steadyPid: number | undefined;

    try {
      mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
      writeFileSync(path.join(checkout, 'scripts/mock'), readFileSync(path.join(root, 'scripts/mock')));

      writeExecutable(
        path.join(checkout, 'scripts/run-steady'),
        [
          "const fs = require('node:fs');",
          "if (process.argv[2] === '--version') { console.log('0.22.2'); process.exit(0); }",
          'fs.writeFileSync(process.env.STEADY_PID_FILE, String(process.pid));',
          "process.on('SIGTERM', () => process.exit(0));",
          'setInterval(() => {}, 1000);',
        ].join('\n'),
      );
      writeFileSync(
        bashEnvironment,
        `curl() {
  attempts=0
while [[ ! -s "$STEADY_PID_FILE" && "$attempts" -lt 1000 ]]; do
  attempts=$((attempts + 1))
  :
done
  return 1
}
sleep() {
  :
}
`,
      );

      const curlWithoutPid = spawnSync('bash', ['-c', 'curl'], {
        env: { ...process.env, BASH_ENV: bashEnvironment, STEADY_PID_FILE: steadyPidFile },
        timeout: 1000,
      });
      expect(curlWithoutPid.error).toBeUndefined();
      expect(curlWithoutPid.status).toBe(1);

      const result = spawnSync('bash', [path.join(checkout, 'scripts/mock'), 'synthetic.yml', '--daemon'], {
        cwd: fixture,
        encoding: 'utf-8',
        env: {
          ...process.env,
          BASH_ENV: bashEnvironment,
          STEADY_PID_FILE: steadyPidFile,
        },
        timeout: 15_000,
      });
      steadyPid = readPid(steadyPidFile);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Timed out waiting for Steady server to start');
      expect(steadyPid).toBeDefined();
      if (steadyPid !== undefined) {
        expect(isProcessRunning(steadyPid)).toBe(false);
      }
    } finally {
      steadyPid ??= readPid(steadyPidFile);
      if (steadyPid !== undefined && isProcessRunning(steadyPid)) {
        process.kill(steadyPid, 'SIGTERM');
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
