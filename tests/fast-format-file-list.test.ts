import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const source = 'export var value={a:1};\n';
const formattedSource = 'export const value = { a: 1 };\n';
const describeBash = process.platform === 'win32' ? describe.skip : describe;

function withFormatFixture(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'openai-node-fast-format-'));

  try {
    mkdirSync(path.join(root, 'scripts'));
    for (const script of ['fast-format', 'lint-generated.cjs', 'generated-files.cjs']) {
      copyFileSync(path.join(repoRoot, 'scripts', script), path.join(root, 'scripts', script));
    }
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    // The expected output requires both the lint fix and formatting to reach the listed file.
    writeFileSync(path.join(root, '.oxlintrc.json'), JSON.stringify({ rules: { 'no-var': 'error' } }));
    writeFileSync(path.join(root, 'unrelated.ts'), source);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fastFormat(root: string, fileList: string): void {
  writeFileSync(path.join(root, 'files.txt'), fileList);
  const result = spawnSync('bash', [path.join(root, 'scripts/fast-format'), 'files.txt'], {
    cwd: root,
    encoding: 'utf-8',
    timeout: 20_000,
  });

  expect(result.error).toBeUndefined();
  expect({ status: result.status, output: result.status === 0 ? '' : result.stdout + result.stderr }).toEqual(
    { status: 0, output: '' },
  );
  expect(readFileSync(path.join(root, 'unrelated.ts'), 'utf-8')).toBe(source);
}

describeBash('fast-format file lists', () => {
  test.each(['', '\n\n', '\r\n\r\n'])('does not format unrelated files for an empty list %j', (list) => {
    withFormatFixture((root) => fastFormat(root, list));
  });

  test.each([
    'selected.ts',
    'with spaces.ts',
    'with\ttab.ts',
    "with'quote.ts",
    'with"quote.ts',
    '-leading-dash.ts',
    '[u]nrelated.ts',
    '*.ts',
    '{unrelated,other}.ts',
  ])('formats the exact listed path %s', (filename) => {
    withFormatFixture((root) => {
      writeFileSync(path.join(root, filename), source);

      fastFormat(root, `${filename}\n`);

      expect(readFileSync(path.join(root, filename), 'utf-8')).toBe(formattedSource);
    });
  });

  test('ignores blank lines and accepts CRLF and a final path without a newline', () => {
    withFormatFixture((root) => {
      for (const filename of ['first file.ts', 'second.ts']) {
        writeFileSync(path.join(root, filename), source);
      }

      fastFormat(root, '\r\nfirst file.ts\r\n\r\nsecond.ts');

      for (const filename of ['first file.ts', 'second.ts']) {
        expect(readFileSync(path.join(root, filename), 'utf-8')).toBe(formattedSource);
      }
    });
  });

  test('formats listed non-JavaScript files without linting them', () => {
    withFormatFixture((root) => {
      const json = '{"value":1}\n';
      const filename = path.join(root, 'selected file.json');
      writeFileSync(filename, json);

      fastFormat(root, 'selected file.json\n');

      expect(readFileSync(filename, 'utf-8')).not.toBe(json);
      expect(JSON.parse(readFileSync(filename, 'utf-8'))).toEqual({ value: 1 });
    });
  });

  test.each(['deleted.ts', '[u]nrelated.ts', '*.ts', '{unrelated,other}.ts'])(
    'does not format unrelated files when listed path %s no longer exists',
    (filename) => {
      withFormatFixture((root) => fastFormat(root, filename));
    },
  );

  test('formats existing files alongside missing literal paths', () => {
    withFormatFixture((root) => {
      writeFileSync(path.join(root, 'selected.ts'), source);

      fastFormat(root, '[u]nrelated.ts\nselected.ts\n{unrelated,other}.ts\n*.ts');

      expect(readFileSync(path.join(root, 'selected.ts'), 'utf-8')).toBe(formattedSource);
    });
  });
});
