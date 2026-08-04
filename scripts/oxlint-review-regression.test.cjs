const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'oxlint-review-regression-'));
const oxlint = path.join(repoRoot, 'node_modules', '.bin', 'oxlint');

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

function writeFixture(name, source) {
  const fixturePath = path.join(fixtureRoot, name);
  fs.writeFileSync(fixturePath, source);
  return fixturePath;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function fix(fixturePath) {
  run(oxlint, ['--fix', '--no-ignore', path.relative(repoRoot, fixturePath)]);
  return fs.readFileSync(fixturePath, 'utf8');
}

function assertNoMissingTypes(fixturePath) {
  const program = ts.createProgram([fixturePath], {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const missing = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.code === 2304);
  assert.equal(missing.length, 0, missing.map((diagnostic) => diagnostic.messageText).join('\n'));
  return program;
}

function findDocumentedNode(program, fixturePath, predicate) {
  let documented;
  function visit(node) {
    if (node.jsDoc?.some((comment) => comment.tags?.some(predicate))) documented ??= node;
    ts.forEachChild(node, visit);
  }
  visit(program.getSourceFile(fixturePath));
  return documented;
}

function runTypeScriptOutput(fixturePath) {
  const outputPath = fixturePath.replace(/\.ts$/u, '.cjs');
  const output = ts.transpileModule(fs.readFileSync(fixturePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: fixturePath,
  }).outputText;
  fs.writeFileSync(outputPath, output);
  return { output, stdout: run(process.execPath, [outputPath]) };
}

writeFixture('parameter-side-effect.mjs', 'globalThis.parameterImportRan = true; export class Foo {}\n');
writeFixture('parameter-types.mjs', 'export class Bar {}\nexport class Ref {}\n');
writeFixture(
  'external-side-effect.cjs',
  'globalThis.externalImportRan = true; module.exports = { value: 1 };\n',
);
writeFixture('external-retained.cjs', 'module.exports = { value: 42 };\n');

test('parses attached JSDoc with the linted TypeScript, JavaScript, and JSX source kind', () => {
  const generic = 'const identity = <T>(value: T) => value;\n';
  const moduleGeneric = 'const identity = <T,>(value: T) => value;\n';
  const plain = 'const identity = (value) => value;\n';
  const jsx =
    'const React = { createElement: () => null };\nconst identity = (value) => value;\nconst element = <div />;\n';
  const cases = [
    ['generic-ts', 'ts', generic],
    ['generic-mts', 'mts', moduleGeneric],
    ['generic-cts', 'cts', moduleGeneric],
    ['jsx-tsx', 'tsx', jsx],
    ['jsx-jsx', 'jsx', jsx],
    ['plain-js', 'js', plain],
    ['plain-mjs', 'mjs', plain],
  ];

  for (const [name, extension, syntax] of cases) {
    const fixturePath = writeFixture(
      `source-kind-${name}.${extension}`,
      `import { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${syntax}/** @type {Foo} */\nexport let retained;\n/** @type {Bar} */\nexport let another;\nconsole.log(globalThis.parameterImportRan ?? false, identity('safe'));\n`,
    );
    const before = assertNoMissingTypes(fixturePath);
    const documented = findDocumentedNode(
      before,
      fixturePath,
      (tag) => tag.typeExpression?.type?.typeName?.escapedText === 'Foo',
    );
    assert.ok(documented, `${name}: compiler attaches the Foo JSDoc`);
    const fixed = fix(fixturePath);
    assert.match(fixed, /import \{ Foo \}/u, `${name}: genuine Foo JSDoc import`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: genuine Bar JSDoc import`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: stale Ref import`);
    assertNoMissingTypes(fixturePath);
    if (extension === 'ts') {
      assert.equal(
        runTypeScriptOutput(fixturePath).stdout,
        'true safe',
        `${name}: retained import side effect`,
      );
    } else if (extension === 'mjs') {
      assert.equal(run(process.execPath, [fixturePath]), 'true safe', `${name}: retained import side effect`);
    }
  }
});

test('uses parser JSX signals for unknown and virtual linted filenames', () => {
  const plugin = require('./oxlint-plugin.cjs');

  function reportsUnused(filename, jsx, syntax, options = {}) {
    const text = `import { Foo } from './parameter-side-effect.mjs';\n${syntax}\n/** @type {Foo} */\nlet retained;\n`;
    const start = text.indexOf('/**');
    const comment = { type: 'Block', value: '* @type {Foo} ', range: [start, text.indexOf('*/') + 2] };
    const identifier = { name: 'Foo' };
    const variable = {
      name: 'Foo',
      identifiers: [identifier],
      references: [],
      defs: [{ type: 'ImportBinding' }],
    };
    const ast = { type: 'Program', range: [0, text.length] };
    const scope = { block: ast, set: new Map([['Foo', variable]]), upper: null };
    const sourceCode = {
      ast,
      text,
      visitorKeys: { Program: [] },
      getAllComments: () => [comment],
      getTokenAfter: () => ({ range: [text.indexOf('let retained'), text.indexOf('let retained') + 3] }),
      getNodeByRangeIndex: () => ast,
      getScope: () => scope,
      getDeclaredVariables: () => [variable],
    };
    const reports = [];
    const context = {
      filename,
      physicalFilename: options.physicalFilename,
      languageOptions: { parserOptions: { ecmaFeatures: { jsx }, filePath: options.filePath } },
      options: [],
      report: (diagnostic) => reports.push(diagnostic),
      sourceCode,
    };
    plugin.rules['no-unused-imports'].create(context).ImportDeclaration({
      specifiers: [{ type: 'ImportSpecifier', local: identifier }],
    });
    return reports.length > 0;
  }

  for (const filename of ['<input>', '<text>', 'virtual-component']) {
    assert.equal(
      reportsUnused(filename, false, 'const identity = <T>(value: T) => value;'),
      false,
      `${filename}: TypeScript parser mode`,
    );
    assert.equal(reportsUnused(filename, true, 'const element = <div />;'), false, `${filename}: JSX mode`);
  }

  for (const filename of ['source.js', 'source.mjs', 'source.cjs']) {
    assert.equal(reportsUnused(filename, false, 'const identity = (value) => value;'), false, filename);
  }
  assert.equal(
    reportsUnused('<input>', true, 'const identity = <T>(value: T) => value;', {
      physicalFilename: 'source.ts',
    }),
    false,
    'the physical TypeScript filename overrides an otherwise JSX-capable parser',
  );
  assert.equal(
    reportsUnused('<input>', true, 'const identity = <T>(value: T) => value;', {
      filePath: 'source.cts',
    }),
    false,
    'the parser file path supplies a concrete source kind',
  );
  assert.equal(
    reportsUnused('component.vue?lang=tsx', false, 'const element = <div />;'),
    false,
    'virtual query parameters preserve their explicit JSX mode',
  );
});

test('resolves JSDoc type references through value-only shadows while preserving type-bearing shadows', () => {
  const cases = [
    [
      'parameter',
      'mjs',
      'function documented(Foo) {\n/** @type {Foo} */\nlet value;\nreturn value ?? Foo;\n}',
      'ImportSpecifier',
      true,
    ],
    [
      'variable',
      'mjs',
      'function documented() {\nconst Foo = {};\n/** @type {Foo} */\nlet value;\nreturn value ?? Foo;\n}',
      'ImportSpecifier',
      true,
    ],
    [
      'function',
      'mjs',
      'function documented() {\nfunction Foo() {}\n/** @type {Foo} */\nlet value;\nreturn value ?? Foo();\n}',
      'ImportSpecifier',
      true,
    ],
    [
      'class',
      'mjs',
      'function documented() {\nclass Foo {}\n/** @type {Foo} */\nlet value;\nreturn value ?? new Foo();\n}',
      'ClassDeclaration',
      false,
    ],
    [
      'type-alias',
      'ts',
      'function documented() {\ntype Foo = { local: true };\n/** @type {Foo} */\nlet value;\nreturn value;\n}',
      'TypeAliasDeclaration',
      false,
    ],
    [
      'interface',
      'ts',
      'function documented() {\ninterface Foo { local: true }\n/** @type {Foo} */\nlet value;\nreturn value;\n}',
      'InterfaceDeclaration',
      false,
    ],
    [
      'enum',
      'ts',
      'function documented() {\nenum Foo { Value }\n/** @type {Foo} */\nlet value;\nreturn value ?? Foo.Value;\n}',
      'EnumDeclaration',
      false,
    ],
    [
      'type-parameter',
      'ts',
      'function documented<Foo>() {\n/** @type {Foo} */\nlet value;\nreturn value;\n}',
      'TypeParameter',
      false,
    ],
    [
      'namespace',
      'ts',
      'namespace Outer {\nexport namespace Foo { export class Nested {} }\n/** @type {Foo.Nested} */\nexport let value;\n}',
      'ModuleDeclaration',
      false,
    ],
  ];

  for (const [name, extension, declaration, expectedBinding, retained] of cases) {
    const fixturePath = writeFixture(
      `type-shadow-${name}.${extension}`,
      `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${declaration}\n/** @type {Bar} */\nexport let another;\nconsole.log(globalThis.parameterImportRan ?? false);\n`,
    );
    const before = assertNoMissingTypes(fixturePath);
    const getRootTypeName = (tag) => {
      let name = tag.typeExpression?.type?.typeName;
      while (name && ts.isQualifiedName(name)) name = name.left;
      return name;
    };
    const documented = findDocumentedNode(
      before,
      fixturePath,
      (tag) => getRootTypeName(tag)?.escapedText === 'Foo',
    );
    const tag = documented.jsDoc[0].tags.find(
      (candidate) => getRootTypeName(candidate)?.escapedText === 'Foo',
    );
    const binding = before.getTypeChecker().getSymbolAtLocation(getRootTypeName(tag));
    assert.equal(ts.SyntaxKind[binding.declarations[0].kind], expectedBinding, `${name}: compiler binding`);

    const fixed = fix(fixturePath);
    assert.equal(/import \{ Foo \}/u.test(fixed), retained, `${name}: imported Foo retention`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: unrelated genuine Bar import`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: stale Ref import`);
    assertNoMissingTypes(fixturePath);
    if (extension === 'mjs') {
      assert.equal(run(process.execPath, [fixturePath]), String(retained), `${name}: import side effect`);
    } else {
      assert.equal(runTypeScriptOutput(fixturePath).stdout, String(retained), `${name}: import side effect`);
    }
  }
});

test('keeps typeof JSDoc references in the value namespace when local bindings shadow imports', () => {
  const cases = [
    ['parameter', 'function documented(Foo) {'],
    ['variable', 'function documented() {\nconst Foo = {};'],
    ['function', 'function documented() {\nfunction Foo() {}'],
    ['class', 'function documented() {\nclass Foo {}'],
  ];

  for (const [name, opening] of cases) {
    const fixturePath = writeFixture(
      `value-shadow-${name}.mjs`,
      `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${opening}\n/** @type {typeof Foo} */\nlet value;\nreturn value ?? Foo;\n}\n/** @type {Bar} */\nexport let another;\nconsole.log(globalThis.parameterImportRan ?? false);\n`,
    );
    const before = assertNoMissingTypes(fixturePath);
    const documented = findDocumentedNode(
      before,
      fixturePath,
      (tag) => tag.typeExpression?.type && ts.isTypeQueryNode(tag.typeExpression.type),
    );
    const tag = documented.jsDoc[0].tags.find(
      (candidate) => candidate.typeExpression?.type && ts.isTypeQueryNode(candidate.typeExpression.type),
    );
    const binding = before.getTypeChecker().getSymbolAtLocation(tag.typeExpression.type.exprName);
    assert.notEqual(ts.SyntaxKind[binding.declarations[0].kind], 'ImportSpecifier', `${name}: value binding`);
    const fixed = fix(fixturePath);
    assert.doesNotMatch(fixed, /import \{ Foo \}/u, `${name}: locally shadowed value import`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: genuine type import`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: stale Ref import`);
    assert.equal(run(process.execPath, [fixturePath]), 'false', `${name}: removed import side effect`);
  }
});

test('resolves initializer-attached JSDoc type queries against function parameter bindings', () => {
  const cases = [
    ['arrow', 'const documented = (Foo) => Foo;', 'Parameter'],
    ['function-expression', 'const documented = function (Foo) { return Foo; };', 'Parameter'],
    ['exported-arrow', 'export const documented = (Foo) => Foo;', 'Parameter'],
    ['default-parameter', 'const documented = (Foo = {}) => Foo;', 'Parameter'],
    [
      'destructured-arrow',
      'const documented = ({ Foo }) => Foo;',
      'BindingElement',
      '@param {{ Foo: object }} input',
    ],
  ];

  for (const [name, declaration, expectedBinding, parameter = '@param {object} Foo'] of cases) {
    const source = `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n/** ${parameter} @returns {typeof Foo} */\n${declaration}\n/** @type {Bar} */\nexport let retained;\nconsole.log(globalThis.parameterImportRan ?? false);\n`;
    const fixturePath = writeFixture(`initializer-${name}.mjs`, source);
    const program = assertNoMissingTypes(fixturePath);
    const documented = program.getSourceFile(fixturePath).statements.find((statement) => statement.jsDoc);
    const returnTag = documented.jsDoc[0].tags.find(ts.isJSDocReturnTag);
    const binding = program.getTypeChecker().getSymbolAtLocation(returnTag.typeExpression.type.exprName);
    assert.equal(ts.SyntaxKind[binding.declarations[0].kind], expectedBinding, `${name}: compiler binding`);
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: side effect before fix`);

    const fixed = fix(fixturePath);
    const fixedProgram = ts.createProgram([fixturePath], {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    });
    const fixedStatement = fixedProgram
      .getSourceFile(fixturePath)
      .statements.find((statement) => statement.jsDoc);
    const fixedReturn = fixedStatement.jsDoc[0].tags.find(ts.isJSDocReturnTag);
    const fixedBinding = fixedProgram
      .getTypeChecker()
      .getSymbolAtLocation(fixedReturn.typeExpression.type.exprName);
    assert.equal(
      ts.SyntaxKind[fixedBinding.declarations[0].kind],
      expectedBinding,
      `${name}: compiler binding after fix`,
    );
    assert.doesNotMatch(fixed, /import \{ Foo \}/u, `${name}: shadowed Foo`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: genuine Bar reference`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unrelated unused Ref`);
    assert.ok(fixed.includes(declaration), `${name}: unrelated function binding`);
    assert.equal(run(process.execPath, [fixturePath]), 'false', `${name}: removed side effect`);
  }

  const genuinelyUsed = writeFixture(
    'initializer-genuine-type.mjs',
    `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\n/** @param {Foo} Foo @returns {typeof Foo} */\nconst documented = (Foo) => Foo;\nconsole.log(globalThis.parameterImportRan ?? false);\n`,
  );
  const typeProgram = assertNoMissingTypes(genuinelyUsed);
  const documented = typeProgram.getSourceFile(genuinelyUsed).statements.find((statement) => statement.jsDoc);
  const [parameterTag, returnTag] = documented.jsDoc[0].tags;
  const checker = typeProgram.getTypeChecker();
  assert.equal(
    ts.SyntaxKind[
      checker.getSymbolAtLocation(parameterTag.typeExpression.type.typeName).declarations[0].kind
    ],
    'ImportSpecifier',
  );
  assert.equal(
    ts.SyntaxKind[checker.getSymbolAtLocation(returnTag.typeExpression.type.exprName).declarations[0].kind],
    'Parameter',
  );
  assert.match(fix(genuinelyUsed), /import \{ Foo \}/u, 'the genuine Foo type import must remain');
  assert.equal(run(process.execPath, [genuinelyUsed]), 'true', 'the retained import still runs');
});

test('resolves declaration and method JSDoc type queries against their parameter bindings', () => {
  const returns = '/** @param {object} Foo @returns {typeof Foo} */';
  const parameter = '/** @param {typeof Foo} Foo */';
  const cases = [
    ['function', `${returns}\nfunction documented(Foo) { return Foo; }`, 'FunctionDeclaration'],
    [
      'exported-function',
      `${returns}\nexport function documented(Foo) { return Foo; }`,
      'FunctionDeclaration',
    ],
    [
      'default-named-function',
      `${returns}\nexport default function documented(Foo) { return Foo; }`,
      'FunctionDeclaration',
    ],
    [
      'default-anonymous-function',
      `${returns}\nexport default function (Foo) { return Foo; }`,
      'FunctionDeclaration',
    ],
    [
      'instance-method',
      `class Documented {\n${returns}\ndocumented(Foo) { return Foo; }\n}`,
      'MethodDeclaration',
    ],
    [
      'static-method',
      `class Documented {\n${returns}\nstatic documented(Foo) { return Foo; }\n}`,
      'MethodDeclaration',
    ],
    [
      'object-method',
      `const documented = {\n${returns}\ndocumented(Foo) { return Foo; }\n};`,
      'MethodDeclaration',
    ],
    [
      'constructor',
      `class Documented {\n${parameter}\nconstructor(Foo) { this.value = Foo; }\n}`,
      'Constructor',
    ],
    ['setter', `class Documented {\n${parameter}\nset value(Foo) { this.stored = Foo; }\n}`, 'SetAccessor'],
  ];

  for (const [name, declaration, expectedHost] of cases) {
    const source = `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${declaration}\n/** @type {Bar} */\nexport let retained;\nconsole.log(globalThis.parameterImportRan ?? false);\n`;
    const fixturePath = writeFixture(`declaration-${name}.mjs`, source);
    const before = assertNoMissingTypes(fixturePath);
    const documented = findDocumentedNode(
      before,
      fixturePath,
      (tag) => tag.typeExpression?.type && ts.isTypeQueryNode(tag.typeExpression.type),
    );
    assert.equal(ts.SyntaxKind[documented.kind], expectedHost, `${name}: compiler host`);
    const tag = documented.jsDoc[0].tags.find(
      (candidate) => candidate.typeExpression?.type && ts.isTypeQueryNode(candidate.typeExpression.type),
    );
    const binding = before.getTypeChecker().getSymbolAtLocation(tag.typeExpression.type.exprName);
    assert.equal(ts.SyntaxKind[binding.declarations[0].kind], 'Parameter', `${name}: compiler binding`);
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: side effect before fix`);

    const fixed = fix(fixturePath);
    const after = ts.createProgram([fixturePath], {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    });
    const fixedNode = findDocumentedNode(
      after,
      fixturePath,
      (candidate) => candidate.typeExpression?.type && ts.isTypeQueryNode(candidate.typeExpression.type),
    );
    const fixedTag = fixedNode.jsDoc[0].tags.find(
      (candidate) => candidate.typeExpression?.type && ts.isTypeQueryNode(candidate.typeExpression.type),
    );
    const fixedBinding = after.getTypeChecker().getSymbolAtLocation(fixedTag.typeExpression.type.exprName);
    assert.equal(ts.SyntaxKind[fixedBinding.declarations[0].kind], 'Parameter', `${name}: binding after fix`);
    assert.doesNotMatch(fixed, /import \{ Foo \}/u, `${name}: shadowed Foo`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: genuine Bar reference`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unrelated unused Ref`);
    assert.equal(run(process.execPath, [fixturePath]), 'false', `${name}: removed side effect`);
  }

  for (const [name, declaration] of [
    [
      'function',
      '/** @param {Foo} Foo @returns {typeof Foo} */\nexport function documented(Foo) { return Foo; }',
    ],
    [
      'method',
      'class Documented {\n/** @param {Foo} Foo @returns {typeof Foo} */\nstatic documented(Foo) { return Foo; }\n}',
    ],
    ['getter', 'class Documented {\n/** @returns {typeof Foo} */\nget value() { return Foo; }\n}'],
  ]) {
    const fixturePath = writeFixture(
      `declaration-genuine-${name}.mjs`,
      `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\n${declaration}\nconsole.log(globalThis.parameterImportRan ?? false);\n`,
    );
    assertNoMissingTypes(fixturePath);
    assert.match(fix(fixturePath), /import \{ Foo \}/u, `${name}: genuine Foo type import must remain`);
    assertNoMissingTypes(fixturePath);
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: retained side effect`);
  }
});

test('ignores detached JSDoc comments without a real declaration host', () => {
  const log = 'console.log(globalThis.parameterImportRan ?? false);';
  const cases = [
    ['eof', `const value = 1;\n${log}\n/** @type {Foo} */`],
    ['eof-same-line', `const value = 1;\n${log} /** @type {Foo} */`],
    ['consecutive-eof', `const value = 1;\n${log}\n/** @type {Foo} */\n/** @type {Foo} */`],
    ['between-trailing', `const before = 1; /** @type {Foo} */\nconst after = 2;\n${log}`],
    ['between-same-line', `const before = 1; /** @type {Foo} */ const after = 2;\n${log}`],
    ['empty-statement', `const before = 1;\n/** @type {Foo} */\n;\nconst after = 2;\n${log}`],
    ['before-closing-brace', `if (true) {\n  const value = 1;\n  /** @type {Foo} */\n}\n${log}`],
  ];

  for (const [name, body] of cases) {
    const fixturePath = writeFixture(
      `detached-${name}.mjs`,
      `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\n${body}\n`,
    );
    const program = assertNoMissingTypes(fixturePath);
    const documented = findDocumentedNode(
      program,
      fixturePath,
      (tag) => tag.typeExpression?.type && ts.isTypeReferenceNode(tag.typeExpression.type),
    );
    if (documented) {
      assert.ok(
        ts.isEmptyStatement(documented) || documented.kind === ts.SyntaxKind.EndOfFileToken,
        `${name}: unexpected compiler JSDoc host ${ts.SyntaxKind[documented.kind]}`,
      );
    }
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: side effect before fix`);
    const fixed = fix(fixturePath);
    assert.doesNotMatch(fixed, /import \{ Foo \}/u, `${name}: detached comment must not retain Foo`);
    assert.equal(run(process.execPath, [fixturePath]), 'false', `${name}: removed side effect`);
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
