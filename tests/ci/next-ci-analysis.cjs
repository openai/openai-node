const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(
  path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
  'utf-8',
);
const prepare = workflow.slice(
  workflow.indexOf('              git config core.hooksPath'),
  workflow.indexOf('              test "$(cat .nvmrc)"'),
);
const [restore] = workflow.match(
  /rm -rf tests examples\n\s+git archive --worktree-attributes --output=\.git\/next-consumers\.tar "\$BASE_SHA" tests examples\n\s+tar -xf \.git\/next-consumers\.tar\n[^\n]*\n\s+git restore[^\n]*/u,
);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-pinned-analysis-'));
const git = (...args) =>
  execFileSync('git', args, { cwd: directory, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (file, contents) => {
  fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  fs.writeFileSync(path.join(directory, file), contents);
};
const commit = () => {
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return git('rev-parse', 'HEAD');
};
const tsc = require.resolve('typescript/bin/tsc');
try {
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'test@example.invalid');
  write('src/index.ts', 'export default class SDK { retained() {} }');
  write('tests/consumer.ts', "import SDK from 'openai'; new SDK().retained();");
  write('examples/example.ts', 'export const example=true;');
  const base = commit();
  write('.nvmrc', '24');
  write(
    'scripts/bootstrap',
    'echo trusted > executed; mkdir -p examples/node_modules; touch examples/node_modules/installed',
  );
  write('examples/package.json', '{"private":true}');
  write('examples/tsconfig.json', '{"compilerOptions":{"strict":true}}');
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        types: [],
        module: 'preserve',
        moduleResolution: 'bundler',
        paths: { openai: ['./src/index.ts'] },
      },
      include: ['src', 'tests', 'examples'],
    }),
  );
  write('package.json', '{"packageManager":"pnpm@10.0.0"}');
  const tooling = commit();
  write('.castiron-ratchet.json', JSON.stringify({ next_policy: { main_sha: tooling } }));
  const modern = commit();
  git('checkout', '--detach', base);
  write('.castiron-ratchet.json', JSON.stringify({ next_policy: { main_sha: tooling } }));
  const valid = commit();
  write('src/index.ts', 'export default class SDK { replacement() {} }');
  write('tests/shadow.ts', "declare module 'openai' { const SDK:any; export default SDK; }");
  write('scripts/bootstrap', 'echo candidate > executed');
  write('.gitattributes', 'src/* export-ignore export-subst');
  const broken = commit();
  write('src/oxlint.config.ts', "throw new Error('candidate tooling executed')");
  const malicious = commit();
  for (const [candidate, passes] of [
    [valid, true],
    [modern, true],
    [broken, false],
    [malicious, null],
  ]) {
    git('checkout', '--detach', '--force', candidate);
    const analysis = fs.mkdtempSync(path.join(os.tmpdir(), 'next-git-only-analysis-'));
    try {
      fs.cpSync(path.join(directory, '.git'), path.join(analysis, '.git'), { recursive: true });
      assert.deepEqual(fs.readdirSync(analysis), ['.git']);
      const env = { ...process.env, TOOLING_SHA: tooling, CANDIDATE_SHA: candidate, BASE_SHA: base };
      const prepared = spawnSync(
        'bash',
        ['-euo', 'pipefail', '-c', `${prepare}\n${restore}\nbash scripts/bootstrap\n`],
        { cwd: analysis, env, encoding: 'utf-8' },
      );
      assert.equal(fs.readFileSync(path.join(analysis, '.nvmrc'), 'utf-8'), '24');
      assert(fs.existsSync(path.join(analysis, 'package.json')));
      if (passes === null) {
        assert.equal(prepared.status, 1, 'source tooling guard must reject candidate config');
        continue;
      }
      assert.equal(prepared.status, 0, prepared.stderr);
      assert.equal(fs.readFileSync(path.join(analysis, 'executed'), 'utf-8').trim(), 'trusted');
      assert.equal(
        fs.readFileSync(path.join(analysis, 'src/index.ts'), 'utf-8'),
        git('show', `${candidate}:src/index.ts`),
      );
      assert(!fs.existsSync(path.join(analysis, 'tests/shadow.ts')));
      assert(fs.existsSync(path.join(analysis, 'examples/node_modules/installed')));
      assert.equal(
        fs.readFileSync(path.join(analysis, 'examples/package.json'), 'utf-8'),
        git('show', `${tooling}:examples/package.json`),
      );
      const check = spawnSync(
        process.execPath,
        [tsc, '--pretty', 'false', '--project', path.join(analysis, 'tsconfig.json')],
        { cwd: analysis, encoding: 'utf-8' },
      );
      if (passes) {
        assert.equal(check.status, 0, check.stdout);
      } else {
        assert.notEqual(check.status, 0);
        assert(check.stdout.includes("Property 'retained' does not exist"), check.stdout);
      }
    } finally {
      fs.rmSync(analysis, { recursive: true, force: true });
    }
  }
  console.log(
    'Real legacy-tooling bootstrap and broken-source TypeScript checks passed; candidate tooling/shims/export attributes cannot mask source',
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
