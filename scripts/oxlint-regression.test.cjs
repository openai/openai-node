const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'oxlint-regression-'));
const distRoot = path.join(repoRoot, 'dist');
const removeDistRootAfterTests = !fs.existsSync(distRoot);
fs.mkdirSync(distRoot, { recursive: true });
const ignoredFixtureRoot = fs.mkdtempSync(path.join(distRoot, 'oxlint-regression-'));
const oxlint = path.join(repoRoot, 'node_modules', '.bin', 'oxlint');
const fastFormat = path.join(repoRoot, 'scripts', 'fast-format');

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(ignoredFixtureRoot, { recursive: true, force: true });
  if (removeDistRootAfterTests) fs.rmdirSync(distRoot);
});

function writeFixture(relativePath, contents, root = fixtureRoot) {
  const fixturePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, contents);
  return fixturePath;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `${path.basename(command)} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runOxlintFix(fixturePath) {
  run(oxlint, ['--fix', '--no-ignore', path.relative(repoRoot, fixturePath)]);
}

writeFixture(
  'dep.js',
  `export const used = 1;\nexport const usedNamed = 2;\nexport const Foo = 3;\nexport default 4;\n`,
);

test('fixes every unused binding in one atomic import-declaration edit', () => {
  const cases = [
    {
      name: 'mixed-default-named.js',
      source: `import unusedDefault, { unusedNamed, usedNamed } from './dep.js';\nconsole.log(usedNamed);\n`,
      expected: `import { usedNamed } from './dep.js';\nconsole.log(usedNamed);\n`,
    },
    {
      name: 'multiple-named.js',
      source: `import { unusedOne, used, unusedTwo } from './dep.js';\nconsole.log(used);\n`,
      expected: `import { used } from './dep.js';\nconsole.log(used);\n`,
    },
    {
      name: 'mixed-default-namespace.js',
      source: `import unusedDefault, * as namespace from './dep.js';\nconsole.log(namespace.Foo);\n`,
      expected: `import * as namespace from './dep.js';\nconsole.log(namespace.Foo);\n`,
    },
    {
      name: 'all-unused-default-namespace.js',
      source: `import unusedDefault, * as unusedNamespace from './dep.js';\nconsole.log('side effect');\n`,
      expected: `\nconsole.log('side effect');\n`,
    },
  ];

  for (const fixture of cases) {
    const fixturePath = writeFixture(fixture.name, fixture.source);
    runOxlintFix(fixturePath);
    assert.equal(fs.readFileSync(fixturePath, 'utf8'), fixture.expected, fixture.name);
  }
});

test('preserves imports used only by supported JSDoc type tags', () => {
  const fixturePath = writeFixture(
    'jsdoc.js',
    `// @ts-check
import { Foo as TypeOnly } from './dep.js';
import { Foo as TypedefOnly } from './dep.js';
import { Foo as ParamOnly } from './dep.js';
import { Foo as ReturnsOnly } from './dep.js';

/** @type {TypeOnly} */
const value = {};
/** @typedef {TypedefOnly} Alias */
/** @param {ParamOnly} input */
function accept(input) { return input; }
/** @returns {ReturnsOnly} */
function produce() { return value; }
console.log(accept(produce()));
`,
  );

  const before = fs.readFileSync(fixturePath, 'utf8');
  runOxlintFix(fixturePath);
  assert.equal(fs.readFileSync(fixturePath, 'utf8'), before);
});

test('does not conflate separate imports with sibling namespace use', () => {
  const cases = [
    {
      name: 'namespace-default.js',
      source: `import * as models from './dep.js';\nimport DefaultThing from './dep.js';\nconsole.log(models.DefaultThing);\n`,
      absent: 'DefaultThing from',
    },
    {
      name: 'namespace-alias.js',
      source: `import * as models from './dep.js';\nimport { Foo as Bar } from './dep.js';\nconsole.log(models.Bar);\n`,
      absent: 'Foo as Bar',
    },
    {
      name: 'namespace-alias-imported-name.js',
      source: `import * as models from './dep.js';\nimport { Foo as AliasForFoo } from './dep.js';\nconsole.log(models.Foo);\n`,
      absent: 'Foo as AliasForFoo',
    },
    {
      name: 'namespace-unrelated-named.js',
      source: `import * as models from './dep.js';\nimport { Foo } from './dep.js';\nconsole.log(models.used);\n`,
      absent: 'import { Foo }',
    },
    {
      name: 'namespace-matching-named.js',
      source: `import * as API from './x';\nimport { Foo } from './x';\nconsole.log(API.Foo);\n`,
      absent: 'import { Foo }',
    },
  ];

  for (const fixture of cases) {
    const fixturePath = writeFixture(fixture.name, fixture.source);
    runOxlintFix(fixturePath);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    if (fixture.absent) assert.doesNotMatch(fixed, new RegExp(fixture.absent), fixture.name);
  }
});

test('fast-format lints TSX and JSX files incrementally', () => {
  const tsxPath = writeFixture(
    'component.tsx',
    `import { Foo } from './dep.js';\nexport const Component = () => <div />;\n`,
  );
  const jsxPath = writeFixture(
    'component.jsx',
    `import { Foo } from './dep.js';\nexport const Component = () => <div />;\n`,
  );
  const fileList = writeFixture(
    'component-files.txt',
    `${path.relative(repoRoot, tsxPath)}${os.EOL}${path.relative(repoRoot, jsxPath)}${os.EOL}`,
  );

  run(fastFormat, [path.relative(repoRoot, fileList)]);
  assert.doesNotMatch(fs.readFileSync(tsxPath, 'utf8'), /import \{ Foo \}/);
  assert.doesNotMatch(fs.readFileSync(jsxPath, 'utf8'), /import \{ Foo \}/);
});

test('fast-format accepts lists containing only ignored lint files', () => {
  const ignoredPath = writeFixture('tmp.ts', `import { Foo } from './dep.js';\n`, ignoredFixtureRoot);
  const fileList = writeFixture('ignored-files.txt', `${path.relative(repoRoot, ignoredPath)}${os.EOL}`);

  run(fastFormat, [path.relative(repoRoot, fileList)]);
});
