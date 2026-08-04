const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const {
  assertNoMissingTypes,
  findDocumentedNode,
  fix,
  runOutput: run,
  writeFixture,
} = require('./oxlint-regression-support.cjs');

test('preserves compiler-applied same-line parameter tags after JSDoc examples', () => {
  const cases = [
    [
      'function',
      '/** @example foo @param {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'empty-example',
      '/** @example @param {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'arg-alias',
      '/** @example foo @arg {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'argument-alias',
      '/** @example foo @argument {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'import-alias',
      '/** @example foo @param {Aliased} value */\nexport function documented(value) { return value; }',
      'Aliased',
    ],
    [
      'same-line-returns',
      '/** @example foo @param {Foo} value @returns {Bar} */\nexport function documented(value) { throw new Error(); }',
    ],
    [
      'same-line-parameters',
      '/** @example foo @param {Foo} first @param {Bar} second */\nexport function documented(first, second) { return first; }',
    ],
    ['arrow', '/** @example foo @param {Foo} value */\nexport const documented = (value) => value;'],
    ['default-arrow', '/** @example foo @param {Foo} value */\nexport default (value) => value;'],
    [
      'second-variable-arrow',
      '/** @example foo @param {Foo} value */\nexport const other = (unrelated) => unrelated, documented = (value) => value;',
    ],
    [
      'function-expression',
      '/** @example foo @param {Foo} value */\nexport const documented = function (value) { return value; };',
    ],
    [
      'assigned-function',
      '/** @type {{ exports: any }} */\nconst module = { exports: undefined };\n/** @example foo @param {Foo} value */\nmodule.exports = function (value) { return value; };',
    ],
    [
      'default-parameter',
      '/** @example foo @param {Foo} [value] */\nexport function documented(value = undefined) { return value; }',
    ],
    [
      'rest-parameter',
      '/** @example foo @param {...Foo} values */\nexport function documented(...values) { return values; }',
    ],
    [
      'destructured-parameter',
      '/** @example foo @param {{ value: Foo }} options */\nexport function documented({ value }) { return value; }',
    ],
    [
      'default-export',
      '/** @example foo @param {Foo} value */\nexport default function documented(value) { return value; }',
    ],
    [
      'anonymous-default-export',
      '/** @example foo @param {Foo} value */\nexport default function (value) { return value; }',
    ],
    [
      'instance-method',
      'class Documented {\n/** @example foo @param {Foo} value */\nmethod(value) { return value; }\n}',
    ],
    [
      'static-method',
      'class Documented {\n/** @example foo @param {Foo} value */\nstatic method(value) { return value; }\n}',
    ],
    [
      'object-method',
      'const documented = {\n/** @example foo @param {Foo} value */\nmethod(value) { return value; },\n};',
    ],
    [
      'class-arrow',
      'class Documented {\n/** @example foo @param {Foo} value */\nmethod = (value) => value;\n}',
    ],
    [
      'object-arrow',
      'const documented = {\n/** @example foo @param {Foo} value */\nmethod: (value) => value,\n};',
    ],
    [
      'constructor',
      'class Documented {\n/** @example foo @param {Foo} value */\nconstructor(value) { this.value = value; }\n}',
    ],
    [
      'setter',
      'class Documented {\n/** @example foo @param {Foo} value */\nset current(value) { this.value = value; }\n}',
    ],
  ];

  function findReference(node, name) {
    let reference;
    function visit(candidate) {
      if (ts.isTypeReferenceNode(candidate) && candidate.typeName.escapedText === name) {
        reference ??= candidate.typeName;
      }
      ts.forEachChild(candidate, visit);
    }
    visit(node);
    return reference;
  }

  for (const [name, declaration, imported = 'Foo'] of cases) {
    const clause = imported === 'Foo' ? 'Foo' : `Foo as ${imported}`;
    const siblingBar = name === 'same-line-returns' || name === 'same-line-parameters';
    const retainedBar = siblingBar ? '' : '/** @type {Bar} */\nexport let retained;\n';
    const fixturePath = writeFixture(
      `example-parameter-${name}.mjs`,
      `// @ts-check\nimport { ${clause} } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${declaration}\n${retainedBar}console.log(globalThis.parameterImportRan ?? false);\n`,
    );
    const before = assertNoMissingTypes(fixturePath);
    const documented = findDocumentedNode(
      before,
      fixturePath,
      (tag) => ts.isJSDocParameterTag(tag) && findReference(tag, imported),
    );
    assert.ok(documented, `${name}: TypeScript attaches the parameter tag`);
    const parameterTag = documented.jsDoc
      .flatMap((comment) => comment.tags ?? [])
      .find((tag) => ts.isJSDocParameterTag(tag) && findReference(tag, imported));
    const candidates = ts.isVariableStatement(documented)
      ? documented.declarationList.declarations.map((declaration) => declaration.initializer)
      : ts.isPropertyDeclaration(documented) || ts.isPropertyAssignment(documented)
        ? [documented.initializer]
        : ts.isExportAssignment(documented)
          ? [documented.expression]
          : ts.isExpressionStatement(documented) && ts.isBinaryExpression(documented.expression)
            ? [documented.expression.right]
            : [documented];
    const callable = candidates.find(
      (candidate) =>
        candidate &&
        ts.isFunctionLike(candidate) &&
        candidate.parameters.some((parameter) => ts.getJSDocParameterTags(parameter).includes(parameterTag)),
    );
    assert.ok(callable, `${name}: TypeScript applies the exact tag to a real callable parameter`);
    const reference = findReference(parameterTag, imported);
    const binding = before.getTypeChecker().getSymbolAtLocation(reference);
    assert.equal(ts.SyntaxKind[binding.declarations[0].kind], 'ImportSpecifier', `${name}: compiler binding`);
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: side effect before fix`);

    const fixed = fix(fixturePath);
    assert.ok(fixed.includes(`import { ${clause} }`), `${name}: required example sibling import`);
    assert.match(fixed, /import \{ Bar \}/u, `${name}: genuine sibling or unrelated Bar import`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unrelated unused Ref`);
    const after = assertNoMissingTypes(fixturePath);
    const fixedDocumented = findDocumentedNode(
      after,
      fixturePath,
      (tag) => ts.isJSDocParameterTag(tag) && findReference(tag, imported),
    );
    const fixedTag = fixedDocumented.jsDoc
      .flatMap((comment) => comment.tags ?? [])
      .find((tag) => ts.isJSDocParameterTag(tag) && findReference(tag, imported));
    const fixedBinding = after.getTypeChecker().getSymbolAtLocation(findReference(fixedTag, imported));
    assert.equal(
      ts.SyntaxKind[fixedBinding.declarations[0].kind],
      'ImportSpecifier',
      `${name}: compiler binding after fix`,
    );
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: retained import side effect`);
  }
});

test('ignores example-body comment lookalikes and tags without a matching callable parameter', () => {
  const cases = [
    ['type-body', '/** @example @type {Foo} */\nexport function documented(value) { return value; }'],
    ['bare-body', '/** @example foo @implements Foo */\nexport function documented(value) { return value; }'],
    [
      'line-comment',
      '/** @example foo // @param {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'line-comment-siblings',
      '/** @example foo // @param {Foo} value @returns {Bar} */\nexport function documented(value) { return value; }',
    ],
    [
      'block-comment',
      '/** @example foo /* @param {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'quoted-marker',
      '/** @example foo "@param {Foo} value" */\nexport function documented(value) { return value; }',
    ],
    [
      'backticked-marker',
      '/** @example foo `@param {Foo} value` */\nexport function documented(value) { return value; }',
    ],
    [
      'escaped-marker',
      '/** @example foo \\@param {Foo} value */\nexport function documented(value) { return value; }',
    ],
    [
      'mismatched-parameter',
      '/** @example foo @param {Foo} missing */\nexport function documented(value) { return value; }',
    ],
    ['noncallable-host', '/** @example foo @param {Foo} value */\nexport const documented = 1;'],
    ['noncallable-property', 'class Documented {\n/** @example foo @param {Foo} value */\nvalue = 1;\n}'],
  ];

  for (const [name, declaration] of cases) {
    const fixturePath = writeFixture(
      `example-lookalike-${name}.mjs`,
      `// @ts-check\nimport { Foo } from './parameter-side-effect.mjs';\nimport { Bar, Ref } from './parameter-types.mjs';\n${declaration}\nconsole.log(globalThis.parameterImportRan ?? false);\n`,
    );
    assertNoMissingTypes(fixturePath);
    assert.equal(run(process.execPath, [fixturePath]), 'true', `${name}: side effect before fix`);
    const fixed = fix(fixturePath);
    assert.doesNotMatch(fixed, /import \{ Foo \}/u, `${name}: example body must not retain Foo`);
    assert.doesNotMatch(fixed, /import \{[^}]*\b(?:Bar|Ref)\b/u, `${name}: stale unrelated imports`);
    assert.equal(run(process.execPath, [fixturePath]), 'false', `${name}: removed import side effect`);
  }
});
