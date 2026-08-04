const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'ultracite-regression-'));
const ultracite = path.join(repoRoot, 'node_modules', '.bin', 'ultracite');

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
  assert.deepEqual(configuration.ignorePatterns, ['dist/**', 'coverage/**']);
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
