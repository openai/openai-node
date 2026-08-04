const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  fix,
  oxlint,
  repoRoot,
  run,
  runOxlintFix,
  runTypeScriptOutput,
  writeFixture,
} = require('./oxlint-regression.test.cjs');

test('fixes every unused binding in one atomic import-declaration edit', () => {
  const cases = [
    ['mixed-default-named', 'unusedDefault, { unusedNamed, usedNamed }', '{ usedNamed }', 'usedNamed'],
    ['multiple-named', '{ unusedOne, used, unusedTwo }', '{ used }', 'used'],
    ['mixed-default-namespace', 'unusedDefault, * as namespace', '* as namespace', 'namespace.Foo'],
    ['all-unused-default-namespace', 'unusedDefault, * as unusedNamespace', '', "'side effect'"],
  ];
  for (const [name, before, afterImport, usage] of cases) {
    const source = `import ${before} from './dep.js';\nconsole.log(${usage});\n`;
    const expected = `${afterImport ? `import ${afterImport} from './dep.js';` : ''}\nconsole.log(${usage});\n`;
    const fixturePath = writeFixture(`${name}.js`, source);
    runOxlintFix(fixturePath);
    assert.equal(fs.readFileSync(fixturePath, 'utf8'), expected, name);
  }
});

test('preserves import comments while removing unused bindings', () => {
  const cases = [
    ['before-retained', '{ /* explains Used */ Used, Unused }', '/* explains Used */', ['Unused']],
    ['after-unused', '{ Unused, /* explains Used */ Used }', '/* explains Used */', ['Unused']],
    ['between-specifiers', '{\n  Unused, // explains Used\n  Used,\n}', '// explains Used', ['Unused']],
    [
      'consecutive-unused',
      '{ /* explains Used */ Used, UnusedOne, UnusedTwo }',
      '/* explains Used */',
      ['UnusedOne', 'UnusedTwo'],
    ],
    [
      'unused-default',
      'UnusedDefault, { /* explains Used */ Used, Unused }',
      '/* explains Used */',
      ['UnusedDefault', 'Unused'],
    ],
  ];
  for (const [name, clause, comment, unused] of cases) {
    const fixturePath = writeFixture(
      `comment-${name}.js`,
      `import ${clause} from './dep.js';\nconsole.log(Used);\n`,
    );
    runOxlintFix(fixturePath);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    assert.ok(fixed.includes(comment), name);
    assert.match(fixed, /\bUsed\b/, name);
    for (const binding of unused) assert.doesNotMatch(fixed, new RegExp(`\\b${binding}\\b`), name);
    run(oxlint, ['--no-ignore', path.relative(repoRoot, fixturePath)]);
  }
});

test('declines import autofixes when removing a binding would delete its comments', () => {
  for (const [name, clause, usage] of [
    ['unused-named-group', 'Used, { /* explains Unused */ Unused }', 'Used'],
    ['inside-unused-specifier', '{ Used, Foo /* explains alias */ as Unused }', 'Used'],
    ['fully-unused-import', '{ /* explains Unused */ Unused }', "'side effect'"],
    ['trailing-named-block', '{ Used, Unused /* explains Unused */ }', 'Used'],
    ['trailing-named-line', '{\n  Used,\n  Unused // explains Unused\n}', 'Used'],
    ['trailing-default', 'Unused /* explains Unused */, { Used }', 'Used'],
  ]) {
    const source = `import ${clause} from './dep.js';\nconsole.log(${usage});\n`;
    const fixturePath = writeFixture(`unsafe-${name}.js`, source);
    const result = spawnSync(oxlint, ['--fix', '--no-ignore', path.relative(repoRoot, fixturePath)], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, name);
    assert.match(
      result.stdout + '\n' + result.stderr,
      /Imported bindings .* are never used/u,
      name + ': diagnostic remains',
    );
    assert.equal(fs.readFileSync(fixturePath, 'utf8'), source, name);
  }
});

test('does not conflate separate imports with sibling namespace use', () => {
  const cases = [
    ['default', "import DefaultThing from './dep.js';", 'models.DefaultThing', 'DefaultThing from'],
    ['alias', "import { Foo as Bar } from './dep.js';", 'models.Bar', 'Foo as Bar'],
    ['imported-name', "import { Foo as AliasForFoo } from './dep.js';", 'models.Foo', 'Foo as AliasForFoo'],
    ['unrelated', "import { Foo } from './dep.js';", 'models.used', 'import { Foo }'],
    ['matching', "import { Foo } from './dep.js';", 'models.Foo', 'import { Foo }'],
  ];
  for (const [name, separate, access, absent] of cases) {
    const fixturePath = writeFixture(
      `namespace-${name}.js`,
      `import * as models from './dep.js';\n${separate}\nconsole.log(${access});\n`,
    );
    runOxlintFix(fixturePath);
    assert.ok(!fs.readFileSync(fixturePath, 'utf8').includes(absent), name);
  }
});

test('removes unused require import-equals aliases and their emitted module side effects', () => {
  const source = `import Stale = require('./external-side-effect.cjs');\nimport Used = require('./external-retained.cjs');\nconst unrelated = 'safe';\nconsole.log(globalThis.externalImportRan ?? false, Used.value, unrelated);\n`;
  const fixturePath = writeFixture('import-equals-require.ts', source);
  const before = runTypeScriptOutput(fixturePath);
  assert.match(before.output, /require\("\.\/external-side-effect\.cjs"\)/u);
  assert.equal(before.stdout, 'true 42 safe');

  const fixed = fix(fixturePath);
  assert.doesNotMatch(fixed, /\bStale\b/u);
  assert.match(fixed, /import Used = require/u);
  assert.match(fixed, /const unrelated = 'safe'/u);
  const afterFix = runTypeScriptOutput(fixturePath);
  assert.doesNotMatch(afterFix.output, /external-side-effect/u);
  assert.equal(afterFix.stdout, 'false 42 safe');
});

test('removes unused qualified import aliases without changing used or exported aliases', () => {
  const source = `namespace Models { export class Foo {} export class Used {} }\nObject.defineProperty(Models, 'Foo', { get() { globalThis.qualifiedImportRan = true; return class {}; } });\nimport Stale = Models.Foo;\nimport Runtime = Models.Used;\nimport TypeOnly = Models.Used;\nexport import Public = Models.Used;\ntype Retained = TypeOnly;\nconst unrelated: Retained = new Runtime();\nconsole.log(globalThis.qualifiedImportRan ?? false, unrelated.constructor.name, Public.name);\n`;
  const fixturePath = writeFixture('import-equals-qualified.ts', source);
  const before = runTypeScriptOutput(fixturePath);
  assert.match(before.output, /(?:var|const|let) Stale = Models\.Foo/u);
  assert.equal(before.stdout, 'true Used Used');

  const fixed = fix(fixturePath);
  assert.doesNotMatch(fixed, /\bStale\b/u);
  assert.match(fixed, /import Runtime = Models\.Used/u);
  assert.match(fixed, /import TypeOnly = Models\.Used/u);
  assert.match(fixed, /export import Public = Models\.Used/u);
  assert.match(fixed, /const unrelated: Retained/u);
  const afterFix = runTypeScriptOutput(fixturePath);
  assert.doesNotMatch(afterFix.output, /Stale = Models\.Foo/u);
  assert.equal(afterFix.stdout, 'false Used Used');
});

test('preserves used external import-equals aliases and reports commented unsafe removals', () => {
  const exported = writeFixture(
    'import-equals-exported.ts',
    `export import Public = require('./external-retained.cjs');\nconsole.log('safe');\n`,
  );
  assert.match(fix(exported), /export import Public = require/u);

  const documented = writeFixture(
    'import-equals-jsdoc.ts',
    `import Used = require('./external-retained.cjs');\n/** @type {Used} */\nexport let retained;\n`,
  );
  assert.match(fix(documented), /import Used = require/u);

  const source = `import /* preserve this explanation */ Stale = require('./external-side-effect.cjs');\nconsole.log('safe');\n`;
  const fixturePath = writeFixture('import-equals-commented.ts', source);
  const result = spawnSync(oxlint, ['--fix', '--no-ignore', path.relative(repoRoot, fixturePath)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'unsafe removal should remain a diagnostic');
  assert.match(`${result.stdout}\n${result.stderr}`, /Imported bindings 'Stale' are never used/u);
  assert.equal(fs.readFileSync(fixturePath, 'utf8'), source, 'the internal comment must be preserved');
});
