import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const oxlintURL = pathToFileURL(realpathSync(path.join(repoRoot, 'node_modules/oxlint/bin/oxlint'))).href;
const header = '// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.';
const handwritten = "import { Unused } from './dependency';\nexport const value = 1;\n";
const generated = `${header}\n${handwritten}`;
const clean = `${header}\nexport const value = 1;\n`;

function lintGenerated(root: string, mode: string, files: string[]) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/lint-generated.cjs'), mode, ...files],
    {
      cwd: root,
      encoding: 'utf-8',
      timeout: 15_000,
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

describe('generated lint literal paths', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'openai-node-generated-lint-paths-'));
    mkdirSync(path.join(root, 'scripts'));
    for (const file of [
      'scripts/lint-generated.cjs',
      'scripts/generated-files.cjs',
      'oxlint.generated.config.json',
    ]) {
      copyFileSync(path.join(repoRoot, file), path.join(root, file));
    }

    // Keep all fixture directories owned while running the unchanged, real lint CLI.
    const oxlintDirectory = path.join(root, 'node_modules/oxlint');
    mkdirSync(path.join(oxlintDirectory, 'bin'), { recursive: true });
    writeFileSync(path.join(oxlintDirectory, 'package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(oxlintDirectory, 'bin/oxlint'), `import ${JSON.stringify(oxlintURL)};\n`);

    writeFileSync(path.join(root, 'unrelated-generated.ts'), generated);
    writeFileSync(path.join(root, 'unrelated-handwritten.ts'), handwritten);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test.each([
    { filename: '-clean.ts', fileList: false },
    { filename: '-clean.ts', fileList: true },
    { filename: 'normal.ts', fileList: false },
  ])('checks and fixes only $filename (file list: $fileList)', ({ filename, fileList }) => {
    const selected = path.join(root, filename);
    writeFileSync(selected, clean);
    writeFileSync(path.join(root, 'files.txt'), `${filename}\n`);
    const files = fileList ? ['--file-list', 'files.txt'] : [filename];

    const cleanResults = ['--check', '--fix'].map((mode) => lintGenerated(root, mode, files).status);
    expect(cleanResults).toEqual([0, 0]);
    expect(readFileSync(selected, 'utf-8')).toBe(clean);

    writeFileSync(selected, generated);
    const checked = lintGenerated(root, '--check', files);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain(`${filename}:`);
    expect(checked.stderr).toContain("Identifier 'Unused' is imported but never used.");
    expect(readFileSync(selected, 'utf-8')).toBe(generated);

    const fixed = lintGenerated(root, '--fix', files);
    expect(fixed.status).toBe(0);
    expect(readFileSync(selected, 'utf-8')).not.toContain('Unused');
    expect(readFileSync(selected, 'utf-8')).toContain('export const value = 1;');

    const rechecked = lintGenerated(root, '--check', files);
    expect(rechecked.status).toBe(0);
    expect(rechecked.stderr).not.toContain("Identifier 'Unused' is imported but never used.");
    expect(readFileSync(path.join(root, 'unrelated-generated.ts'), 'utf-8')).toBe(generated);
    expect(readFileSync(path.join(root, 'unrelated-handwritten.ts'), 'utf-8')).toBe(handwritten);
  });
});
