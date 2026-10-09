import { spawnSync } from 'node:child_process';
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

const repoRoot = process.cwd();
const {
  scripts: { prepare },
} = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const describeBash = process.platform === 'win32' ? describe.skip : describe;
const checkoutFiles = {
  '.git/HEAD': 'ref: refs/heads/local-work\n',
  'tests/local.test.ts': 'export const localTest = true;\n',
  'local-notes.txt': 'untracked developer notes\n',
  'src/index.ts': 'export const source = true;\n',
};
const builtPackage = JSON.stringify({ name: 'git-install-fixture', version: '1.0.0', main: 'index.js' });
const builtModule = "module.exports = require('fixture-dependency');\n";
const dependency = "module.exports = 'compiled fixture\\n';\n";

describeBash('Git install prepare scripts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'openai git-install-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runPrepare(layout: string): string {
    const cwd = path.join(root, layout);
    const files = {
      ...checkoutFiles,
      'package.json': JSON.stringify({ name: 'git-install-fixture', scripts: { prepare } }),
      'dist/package.json': builtPackage,
      'dist/index.js': builtModule,
      'node_modules/fixture-dependency/index.js': dependency,
    };
    for (const [filename, contents] of Object.entries(files)) {
      const target = path.join(cwd, filename);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    mkdirSync(path.join(cwd, 'scripts/utils'), { recursive: true });
    for (const script of ['check-is-in-git-install.sh', 'git-swap.sh']) {
      const target = path.join(cwd, 'scripts/utils', script);
      copyFileSync(path.join(repoRoot, 'scripts/utils', script), target);
      chmodSync(target, 0o755);
    }
    // Only the successful build is stubbed; preparation uses the real lifecycle
    // command, detector, and artifact promotion script from this checkout.
    writeFileSync(
      path.join(cwd, 'scripts/build'),
      '#!/usr/bin/env bash\nset -eu\ntest -f dist/package.json\nprintf "built\\n" >> "$BUILD_LOG"\n',
      { mode: 0o755 },
    );
    const result = spawnSync('bash', ['-c', prepare], {
      cwd,
      env: { PATH: process.env['PATH'], BUILD_LOG: path.join(root, 'build.log') },
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect({
      status: result.status,
      output: result.status === 0 ? '' : result.stdout + result.stderr,
    }).toEqual({ status: 0, output: '' });
    expect(readFileSync(path.join(cwd, 'node_modules/fixture-dependency/index.js'), 'utf-8')).toBe(
      dependency,
    );
    return cwd;
  }

  test.each([
    'work/openai',
    'tmp/openai',
    '.tmp/openai',
    'tmp/git-clone-parent/project',
    '.tmp/project.prepare\n',
    'tmp\n/git-cloneABC123',
  ])('retains an ordinary checkout at %j', (layout) => {
    const cwd = runPrepare(layout);
    for (const [filename, contents] of Object.entries(checkoutFiles)) {
      expect(readFileSync(path.join(cwd, filename), 'utf-8')).toBe(contents);
    }
    expect(JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf-8')).scripts.prepare).toBe(prepare);
    expect(readFileSync(path.join(cwd, 'dist/package.json'), 'utf-8')).toBe(builtPackage);
    expect(readFileSync(path.join(cwd, 'dist/index.js'), 'utf-8')).toBe(builtModule);
    expect(existsSync(path.join(cwd, 'index.js'))).toBe(false);
    expect(existsSync(path.join(root, 'build.log'))).toBe(false);
  });

  test.each([
    'tmp/git-cloneABC123',
    'tmp/_tmp_123_abcd',
    '.tmp/repository.commit.prepare',
    'node_modules/openai',
  ])('promotes the built package in Git dependency staging at %s', (layout) => {
    const cwd = runPrepare(layout);
    expect(readFileSync(path.join(root, 'build.log'), 'utf-8')).toBe('built\n');
    expect(readFileSync(path.join(cwd, 'package.json'), 'utf-8')).toBe(builtPackage);
    expect(readFileSync(path.join(cwd, 'index.js'), 'utf-8')).toBe(builtModule);
    for (const filename of [...Object.keys(checkoutFiles), 'dist', 'scripts']) {
      expect(existsSync(path.join(cwd, filename))).toBe(false);
    }
    const loaded = spawnSync(process.execPath, ['-e', 'process.stdout.write(require(process.cwd()))'], {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(loaded.error).toBeUndefined();
    expect(loaded.status).toBe(0);
    expect(loaded.stderr).toBe('');
    expect(loaded.stdout).toBe('compiled fixture\n');
  });
});
