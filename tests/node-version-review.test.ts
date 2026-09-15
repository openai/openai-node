import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const verifier = path.join(root, 'scripts/node-version-review.py');
const workflow = readFileSync(path.join(root, '.github/workflows/node-version-review.yml'), 'utf-8');
const files = ['.nvmrc', 'package.json', 'README.md', '.github/CONTRIBUTING.md', 'NODE_VERSION_POLICY.md'];
const environment = {
  PATH: process.env['PATH'],
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

// These jobs run on Ubuntu and require its Python and Git installations.
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
describeOnUnix('monthly Node review proposal boundary', () => {
  let fixture: string;
  let checkout: string;
  let proposalPath: string;
  let bodyPath: string;
  let outputPath: string;
  let base: string;
  let metadata: Record<string, any>;

  function git(...args: string[]) {
    const result = spawnSync('git', args, { cwd: checkout, env: environment, encoding: 'utf-8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return result.stdout.trim();
  }

  function commit() {
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  }

  function run(command = 'apply', extraEnv: Record<string, string> = {}) {
    const result = spawnSync(
      'python3',
      [verifier, command, '--base-sha', base, '--proposal', proposalPath, '--body-output', bodyPath],
      {
        cwd: checkout,
        env: { ...environment, GITHUB_OUTPUT: outputPath, ...extraEnv },
        encoding: 'utf-8',
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return result;
  }

  function proposal(changes: Record<string, unknown> = {}, body: unknown = 'Review summary') {
    return { base_sha: base, files: changes, body };
  }

  function rejects(raw: string) {
    const before = files.map((file) => readFileSync(path.join(checkout, file), 'utf-8'));
    writeFileSync(proposalPath, raw);
    expect(run().status).toBe(1);
    expect(files.map((file) => readFileSync(path.join(checkout, file), 'utf-8'))).toEqual(before);
    expect(existsSync(bodyPath)).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(git('status', '--porcelain')).toBe('');
  }

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-review-'));
    checkout = path.join(fixture, 'checkout');
    proposalPath = path.join(fixture, 'proposal.json');
    bodyPath = path.join(fixture, 'body.md');
    outputPath = path.join(fixture, 'output');
    mkdirSync(path.join(checkout, '.github'), { recursive: true });
    metadata = {
      name: 'policy-fixture',
      engines: { node: '>=22.0.0' },
      scripts: { test: 'echo trusted' },
      dependencies: { example: '1.0.0' },
      exports: { '.': './index.js' },
      packageManager: 'pnpm@10.10.0',
      flags: { enabled: true, count: 1, empty: null },
    };
    for (const file of files) {
      writeFileSync(path.join(checkout, file), 'Baseline documentation\n');
    }
    writeFileSync(path.join(checkout, '.nvmrc'), '24\n');
    writeFileSync(path.join(checkout, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Workflow Test');
    git('config', 'user.email', 'workflow-test@example.com');
    base = commit();
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  test('exports and applies policy edits with an inert Markdown body', () => {
    const body = `## Summary\n$(touch '${fixture}/executed')\n\`touch '${fixture}/executed'\`\n`;
    metadata['engines'].node = '>=24.0.0';
    writeFileSync(path.join(checkout, 'package.json'), JSON.stringify(metadata));
    writeFileSync(path.join(checkout, '.nvmrc'), '26\n');
    writeFileSync(path.join(checkout, 'README.md'), 'Updated policy\n');
    expect(run('export', { REVIEW_BODY: body }).status).toBe(0);
    git('reset', '--hard', base);
    expect(run().status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf-8'))).toEqual(metadata);
    expect(readFileSync(path.join(checkout, '.nvmrc'), 'utf-8')).toBe('26\n');
    expect(readFileSync(path.join(checkout, 'README.md'), 'utf-8')).toBe('Updated policy\n');
    expect(readFileSync(bodyPath, 'utf-8')).toContain(body);
    expect(readFileSync(outputPath, 'utf-8')).toBe('changed=true\n');
    expect(existsSync(path.join(fixture, 'executed'))).toBe(false);
  });

  test('preserves actual repository package formatting when there is no policy change', () => {
    const actualPackage = readFileSync(path.join(root, 'package.json'), 'utf-8');
    writeFileSync(path.join(checkout, 'package.json'), actualPackage);
    base = commit();
    writeFileSync(proposalPath, JSON.stringify(proposal({ 'package.json': actualPackage })));
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(checkout, 'package.json'), 'utf-8')).toBe(actualPackage);
    expect(readFileSync(outputPath, 'utf-8')).toBe('changed=false\n');
    expect(git('status', '--porcelain')).toBe('');
  });

  test('accepts an empty proposal as a no-op', () => {
    expect(run('export').status).toBe(0);
    expect(JSON.parse(readFileSync(proposalPath, 'utf-8')).files).toEqual({});
    expect(run().status).toBe(0);
    expect(readFileSync(outputPath, 'utf-8')).toBe('changed=false\n');
  });

  test.each([
    ['wrong commit', () => ({ ...proposal(), base_sha: '0'.repeat(40) })],
    ['unknown path', () => proposal({ 'scripts/lint': 'touch /tmp/executed' })],
    ['traversal', () => proposal({ '../README.md': 'text' })],
    ['extra field', () => ({ ...proposal(), mode: '100755' })],
    ['non-object envelope', () => []],
    ['non-object files', () => ({ ...proposal(), files: [] })],
    ['non-text body', () => proposal({}, [])],
    ['non-text file', () => proposal({ 'README.md': { content: 'text', mode: '100755' } })],
    ['NUL text', () => proposal({ 'README.md': '\0' })],
    ['invalid later file', () => proposal({ 'README.md': 'Valid first edit', 'package.json': '{}' })],
  ])('rejects %s without partially applying files', (_name, makeProposal) => {
    rejects(JSON.stringify(makeProposal()));
  });

  test.each(['lts/*', 'v26', '026', '26\n28', '２６', '26\n\n'])('rejects .nvmrc value %j', (value) => {
    rejects(JSON.stringify(proposal({ '.nvmrc': value })));
  });

  test.each(['scripts', 'dependencies', 'exports', 'packageManager'])(
    'rejects package.json %s changes',
    (key) => {
      metadata[key] = key === 'packageManager' ? 'pnpm@99.0.0' : { changed: 'untrusted' };
      rejects(JSON.stringify(proposal({ 'package.json': JSON.stringify(metadata) })));
    },
  );

  test.each([
    ['boolean to number', '"enabled":true', '"enabled":1'],
    ['number to boolean', '"count":1', '"count":true'],
    ['integer to float', '"count":1', '"count":1.0'],
    ['nonfinite number', '"count":1', '"count":NaN'],
    ['overflowing number', '"count":1', '"count":1e999'],
    ['duplicate escaped key', '"count":1', '"count":1,"\\u0063ount":1'],
  ])('rejects package.json %s', (_name, before, after) => {
    rejects(JSON.stringify(proposal({ 'package.json': JSON.stringify(metadata).replace(before, after) })));
  });

  test.each(['"body":"first",', '"\\u0062ody":"first",'])('rejects duplicate envelope keys %s', (key) => {
    const raw = JSON.stringify(proposal());
    rejects(`{${key}${raw.slice(1)}`);
  });

  test.each(['NaN', 'Infinity', '-Infinity'])('rejects nonstandard JSON %s', (constant) => {
    rejects(JSON.stringify(proposal()).replace('"Review summary"', constant));
  });

  test.each(['symlink', 'executable', 'source change'])('does not export %s', (kind) => {
    const target = path.join(checkout, 'README.md');
    if (kind === 'symlink') {
      rmSync(target);
      symlinkSync(bodyPath, target);
    } else if (kind === 'executable') {
      chmodSync(target, 0o755);
    } else {
      writeFileSync(path.join(checkout, 'unapproved.js'), 'throw new Error("untrusted")');
    }
    expect(run('export').status).toBe(1);
    expect(existsSync(proposalPath)).toBe(false);
  });

  test('rejects a symlinked artifact', () => {
    const target = path.join(fixture, 'other.json');
    writeFileSync(target, JSON.stringify(proposal({ 'README.md': 'new' })));
    symlinkSync(target, proposalPath);
    expect(run().status).toBe(1);
    expect(git('status', '--porcelain')).toBe('');
    expect(existsSync(bodyPath)).toBe(false);
  });

  test('keeps the validated base when remote main advances before publication', () => {
    const remote = path.join(fixture, 'remote.git');
    git('init', '--bare', '-q', remote);
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'main');
    writeFileSync(path.join(checkout, 'README.md'), 'Concurrent main update\n');
    const advanced = commit();
    git('push', '-q', 'origin', 'main');
    git('checkout', '--detach', base);
    expect(git('rev-parse', 'origin/main')).toBe(advanced);

    const step = workflow
      .split('      - name: Preserve the validated base\n')[1]
      ?.split('\n      - name:')[0];
    const script = step
      ?.split('        run: |\n')[1]
      ?.split('\n')
      .map((line) => line.slice(10))
      .join('\n');
    if (!script) {
      throw new Error('Missing trusted publisher base setup');
    }
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: checkout,
      env: { ...environment, EXPECTED_BASE_SHA: base },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(git('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(git('rev-parse', 'main')).toBe(base);
    expect(git('rev-parse', 'origin/main')).toBe(base);
    expect(git('ls-remote', 'origin', 'refs/heads/main')).toContain(advanced);
    writeFileSync(proposalPath, JSON.stringify(proposal({ 'README.md': 'Reviewed policy\n' })));
    expect(run().status).toBe(0);
    commit();
    expect(git('rev-parse', 'HEAD^')).toBe(base);
  });
});

describe('monthly Node review workflow authority', () => {
  const propose = workflow.split('\n  propose:\n')[1]?.split('\n  validate:\n')[0] ?? '';
  const validate = workflow.split('\n  validate:\n')[1]?.split('\n  publish:\n')[0] ?? '';
  const publish = workflow.split('\n  publish:\n')[1] ?? '';

  test('separates agent, validation, and publication capabilities', () => {
    expect(workflow.split('\njobs:')[0]).toContain('permissions: {}');
    for (const job of [propose, validate, publish]) {
      expect(job).toContain(`ref: \${{ github.sha }}`);
      expect(job).toContain('persist-credentials: false');
    }
    for (const job of [propose, validate]) {
      expect(job).toContain('contents: read');
      expect(job).not.toContain(': write');
    }
    expect(propose).toContain('environment: ci');
    expect(propose).toContain('secrets.OPENAI_API_KEY');
    expect(validate).not.toMatch(/environment:|secrets\.|codex-action/u);
    expect(publish).not.toMatch(
      /environment:|secrets\.|codex-action|setup-node|pnpm|scripts\/(?:test|build|lint)/u,
    );
    expect(publish).toContain('needs: [propose, validate]');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('pull-requests: write');
    expect(publish).toContain('base: main');
    expect(publish).toContain(`body-path: \${{ runner.temp }}/node-review-body.md`);
    expect(publish).toContain('draft: always-true');
    expect(publish).toContain('delete-branch: true');
    expect(publish).not.toContain('final-message');
    // Let the pinned action clean up an obsolete draft branch on a no-op, too.
    expect(publish.split('      - name: Open or update the draft pull request\n')[1]).not.toContain('if:');
  });

  test('independently verifies the same original artifact before installation or publication', () => {
    expect(propose).toContain(`node-review-proposal-\${{ github.run_id }}-\${{ github.run_attempt }}`);
    expect(workflow.match(/uses: actions\/upload-artifact@/gu)).toHaveLength(1);
    for (const job of [validate, publish]) {
      expect(job).toContain(`artifact-ids: \${{ needs.propose.outputs.artifact-id }}`);
      expect(job).toContain('digest-mismatch: error');
      expect(job).toContain(`EXPECTED_BASE_SHA: \${{ github.sha }}`);
      expect(job).toContain('python3 scripts/node-version-review.py apply');
    }
    expect(validate.indexOf('Verify and apply')).toBeLessThan(validate.indexOf('Set up pnpm'));
    expect(validate.indexOf('Verify and apply')).toBeLessThan(validate.indexOf('Set up Node'));
    expect(publish.indexOf('Preserve the validated base')).toBeLessThan(publish.indexOf('Verify and apply'));
    expect(publish.indexOf('Verify and apply')).toBeLessThan(publish.indexOf('create-pull-request@'));
    for (const action of workflow.matchAll(/uses: (?<action>[^\n ]+)/gu)) {
      expect(action[1]).toMatch(/@[a-f0-9]{40}$/u);
    }
  });
});
