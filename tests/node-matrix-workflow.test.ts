import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8').split('\r\n').join('\n');
const policyStep = workflow.split('      - name: Read policy matrix\n')[1]?.split(/\n(?: {6}- | {2}\S)/u)[0];
const run = policyStep?.split('        run: ')[1]?.trimEnd();

if (!run) {
  throw new Error('Missing Read policy matrix workflow step');
}

const script = run.startsWith('|\n')
  ? run
      .slice(2)
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n')
  : run;
const existingOutput = 'existing=preserved\n';

// The workflow runs on Ubuntu; native Windows does not use this Bash step.
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
describeOnUnix('Node.js policy matrix workflow', () => {
  let fixture: string;
  let outputFile: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-policy-matrix-'));
    for (const file of [
      'scripts/check-node-version-policy.ts',
      '.github/workflows/ci.yml',
      '.github/CONTRIBUTING.md',
      '.nvmrc',
      'package.json',
      'README.md',
      'NODE_VERSION_POLICY.md',
    ]) {
      const target = path.join(fixture, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(root, file), target);
    }
    outputFile = path.join(fixture, 'github output');
    writeFileSync(outputFile, existingOutput);
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function runStep() {
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: fixture,
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env['PATH'] ?? ''}`,
        GITHUB_OUTPUT: outputFile,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('');
    return result;
  }

  test('appends the unchanged policy matrix on success', () => {
    const checker = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/check-node-version-policy.ts', '--matrix'],
      { cwd: fixture, encoding: 'utf-8', timeout: 10_000, env: {} },
    );
    expect(checker.error).toBeUndefined();
    expect(checker.status).toBe(0);
    expect(JSON.parse(checker.stdout).include.length).toBeGreaterThan(0);

    expect(runStep().status).toBe(0);
    expect(readFileSync(outputFile, 'utf-8')).toBe(`${existingOutput}matrix=${checker.stdout}\n`);
  });

  test('fails at the policy step without publishing a matrix when metadata drifts', () => {
    const packagePath = path.join(fixture, 'package.json');
    const metadata = JSON.parse(readFileSync(packagePath, 'utf-8'));
    metadata.engines.node = '>=0.0.0';
    writeFileSync(packagePath, JSON.stringify(metadata));

    const result = runStep();
    expect(result.stderr).toContain('package.json#engines.node must match the policy minimum');
    expect(result.status).toBe(1);
    expect(readFileSync(outputFile, 'utf-8')).toBe(existingOutput);
  });

  test('preserves a policy file read failure without publishing a matrix', () => {
    rmSync(path.join(fixture, 'NODE_VERSION_POLICY.md'));

    const result = runStep();
    expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).toContain('NODE_VERSION_POLICY.md');
    expect(result.status).toBe(1);
    expect(readFileSync(outputFile, 'utf-8')).toBe(existingOutput);
  });
});
