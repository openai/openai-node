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
        [join(repoRoot, 'scripts/fix-generated-imports.cjs'), generatedPath, handwrittenPath],
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
      [join(repoRoot, 'scripts/fix-generated-imports.cjs'), '--file-list', fileList],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(fixed.status).toBe(0);
    expect(readFileSync(selectedPath, 'utf8')).not.toContain('Unused');
    expect(readFileSync(untouchedPath, 'utf8')).toBe(source);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
