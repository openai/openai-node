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

test('preserves import comments while removing unused bindings', () => {
  const cases = [
    {
      name: 'comment-before-retained.js',
      source: `import { /* explains Used */ Used, Unused } from './dep.js';\nconsole.log(Used);\n`,
      comment: '/* explains Used */',
      unused: ['Unused'],
    },
    {
      name: 'comment-after-unused.js',
      source: `import { Unused, /* explains Used */ Used } from './dep.js';\nconsole.log(Used);\n`,
      comment: '/* explains Used */',
      unused: ['Unused'],
    },
    {
      name: 'line-comment-between-specifiers.js',
      source: `import {\n  Unused, // explains Used\n  Used,\n} from './dep.js';\nconsole.log(Used);\n`,
      comment: '// explains Used',
      unused: ['Unused'],
    },
    {
      name: 'comment-with-consecutive-unused.js',
      source: `import { Used, /* explains Used */ UnusedOne, UnusedTwo } from './dep.js';\nconsole.log(Used);\n`,
      comment: '/* explains Used */',
      unused: ['UnusedOne', 'UnusedTwo'],
    },
    {
      name: 'comment-with-unused-default.js',
      source: `import UnusedDefault, { /* explains Used */ Used, Unused } from './dep.js';\nconsole.log(Used);\n`,
      comment: '/* explains Used */',
      unused: ['UnusedDefault', 'Unused'],
    },
  ];

  for (const fixture of cases) {
    const fixturePath = writeFixture(fixture.name, fixture.source);
    runOxlintFix(fixturePath);
    const fixed = fs.readFileSync(fixturePath, 'utf8');

    assert.ok(fixed.includes(fixture.comment), fixture.name);
    assert.match(fixed, /\bUsed\b/, fixture.name);
    for (const unused of fixture.unused) {
      assert.doesNotMatch(fixed, new RegExp(`\\b${unused}\\b`), fixture.name);
    }
    run(oxlint, ['--no-ignore', path.relative(repoRoot, fixturePath)]);
  }
});

test('declines import autofixes when removing a binding would delete its comments', () => {
  const cases = [
    {
      name: 'comment-in-unused-named-group.js',
      source: `import Used, { /* explains Unused */ Unused } from './dep.js';\nconsole.log(Used);\n`,
    },
    {
      name: 'comment-inside-unused-specifier.js',
      source: `import { Used, Foo /* explains alias */ as Unused } from './dep.js';\nconsole.log(Used);\n`,
    },
    {
      name: 'comment-in-fully-unused-import.js',
      source: `import { /* explains Unused */ Unused } from './dep.js';\nconsole.log('side effect');\n`,
    },
  ];

  for (const fixture of cases) {
    const fixturePath = writeFixture(fixture.name, fixture.source);
    const result = spawnSync(oxlint, ['--fix', '--no-ignore', path.relative(repoRoot, fixturePath)], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0, fixture.name);
    assert.equal(fs.readFileSync(fixturePath, 'utf8'), fixture.source, fixture.name);
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
import { Foo as PropertyOnly } from './dep.js';
import { Foo as ThrowsOnly } from './dep.js';
import { Foo as ImplementsOnly } from './dep.js';
import { Foo as SatisfiesOnly } from './dep.js';
import { Foo as NestedOnly } from './dep.js';
import { Foo as QuotedOnly } from './dep.js';
import { Foo as QuotedNestedOnly } from './dep.js';
import { Foo as MultilineOnly } from './dep.js';
import { Foo as BareImplementsOnly } from './dep.js';
import { Foo as BareExtendsOnly } from './dep.js';
import { Foo as BareTypeOnly } from './dep.js';
import { Foo as BareThisOnly } from './dep.js';
import { Foo as BareEnumOnly } from './dep.js';
import { Foo as BareNestedOnly } from './dep.js';
import { Foo as NameFirstParamOnly } from './dep.js';
import { Foo as NameFirstPropertyOnly } from './dep.js';
import { Foo as ProseOnly } from './dep.js';

/** @type {TypeOnly} */
const value = {};
/** @typedef {TypedefOnly} Alias */
/** @param {ParamOnly} input */
function accept(input) { return input; }
/** @param input {NameFirstParamOnly} */
function acceptNameFirst(input) { return input; }
/** @returns {ReturnsOnly} */
function produce() { return value; }
/**
 * @typedef {object} Shape
 * @property {PropertyOnly} property
 * @property {{ nested: { inner: string }, value: NestedOnly }} nested
 * @property {Record<"}", QuotedOnly>} quoted
 * @property {{ "}}": string, value: QuotedNestedOnly }} quotedNested
 * @property property {NameFirstPropertyOnly}
 * @property
 * {MultilineOnly} multiline
 * @property {string} ProseOnly
 */
/** @throws {ThrowsOnly} */
/** @implements {ImplementsOnly} */
/** @satisfies {SatisfiesOnly} */
/** @implements BareImplementsOnly */
class Implementation {}
/** @extends BareExtendsOnly */
class Extension {}
/** @implements Wrapper<Inner<string>, BareNestedOnly> */
class NestedImplementation {}
/** @type BareTypeOnly */
const bareValue = {};
/** @this BareThisOnly */
function withThis() {}
/** @enum BareEnumOnly */
const enumeration = {};
console.log(accept(produce()));
`,
  );

  const before = fs.readFileSync(fixturePath, 'utf8');
  runOxlintFix(fixturePath);
  assert.equal(
    fs.readFileSync(fixturePath, 'utf8'),
    before.replace(`import { Foo as ProseOnly } from './dep.js';`, ''),
  );
});

test('distinguishes type-bearing JSDoc tags from prose and documentation tags', () => {
  const typeBearingTags = [
    'arg',
    'argument',
    'augments',
    'const',
    'constant',
    'define',
    'enum',
    'exception',
    'extends',
    'external',
    'host',
    'implements',
    'member',
    'module',
    'namespace',
    'param',
    'prop',
    'property',
    'return',
    'returns',
    'satisfies',
    'template',
    'this',
    'throws',
    'type',
    'typedef',
    'var',
    'yield',
    'yields',
  ];
  const documentationTags = [
    'example',
    'deprecated',
    'description',
    'desc',
    'see',
    'link',
    'linkcode',
    'linkplain',
    'summary',
    'remarks',
    'author',
    'since',
    'version',
    'todo',
    'license',
    'default',
    'modifies',
    'callback',
    'overload',
    'class',
    'constructor',
    'private',
    'protected',
    'public',
    'custom-tag',
  ];
  const tags = [
    ...typeBearingTags.map((tag) => ({ tag, name: `Type${tag}Only`, used: true })),
    ...documentationTags.map((tag) => ({ tag, name: `Prose${tag.replaceAll('-', '')}Only`, used: false })),
  ];
  const misleadingTags = ['throws', 'returns', 'typedef', 'template'].map((tag) => ({
    tag,
    name: `Misleading${tag}Only`,
  }));
  const embeddedTypeTags = [
    { name: 'QuotedExampleOnly', comment: '/** @example "@type {QuotedExampleOnly}" */' },
    { name: 'BacktickedExampleOnly', comment: '/** @example `@type {BacktickedExampleOnly}` */' },
    { name: 'QuotedDeprecatedOnly', comment: '/** @deprecated "@type {QuotedDeprecatedOnly}" */' },
    { name: 'EmailOnly', comment: '/** Contact user@type {EmailOnly} */' },
    { name: 'QuotedBareExampleOnly', comment: '/** @example "@type QuotedBareExampleOnly" */' },
    {
      name: 'BacktickedBareExampleOnly',
      comment: '/** @example `@implements BacktickedBareExampleOnly` */',
    },
    { name: 'BareEmailOnly', comment: '/** Contact user@type BareEmailOnly */' },
  ];
  const imports = [
    ...tags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...misleadingTags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...embeddedTypeTags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    `import { Foo as RealNestedTagOnly } from './dep.js';`,
  ];
  const comments = [
    ...tags.map(({ tag, name }) => `/** @${tag} {${name}} */`),
    ...misleadingTags.map(({ tag, name }) => `/** @${tag} description {${name}} */`),
    ...embeddedTypeTags.map(({ comment }) => comment),
    `/**\n * @example\n * @param {RealNestedTagOnly} value\n */`,
  ];
  const fixturePath = writeFixture(
    'jsdoc-tag-classification.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const { name, used } of tags) {
    const importText = `import { Foo as ${name} }`;
    assert.equal(fixed.includes(importText), used, name);
  }
  for (const { name } of misleadingTags) {
    assert.ok(!fixed.includes(`import { Foo as ${name} }`), name);
  }
  for (const { name } of embeddedTypeTags) {
    assert.ok(!fixed.includes(`import { Foo as ${name} }`), name);
  }
  assert.ok(fixed.includes(`import { Foo as RealNestedTagOnly }`));
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
