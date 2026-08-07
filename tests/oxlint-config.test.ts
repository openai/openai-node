import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const oxlint = join(repoRoot, 'node_modules/oxlint/bin/oxlint');
const oxfmt = join(repoRoot, 'node_modules/oxfmt/bin/oxfmt');

test('inherits Ultracite native plugins and enforces their rules', () => {
  const printed = spawnSync(process.execPath, [oxlint, '--print-config', 'src/internal/uploads.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  expect(printed.status).toBe(0);

  const configuration = JSON.parse(printed.stdout) as {
    plugins: string[];
    rules: Record<string, string>;
  };
  const preset = require('ultracite/oxlint/core').default as { plugins: string[] };

  expect(configuration.plugins).toEqual(
    expect.arrayContaining(preset.plugins.filter((plugin) => plugin !== 'eslint')),
  );
  expect(configuration.rules['unicorn/no-instanceof-array']).toBe('deny');

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'openai-node-oxlint-config-'));

  try {
    const fixturePath = join(fixtureRoot, 'native-plugin.ts');
    writeFileSync(fixturePath, 'const values = [];\nconsole.log(values instanceof Array);\n');

    const linted = spawnSync(
      process.execPath,
      [oxlint, '--config', join(repoRoot, 'oxlint.config.ts'), '--format', 'json', fixturePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(linted.status).toBe(1);

    const { diagnostics } = JSON.parse(linted.stdout) as { diagnostics: { code: string }[] };
    expect(diagnostics.map(({ code }) => code)).toContain('unicorn(no-instanceof-array)');

    const formatted = spawnSync(
      process.execPath,
      [oxfmt, '--config', join(repoRoot, 'oxfmt.config.ts'), '--check', fixturePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(formatted.status).toBe(0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('recognizes both Stainless and Castiron generated SDK files', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'openai-node-generated-files-'));

  try {
    const scriptsDirectory = join(fixtureRoot, 'scripts');
    mkdirSync(scriptsDirectory);
    const generatedFilesScript = join(scriptsDirectory, 'stainless-generated-files.cjs');
    copyFileSync(join(repoRoot, 'scripts/stainless-generated-files.cjs'), generatedFilesScript);

    for (const generator of ['Stainless', 'Castiron']) {
      writeFileSync(
        join(fixtureRoot, `${generator.toLowerCase()}.ts`),
        `// File generated from our OpenAPI spec by ${generator}. See CONTRIBUTING.md for details.\n`,
      );
    }
    writeFileSync(join(fixtureRoot, 'handwritten.ts'), 'export const handwritten = true;\n');

    const generatedFiles = require(generatedFilesScript) as string[];
    expect(generatedFiles).toEqual(['castiron.ts', 'stainless.ts']);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('formats generated SDK files without linting them', () => {
  const generatedPath = 'src/client.ts';
  const unformatted = [
    '// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.',
    '',
    'export const generated = "formatted";',
    '',
  ].join('\n');

  const formatted = spawnSync(process.execPath, [oxfmt, `--stdin-filepath=${generatedPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: unformatted,
  });

  expect(formatted.status).toBe(0);
  expect(formatted.stdout).toContain("export const generated = 'formatted';");

  const linted = spawnSync(
    process.execPath,
    [oxlint, '--format', 'json', '--no-error-on-unmatched-pattern', generatedPath],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  expect(linted.status).toBe(0);

  const result = JSON.parse(linted.stdout) as { number_of_files: number };
  expect(result.number_of_files).toBe(0);
});

test('removes adjacent unused imports from generated files until fixes stabilize', () => {
  const fixtureRoot = mkdtempSync(join(repoRoot, '.oxlint-generated-imports-'));

  try {
    const handwrittenPath = join(fixtureRoot, 'handwritten.ts');
    const handwritten = "import { HandwrittenUnused } from './dependency';\nexport const value = 1;\n";
    writeFileSync(handwrittenPath, handwritten);

    for (const generator of ['Stainless', 'Castiron']) {
      const generatedPath = join(fixtureRoot, `${generator.toLowerCase()}.ts`);
      const imports = Array.from(
        { length: 20 },
        (_, index) => `import { Unused${index} } from './dependency-${index}';`,
      );
      writeFileSync(
        generatedPath,
        [
          `// File generated from our OpenAPI spec by ${generator}. See CONTRIBUTING.md for details.`,
          '',
          ...imports,
          "import { Retained, UnusedNamed } from './dependency';",
          "import './side-effect';",
          'const intentionallyUnused = 1;',
          'export interface Result<T> { value: string; }',
          'export const value = Retained;',
          '',
        ].join('\n'),
      );

      const fixed = spawnSync(
        process.execPath,
        [join(repoRoot, 'scripts/lint-generated.cjs'), '--fix', generatedPath, handwrittenPath],
        { cwd: repoRoot, encoding: 'utf8' },
      );

      expect(fixed.status).toBe(0);

      const result = readFileSync(generatedPath, 'utf8');
      expect(result).not.toMatch(/\bUnused(?:\d+|Named)\b/u);
      expect(result).toContain("import { Retained } from './dependency';");
      expect(result).toContain("import './side-effect';");
      expect(result).toContain('const intentionallyUnused = 1;');
      expect(result).toContain('export interface Result<T>');
      expect(readFileSync(handwrittenPath, 'utf8')).toBe(handwritten);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('limits generated import cleanup to paths supplied through a fast-format file list', () => {
  const fixtureRoot = mkdtempSync(join(repoRoot, '.oxlint-generated-file-list-'));

  try {
    const header = '// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.';
    const selectedPath = join(fixtureRoot, 'selected.ts');
    const untouchedPath = join(fixtureRoot, 'untouched.ts');
    const source = `${header}\nimport { Unused } from './dependency';\nexport const value = 1;\n`;
    writeFileSync(selectedPath, source);
    writeFileSync(untouchedPath, source);

    const fileList = join(fixtureRoot, 'files.txt');
    writeFileSync(fileList, `${selectedPath}\n`);

    const fixed = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--fix', '--file-list', fileList],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(fixed.status).toBe(0);
    expect(readFileSync(selectedPath, 'utf8')).not.toContain('Unused');
    expect(readFileSync(untouchedPath, 'utf8')).toBe(source);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('checks unused generated imports without rejecting intentionally unused variables', () => {
  const fixtureRoot = mkdtempSync(join(repoRoot, '.oxlint-generated-check-'));

  try {
    const generatedPath = join(fixtureRoot, 'generated.ts');
    const source = [
      '// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.',
      "import { Unused } from './dependency';",
      'const intentionallyUnused = 1;',
      'export interface Result<T> { value: string; }',
      '',
    ].join('\n');
    writeFileSync(generatedPath, source);

    const checked = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--check', generatedPath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("Identifier 'Unused' is imported but never used.");
    expect(checked.stderr).not.toContain('intentionallyUnused');
    expect(checked.stderr).not.toContain("Variable 'T'");
    expect(readFileSync(generatedPath, 'utf8')).toBe(source);

    const fixed = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--fix', generatedPath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(fixed.status).toBe(0);
    expect(readFileSync(generatedPath, 'utf8')).toContain('const intentionallyUnused = 1;');

    const rechecked = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--check', generatedPath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(rechecked.status).toBe(0);
    expect(rechecked.stderr).toBe('');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('rejects SDK package imports in generated source but allows them in generated tests', () => {
  const sourceRoot = mkdtempSync(join(repoRoot, 'src', '.oxlint-generated-source-'));
  const testsRoot = mkdtempSync(join(repoRoot, 'tests', '.oxlint-generated-tests-'));

  try {
    const header = '// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.';
    const sourcePath = join(sourceRoot, 'client.ts');
    const testPath = join(testsRoot, 'client.test.ts');
    const source = `${header}\nimport OpenAI from 'openai';\nexport const client = OpenAI;\n`;
    writeFileSync(sourcePath, source);
    writeFileSync(testPath, source);

    const checkedSource = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--check', sourcePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(checkedSource.status).toBe(1);
    expect(checkedSource.stderr).toContain('Use a relative import, not a package import.');
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);

    const fixedSource = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/lint-generated.cjs'), '--fix', sourcePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(fixedSource.status).toBe(1);
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);

    for (const mode of ['--check', '--fix']) {
      const generatedTest = spawnSync(
        process.execPath,
        [join(repoRoot, 'scripts/lint-generated.cjs'), mode, testPath],
        { cwd: repoRoot, encoding: 'utf8' },
      );

      expect(generatedTest.status).toBe(0);
      expect(readFileSync(testPath, 'utf8')).toBe(source);
    }
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(testsRoot, { recursive: true, force: true });
  }
});

test('checks and fixes generated imports through the public package commands', () => {
  const fixtureRoot = mkdtempSync(join(repoRoot, '.oxlint-public-entrypoints-'));

  try {
    const generatedPath = join(fixtureRoot, 'generated.ts');
    writeFileSync(
      generatedPath,
      [
        '// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.',
        "import { Unused } from './dependency';",
        'export const value = 1;',
        '',
      ].join('\n'),
    );

    const rejected = spawnSync('pnpm', ['lint'], { cwd: repoRoot, encoding: 'utf8' });

    expect(rejected.status).toBe(1);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain(
      "Identifier 'Unused' is imported but never used.",
    );

    const fixed = spawnSync('pnpm', ['format'], { cwd: repoRoot, encoding: 'utf8' });

    expect(fixed.status).toBe(0);
    expect(readFileSync(generatedPath, 'utf8')).not.toContain('Unused');

    const accepted = spawnSync('pnpm', ['lint'], { cwd: repoRoot, encoding: 'utf8' });

    expect(accepted.status).toBe(0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
