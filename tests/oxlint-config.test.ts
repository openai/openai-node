import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const oxlint = join(repoRoot, 'node_modules/.bin/oxlint');

test('inherits Ultracite native plugins and enforces their rules', () => {
  const printed = spawnSync(oxlint, ['--print-config', 'src/internal/uploads.ts'], {
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
      oxlint,
      ['--config', join(repoRoot, 'oxlint.config.ts'), '--format', 'json', fixturePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(linted.status).toBe(1);

    const { diagnostics } = JSON.parse(linted.stdout) as { diagnostics: { code: string }[] };
    expect(diagnostics.map(({ code }) => code)).toContain('unicorn(no-instanceof-array)');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
