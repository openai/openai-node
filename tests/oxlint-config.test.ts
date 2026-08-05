import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
