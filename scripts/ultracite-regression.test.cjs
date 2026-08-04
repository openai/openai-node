const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'ultracite-regression-'));
const ultracite = path.join(repoRoot, 'node_modules', '.bin', 'ultracite');
const oxlint = path.join(repoRoot, 'node_modules', '.bin', 'oxlint');
const oxfmt = path.join(repoRoot, 'node_modules', '.bin', 'oxfmt');

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('Ultracite preserves classic JSX and SDK unused-import checks without unused-variable errors', () => {
  const configuration = require(path.join(repoRoot, 'oxlint.config.ts'));

  assert.equal(fs.existsSync(path.join(repoRoot, '.oxlintrc.json')), false);
  assert.ok(configuration.extends.length, 'Ultracite preset must remain enabled');
  assert.deepEqual(configuration.rules['sdk/no-unused-imports'], [
    'error',
    {
      jsxRuntime: 'classic',
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
    },
  ]);
  assert.deepEqual(configuration.jsPlugins, [{ name: 'sdk', specifier: './scripts/oxlint-plugin.cjs' }]);
  assert.ok(configuration.ignorePatterns.includes('dist/**'));
  assert.ok(configuration.ignorePatterns.includes('coverage/**'));
  assert.equal(configuration.rules['no-restricted-imports'][1].patterns[0].regex, '^openai(/.*)?');

  fs.writeFileSync(path.join(fixtureRoot, 'dep.js'), 'export const Foo = 3;\n');
  const fixturePath = path.join(fixtureRoot, 'ultracite-imports.js');
  fs.writeFileSync(fixturePath, `import { Foo } from './dep.js';\nconst intentionallyUnused = true;\n`);
  const relativePath = path.relative(repoRoot, fixturePath);
  const options = {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(ultracite)}${path.delimiter}${process.env.PATH}` },
  };
  const result = spawnSync(ultracite, ['check', relativePath], options);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /sdk\(no-unused-imports\)/);
  assert.doesNotMatch(result.stdout, /no-unused-vars/);

  const fixed = spawnSync(ultracite, ['fix', relativePath], options);
  assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
  assert.doesNotMatch(fs.readFileSync(fixturePath, 'utf8'), /import \{ Foo \}/);
  assert.match(fs.readFileSync(fixturePath, 'utf8'), /intentionallyUnused/);
});

test('Ultracite ignores Stainless-generated files without ignoring handwritten neighbors', () => {
  const lintConfiguration = require(path.join(repoRoot, 'oxlint.config.ts'));
  const formatConfiguration = require(path.join(repoRoot, 'oxfmt.config.ts'));
  const generatedPaths = [
    'src/client.ts',
    'src/core/resource.ts',
    'src/internal/headers.ts',
    'src/resources/responses/responses.ts',
    'tests/index.test.ts',
    'tests/api-resources/models.test.ts',
  ];
  const handwrittenPaths = [
    'src/core/streaming.ts',
    'src/internal/uploads.ts',
    'tests/generated-resource-helpers.test.ts',
    'tests/test-script.test.ts',
  ];

  for (const configuration of [lintConfiguration, formatConfiguration]) {
    for (const generatedPath of generatedPaths) {
      assert.ok(configuration.ignorePatterns.includes(generatedPath), generatedPath);
    }
    for (const handwrittenPath of handwrittenPaths) {
      assert.ok(!configuration.ignorePatterns.includes(handwrittenPath), handwrittenPath);
    }
  }

  const mixedFixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'src', 'internal', 'ultracite-stainless-'));
  const generatedPath = path.join(mixedFixtureRoot, 'generated.ts');
  const handwrittenPath = path.join(mixedFixtureRoot, 'handwritten.ts');

  try {
    fs.writeFileSync(
      generatedPath,
      '// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.\n' +
        'import { Unused } from "./missing";\n',
    );
    fs.writeFileSync(handwrittenPath, "export const handwritten = 'checked';\n");

    const paths = [generatedPath, handwrittenPath].map((file) => path.relative(repoRoot, file));
    const options = { cwd: repoRoot, encoding: 'utf8' };
    const linted = spawnSync(
      oxlint,
      ['--format', 'json', '--no-error-on-unmatched-pattern', ...paths],
      options,
    );

    assert.equal(linted.status, 0, `${linted.stdout}\n${linted.stderr}`);
    assert.equal(JSON.parse(linted.stdout).number_of_files, 1);

    const formatted = spawnSync(oxfmt, ['--check', '--no-error-on-unmatched-pattern', ...paths], options);

    assert.equal(formatted.status, 0, `${formatted.stdout}\n${formatted.stderr}`);
    assert.match(formatted.stdout, /on 1 files?\b/);
    assert.match(fs.readFileSync(generatedPath, 'utf8'), /import \{ Unused \} from "\.\/missing";/);
  } finally {
    fs.rmSync(mixedFixtureRoot, { recursive: true, force: true });
  }
});
