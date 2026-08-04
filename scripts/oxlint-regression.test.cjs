const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');
const ts = require('typescript');
require('./oxlint-review-regression.test.cjs');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(repoRoot, 'oxlint-regression-'));
const distRoot = path.join(repoRoot, 'dist');
const removeDistRootAfterTests = !fs.existsSync(distRoot);
fs.mkdirSync(distRoot, { recursive: true });
const ignoredFixtureRoot = fs.mkdtempSync(path.join(distRoot, 'oxlint-regression-'));
const oxlint = path.join(repoRoot, 'node_modules', '.bin', 'oxlint');
const fastFormat = path.join(repoRoot, 'scripts', 'fast-format');
const words = ([text]) => text.trim().split(/\s+/u);

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
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${path.basename(command)} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runOxlintFix(fixturePath, configurationPath) {
  const config = configurationPath ? ['--config', path.relative(repoRoot, configurationPath)] : [];
  run(oxlint, ['--fix', '--no-ignore', ...config, path.relative(repoRoot, fixturePath)]);
}

function assertJSDocCases(fixtureName, cases) {
  const imports = cases.map(([name]) => `import { Foo as ${name} } from './dep.js';`);
  const comments = [...new Set(cases.map(([, comment]) => comment))];
  const fixturePath = writeFixture(
    fixtureName,
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );
  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');
  for (const [name, , retained] of cases) {
    assert.equal(fixed.includes(`import { Foo as ${name} }`), retained, `${fixtureName}: ${name}`);
  }
}

function assertNoMissingJSDocTypes(fixturePath, name) {
  const program = ts.createProgram([fixturePath], {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const missing = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.code === 2304);
  assert.equal(missing.length, 0, name);
}

function assertJSXImportBindings(fixturePath, bindings, fixtureName) {
  const imports = fs
    .readFileSync(fixturePath, 'utf8')
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .map((line) => line.slice(line.indexOf('import ')))
    .filter((line) => line.startsWith('import '))
    .join('\n');
  for (const [name, retained] of Object.entries(bindings)) {
    assert.equal(imports.includes(name), retained, `${fixtureName}: ${name}`);
  }
}

function writeJSXConfiguration(directory, jsxOptions) {
  const configuration = JSON.parse(fs.readFileSync(path.join(repoRoot, '.oxlintrc.json'), 'utf8'));
  configuration.rules['sdk/no-unused-imports'] = ['error', jsxOptions];
  configuration.jsPlugins = [{ name: 'sdk', specifier: path.join(repoRoot, 'scripts', 'oxlint-plugin.cjs') }];
  return writeFixture(`${directory}/.oxlintrc.json`, JSON.stringify(configuration));
}

function runJSXCases(directory, configurationPath, cases) {
  for (const entry of cases) {
    const [name, pragma, body, expected, options] = Array.isArray(entry) ? entry : entry.split(' :: ');
    const bindings = Object.fromEntries(
      expected.split(' ').map((binding) => [binding.replace(/^!/u, ''), !binding.startsWith('!')]),
    );
    const names = Object.keys(bindings);
    const defaultBinding = options && options !== 'inline' ? options : undefined;
    const named = names.filter((binding) => binding !== defaultBinding);
    const clauses = [
      ...(defaultBinding ? [defaultBinding] : []),
      ...(named.length ? [`{ ${named.map((binding) => `Foo as ${binding}`).join(', ')} }`] : []),
    ];
    const importPath = directory ? '../dep.js' : './dep.js';
    const separator = options === 'inline' ? ' ' : '\n';
    const prefix = pragma ? `${pragma}${separator}` : '';
    const statement = body.startsWith('<') ? `export const node = ${body};` : body;
    const source = `${prefix}import ${clauses.join(', ')} from '${importPath}';\n${statement}\n`;
    const fixtureName = directory ? `${directory}/${name}` : name;
    const fixturePath = writeFixture(fixtureName, source);
    runOxlintFix(fixturePath, configurationPath);
    assertJSXImportBindings(fixturePath, bindings, fixtureName);
  }
}

writeFixture(
  'dep.js',
  `export const used = 1;\nexport const usedNamed = 2;\nexport const Foo = 3;\nexport default 4;\n`,
);
writeFixture('type-dep.js', `export class Foo {}\nexport class Bar {}\nexport class Ref {}\n`);

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

test('preserves imports used only by supported JSDoc type tags', () => {
  const cases = [
    ['TypeOnly', '/** @type {TypeOnly} */', true],
    ['TypedefOnly', '/** @typedef {TypedefOnly} Alias */', true],
    ['ParamOnly', '/** @param {ParamOnly} input */', true],
    ['ReturnsOnly', '/** @returns {ReturnsOnly} */', true],
    ['PropertyOnly', '/** @property {PropertyOnly} property */', true],
    ['ThrowsOnly', '/** @throws {ThrowsOnly} */', true],
    ['ImplementsOnly', '/** @implements {ImplementsOnly} */', true],
    ['SatisfiesOnly', '/** @satisfies {SatisfiesOnly} */', true],
    ['NestedOnly', '/** @property {{ nested: { inner: string }, value: NestedOnly }} nested */', true],
    ['QuotedOnly', '/** @property {Record<"}", QuotedOnly>} quoted */', true],
    ['QuotedNestedOnly', '/** @property {{ "}}": string, value: QuotedNestedOnly }} quotedNested */', true],
    ['MultilineOnly', '/** @property\n * {MultilineOnly} multiline */', true],
    ['BareImplementsOnly', '/** @implements BareImplementsOnly */', true],
    ['BareExtendsOnly', '/** @extends BareExtendsOnly */', true],
    ['BareTypeOnly', '/** @type BareTypeOnly */', true],
    ['BareThisOnly', '/** @this BareThisOnly */', true],
    ['BareEnumOnly', '/** @enum BareEnumOnly */', true],
    ['BareNestedOnly', '/** @implements Wrapper<Inner<string>, BareNestedOnly> */', true],
    ['NameFirstParamOnly', '/** @param input {NameFirstParamOnly} */', true],
    ['NameFirstPropertyOnly', '/** @property property {NameFirstPropertyOnly} */', true],
    ['ProseOnly', '/** @property {string} ProseOnly */', false],
  ];
  assertJSDocCases('supported-jsdoc-types.js', cases);
});

test('treats JSDoc template parameters as comment-local type binders', () => {
  const cases = [
    'exact :: T :: @template T @param {T} value',
    'exact-inline-import :: T :: @template T @param {T} value ::  :: inline',
    'earlier-sibling :: T :: @param {T} value @template T',
    'comma-separated :: T U :: @template T, U @param {T} value @returns {U}',
    'multiple-tags :: T U :: @template T @template U @param {T | U} value',
    'earlier-documentation-link :: T :: @see T Description @template T',
    'const-modifier :: T :: @template const T @param {T} value',
    'in-modifier :: T :: @template in T @param {T} value',
    'out-modifier :: T :: @template out T @param {T} value',
    'combined-modifiers :: T :: @template in out const T @param {T} value',
    'modified-binders :: T U V :: @template in T, out U, const V @param {T | U | V} value',
    'modified-default :: T Default :: @template [in T=Default] @param {T} value :: Default',
    'modifier-as-binder :: out :: @template out @param {out} value',
    'multiline :: T U :: \n * @template\n * T,\n * U\n * @param {T | U} value\n',
    'constraint :: T Constraint :: @template {Constraint} T @param {T} value :: Constraint',
    'multiple-constrained :: T U Constraint :: @template {Record<string, Constraint>} T, U @param {T | U} value :: Constraint',
    'matching-constraint :: T :: @template {T} T @param {T} value :: T',
    'default :: T Default :: @template [T=Default] @param {T} value :: Default',
    'matching-default :: T :: @template [T=T] @param {T} value :: T',
    'sibling-default :: T U :: @template T, [U=T] @param {T | U} value',
    'sibling-imported-default :: T U Ref :: @template T, [U=Ref] @param {T | U} value :: Ref',
    'separate-tag-default :: T U :: @template T @template [U=T] @param {T | U} value',
    'sibling-constraint :: T U :: @template {T} U @template T @param {T | U} value :: T',
    'multiple-defaults :: T U FirstDefault SecondDefault :: @template [T=Record<string, FirstDefault>], [U=SecondDefault[]] @returns {T | U} :: FirstDefault SecondDefault',
    'multiline-defaults :: T U Constraint Default :: \n * @template\n * {Constraint}\n * T,\n * [U = Default]\n * @param {T | U} value\n :: Constraint Default',
    'sibling-after-default :: T Default Result :: @template [T=Default] @param {T} value @returns {Result} :: Default Result',
    'object-default :: T ObjectDefault TupleDefault :: @template [T={ value: ObjectDefault, items: [TupleDefault, string] }] @returns {T} :: ObjectDefault TupleDefault',
    'interpolated-default :: T InterpolatedDefault :: @template [T=`prefix-${InterpolatedDefault}`] @returns {T} :: InterpolatedDefault',
    'constraint-literals :: T QuotedOnly PropertyOnly :: @template {{ PropertyOnly: "QuotedOnly" }} T @returns {T}',
    'default-literals :: T QuotedOnly PropertyOnly :: @template [T={ PropertyOnly: "QuotedOnly" }] @returns {T}',
    'unicode :: Δelta 变量 𐐀stral :: @template Δelta, 变量, 𐐀stral @param {Δelta | 变量 | 𐐀stral} value',
    'escaped-unicode :: T Éclair 𐐀stral :: @template \\u0054, \\u00c9clair, \\u{10400}stral @param {T | Éclair | 𐐀stral} value',
    'combining-unicode :: Cafe\u0301 :: @template Cafe\\u0301 @param {Cafe\u0301} value',
    'identifier-prefix :: T Template :: @template T @param {T | Template} value :: Template',
    'escaped-joiner :: Type\u200cName :: @template Type\\u200cName @param {Type\u200cName} value',
    'documentation-link :: T :: @template T @see T Description {@link T}.',
    'cross-comment-isolation :: T :: /** @template T @param {T} value */\n/** @type {T} */ :: T',
    'quoted-lookalike :: T :: @deprecated "@template T" @param {T} value :: T',
    'backticked-lookalike :: T :: @deprecated `@template T` @param {T} value :: T',
    'example-lookalike :: T :: \n * @example "@template T"\n * @param {T} value\n :: T',
    'trailing-constraint-lookalike :: T Constraint :: @template T extends Constraint @param {T} value',
    'invalid-binder :: T :: @template 1T @param {T} value :: T',
    'invalid-bracketed-binder :: T :: @template [T] @param {T} value :: T',
  ];
  for (const entry of cases) {
    const [name, imported, documentation, kept = '', mode] = entry.split(' :: ');
    const inline = mode === 'inline';
    const names = imported.split(' ');
    const retained = kept ? kept.split(' ') : [];
    const comment = documentation.startsWith('/**') ? documentation : `/** ${documentation} */`;
    const modulePath = inline ? './dep' : './dep.js';
    const imports = names.map((binding) => `import { Foo as ${binding} } from '${modulePath}';`);
    const fixturePath = writeFixture(
      `template-${name}.js`,
      `${imports.join('\n')}${inline ? ' ' : '\n'}${comment}\nconsole.log('done');\n`,
    );
    runOxlintFix(fixturePath);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    for (const binding of names) {
      assert.equal(
        fixed.includes(`import { Foo as ${binding} }`),
        retained.includes(binding),
        `${name}: ${binding}`,
      );
    }
  }
});

test('removes imports appearing only in JSDoc string literals and property names', () => {
  assertJSDocCases('jsdoc-literal-and-property.js', [
    ['LiteralOnly', '/** @type {"LiteralOnly"} */', false],
    ['PropertyOnly', '/** @type {{ PropertyOnly: string }} */', false],
  ]);
});

test('distinguishes JSDoc type references from literals, members, keys, and binders', () => {
  const cases = [
    ['StringLiteralOnly', '"StringLiteralOnly"', false],
    ['SingleQuotedLiteralOnly', "'SingleQuotedLiteralOnly'", false],
    ['TemplateLiteralTextOnly', '`TemplateLiteralTextOnly`', false],
    ['ObjectKeyOnly', '{ ObjectKeyOnly: string }', false],
    ['QuotedObjectKeyOnly', '{ "QuotedObjectKeyOnly": string }', false],
    ['SingleQuotedObjectKeyOnly', "{ 'SingleQuotedObjectKeyOnly': string }", false],
    ['OptionalObjectKeyOnly', '{ OptionalObjectKeyOnly?: string }', false],
    ['ReadonlyObjectKeyOnly', '{ readonly ReadonlyObjectKeyOnly: string }', false],
    ['ObjectMethodNameOnly', '{ ObjectMethodNameOnly(value: string): number }', false],
    ['QualifiedMemberOnly', 'Namespace.QualifiedMemberOnly', false],
    ['TypeofMemberOnly', 'typeof Namespace.TypeofMemberOnly', false],
    ['IndexedStringOnly', 'Container["IndexedStringOnly"]', false],
    ['ParameterNameOnly', '(ParameterNameOnly: string) => void', false],
    ['OptionalParameterOnly', '(OptionalParameterOnly?: string) => void', false],
    ['RestParameterOnly', '(...RestParameterOnly: string[]) => void', false],
    ['UntypedParameterOnly', '(UntypedParameterOnly) => string', false],
    ['OptionalUntypedParameterOnly', '(OptionalUntypedParameterOnly?) => string', false],
    ['RestUntypedParameterOnly', '(...RestUntypedParameterOnly) => string', false],
    ['DefaultParameterOnly', '(DefaultParameterOnly = value) => string', false],
    ['UntypedConstructorParameterOnly', 'new (UntypedConstructorParameterOnly) => string', false],
    ['UntypedMethodParameterOnly', '{ method(UntypedMethodParameterOnly): string }', false],
    ['UntypedCallParameterOnly', '{ (UntypedCallParameterOnly): string }', false],
    ['DestructuredPropertyOnly', '({ DestructuredPropertyOnly }: Input) => void', false],
    ['DestructuredAliasOnly', '({ value: DestructuredAliasOnly }: Input) => void', false],
    ['DestructuredArrayOnly', '([DestructuredArrayOnly]: Input) => void', false],
    ['ConstructorParameterOnly', 'new (ConstructorParameterOnly: string) => object', false],
    ['ClosureParameterOnly', 'function(ClosureParameterOnly: string): void', false],
    ['TupleLabelOnly', '[TupleLabelOnly: string]', false],
    ['OptionalTupleLabelOnly', '[OptionalTupleLabelOnly?: string]', false],
    ['IndexSignatureNameOnly', '{ [IndexSignatureNameOnly: string]: number }', false],
    ['MappedBinderOnly', '{ [MappedBinderOnly in keyof Shape]: string }', false],
    ['MappedShadowOnly', '{ [MappedShadowOnly in keyof Shape]: MappedShadowOnly }', false],
    [
      'RemappedShadowOnly',
      '{ [RemappedShadowOnly in keyof Shape as `${RemappedShadowOnly}`]: string }',
      false,
    ],
    ['InferredBinderOnly', 'Source extends infer InferredBinderOnly ? string : never', false],
    ['InferredShadowOnly', 'Source extends infer InferredShadowOnly ? InferredShadowOnly : never', false],
    ['X', 'string extends (number extends infer X ? X : never) ? X : never', true],
    ['GenericBinderOnly', '<GenericBinderOnly extends Base>(value: GenericBinderOnly) => void', false],
    ['ObjectValueOnly', '{ value: ObjectValueOnly }', true],
    ['QuotedPropertyValueOnly', '{ "label": QuotedPropertyValueOnly }', true],
    ['SingleQuotedPropertyValueOnly', "{ 'label': SingleQuotedPropertyValueOnly }", true],
    ['NumericPropertyValueOnly', '{ 0: NumericPropertyValueOnly }', true],
    ['HexPropertyValueOnly', '{ 0x10: HexPropertyValueOnly }', true],
    ['QualifiedNamespaceOnly', 'QualifiedNamespaceOnly.Member', true],
    ['NestedNamespaceOnly', 'NestedNamespaceOnly.Member.Deep', true],
    ['GenericValueOnly', 'Record<string, GenericValueOnly>', true],
    ['UnionLeftOnly', 'UnionLeftOnly | string', true],
    ['UnionRightOnly', 'string | UnionRightOnly', true],
    ['IntersectionOnly', 'IntersectionOnly & Record<string, unknown>', true],
    ['NullableOnly', '?NullableOnly', true],
    ['NonNullableOnly', '!NonNullableOnly', true],
    ['GroupedOnly', '(GroupedOnly | null)', true],
    ['TupleFirstOnly', '[TupleFirstOnly, string]', true],
    ['TupleSecondOnly', '[string, TupleSecondOnly?]', true],
    ['ArrayElementOnly', 'ArrayElementOnly[]', true],
    ['ReadonlyArrayOnly', 'readonly ReadonlyArrayOnly[]', true],
    ['FunctionParameterTypeOnly', '(value: FunctionParameterTypeOnly) => void', true],
    ['FunctionResultOnly', '(value: string) => FunctionResultOnly', true],
    ['ConstructorParameterTypeOnly', 'new (value: ConstructorParameterTypeOnly) => object', true],
    ['ConstructorResultOnly', 'new (value: string) => ConstructorResultOnly', true],
    ['ClosureThisOnly', 'function(this: ClosureThisOnly): void', true],
    ['ClosureNewOnly', 'function(new: ClosureNewOnly): void', true],
    ['ClosureValueOnly', 'function(value: ClosureValueOnly): void', true],
    ['ClosureUnnamedParameterTypeOnly', 'function(ClosureUnnamedParameterTypeOnly): void', true],
    ['ClosureResultOnly', 'function(value: string): ClosureResultOnly', true],
    ['MappedConstraintOnly', '{ [Key in keyof MappedConstraintOnly]: string }', true],
    ['MappedValueOnly', '{ [Key in keyof Shape]: MappedValueOnly }', true],
    ['IndexedContainerOnly', 'IndexedContainerOnly[string]', true],
    ['IndexedAccessOnly', 'Container[IndexedAccessOnly]', true],
    ['ComputedKeyOnly', '{ [ComputedKeyOnly]: string }', true],
    ['KeyofValueOnly', 'keyof KeyofValueOnly', true],
    ['TypeofRootOnly', 'typeof TypeofRootOnly.member', true],
    ['ConditionalConditionOnly', 'ConditionalConditionOnly extends Base ? string : number', true],
    ['ConditionalConstraintOnly', 'Source extends ConditionalConstraintOnly ? string : number', true],
    ['ConditionalTrueOnly', 'Source extends Base ? ConditionalTrueOnly : string', true],
    ['ConditionalFalseOnly', 'Source extends Base ? string : ConditionalFalseOnly', true],
    ['InferConstraintOnly', 'Source extends infer Value extends InferConstraintOnly ? Value : never', true],
    [
      'GenericSiblingReferenceOnly',
      '{ first: <GenericSiblingReferenceOnly>(value: GenericSiblingReferenceOnly) => string; second: GenericSiblingReferenceOnly }',
      true,
    ],
    [
      'GenericMethodSiblingReferenceOnly',
      '{ method<GenericMethodSiblingReferenceOnly>(value: GenericMethodSiblingReferenceOnly): string; second: GenericMethodSiblingReferenceOnly }',
      true,
    ],
    ['TemplateInterpolationOnly', '`${TemplateInterpolationOnly}`', true],
    [
      'NestedTemplateInterpolationOnly',
      '`${string extends string ? `${NestedTemplateInterpolationOnly}` : `x`}`',
      true,
    ],
  ];
  assertJSDocCases(
    'jsdoc-structural-type-references.js',
    cases.map(([name, type, retained]) => [name, `/** @type {${type}} */`, retained]),
  );
});

test('preserves every reference in complete unbraced JSDoc type expressions', () => {
  const used = words`BareUnionLeftOnly BareUnionRightOnly BareNullableOnly BareNonNullableOnly BareGroupedOnly
    BareIntersectionLeftOnly BareIntersectionRightOnly BareTupleFirstOnly BareTupleSecondOnly BareArrayOnly
    BareKeyofOnly BareTypeofOnly BareFunctionParameterOnly BareFunctionResultOnly BareClosureParameterOnly
    BareClosureResultOnly BareConstructorParameterOnly BareConstructorResultOnly BareConditionalTrueOnly
    BareConditionalFalseOnly BareNestedGenericOnly BareAfterSiblingOnly`;
  const comments = [
    '/** @type BareUnionLeftOnly | BareUnionRightOnly */',
    '/** @type ?BareNullableOnly */',
    '/** @type !BareNonNullableOnly */',
    '/** @type (BareGroupedOnly | null) */',
    '/** @type BareIntersectionLeftOnly & BareIntersectionRightOnly */',
    '/** @type [BareTupleFirstOnly, BareTupleSecondOnly] */',
    '/** @type BareArrayOnly[] */',
    '/** @type keyof BareKeyofOnly */',
    '/** @type typeof BareTypeofOnly.member */',
    '/** @type (value: BareFunctionParameterOnly) => BareFunctionResultOnly */',
    '/** @type function (value: BareClosureParameterOnly): BareClosureResultOnly */',
    '/** @type new (value: BareConstructorParameterOnly) => BareConstructorResultOnly */',
    '/** @type string extends string ? BareConditionalTrueOnly : BareConditionalFalseOnly */',
    '/** @implements Wrapper<Inner<string>, BareNestedGenericOnly> @returns {BareAfterSiblingOnly} */',
    '/** @type BareUnionLeftOnly explanation BareTrailingProseOnly */',
  ];
  const names = [...used, 'BareTrailingProseOnly'];
  const imports = names.map((name) => `import { Foo as ${name} } from './dep.js';`);
  const fixturePath = writeFixture(
    'jsdoc-complete-bare-types.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );
  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');
  for (const name of names)
    assert.equal(fixed.includes(`import { Foo as ${name} }`), used.includes(name), name);
});

test('retains compiler-recognized grouped keyof operands and newline-separated member references', () => {
  const cases = [
    ['keyof-grouped', ['Foo', 'Bar'], '/** @type keyof (Foo & Bar) */'],
    ['keyof-object', ['Foo'], '/** @type keyof { key: Foo } */'],
    ['generic-member-newline', ['Ref'], '/** @type {{ method<Ref>(): Ref\n other: Ref }} */'],
  ];
  for (const [name, names, comment] of cases) {
    const source = `// @ts-check\nimport { ${names.join(', ')} } from './type-dep.js';\n${comment}\nconst value = undefined;\n`;
    const fixturePath = writeFixture(`compiler-${name}.js`, source);
    assertNoMissingJSDocTypes(fixturePath, `${name}: before fix`);
    runOxlintFix(fixturePath);
    assertNoMissingJSDocTypes(fixturePath, `${name}: after fix`);
    const imports = fs
      .readFileSync(fixturePath, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('import '));
    for (const binding of names) {
      assert.ok(
        imports.some((line) => new RegExp(`\\b${binding}\\b`).test(line)),
        `${name}: ${binding}`,
      );
    }
  }
});

test('matches compiler bindings for JSDoc templates, generic defaults, and conditional infer scopes', () => {
  writeFixture('generic-side-effect.mjs', 'globalThis.genericImportRan = true; export class Foo {}\n');
  const nestedInfer = 'string extends (number extends infer X ? X : never) ? X : never';
  const cases = [
    ['earlier-default', '<T, U = T>(value: U) => U', [], 'TypeParameter'],
    ['earlier-constraint', '<T, U extends T>(value: U) => U', [], 'TypeParameter'],
    ['imported-default', '<T, U = Ref>(value: U) => U', ['Ref'], 'ImportSpecifier'],
    ['imported-constraint', '<T, U extends Ref>(value: U) => U', ['Ref'], 'ImportSpecifier'],
    ['same-default', '<T = T>(value: T) => T', ['T'], 'TypeParameter'],
    ['later-default', '<T = U, U = Ref>(value: T) => T', ['U', 'Ref'], 'TypeParameter'],
    ['template-earlier-default', '@template T, [U=T] @param {U} value', [], 'TypeParameter'],
    ['template-imported-default', '@template T, [U=Ref] @param {U} value', ['Ref'], 'ImportSpecifier'],
    ['nested-infer-outer', nestedInfer, ['X'], 'ImportSpecifier'],
  ];
  for (const [name, type, retained, declaration] of cases) {
    const documentation = type.startsWith('@') ? type : `@type {${type}}`;
    const statement = type.startsWith('@') ? 'export function value(value) {}' : 'export let value;';
    const source = `// @ts-check\nimport { Foo as T, Foo as U, Foo as Ref, Foo as X } from './generic-side-effect.mjs';\n/** ${documentation} */\n${statement}\nconsole.log(globalThis.genericImportRan ?? false);\n`;
    const fixturePath = writeFixture(`compiler-generic-${name}.mjs`, source);
    const program = ts.createProgram([fixturePath], {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      types: [],
    });
    const documented = program.getSourceFile(fixturePath).statements.find((node) => node.jsDoc?.length);
    const tag = documented.jsDoc[0].tags[0];
    const signature = ts.isJSDocTemplateTag(tag) ? tag : tag.typeExpression.type;
    const parameter = signature.typeParameters?.find((node) => node.default || node.constraint);
    const getDeclaration = (node) =>
      ts.SyntaxKind[program.getTypeChecker().getSymbolAtLocation(node.typeName).declarations[0].kind];
    assert.equal(
      getDeclaration(parameter ? (parameter.default ?? parameter.constraint) : signature.trueType),
      name === 'template-earlier-default' ? 'ImportSpecifier' : declaration,
      name,
    );
    if (ts.isConditionalTypeNode(signature))
      assert.equal(
        getDeclaration(signature.extendsType.type.trueType),
        'TypeParameter',
        `${name}: inner infer`,
      );
    assertNoMissingJSDocTypes(fixturePath, `${name}: before fix`);
    runOxlintFix(fixturePath);
    assertNoMissingJSDocTypes(fixturePath, `${name}: after fix`);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    for (const binding of ['T', 'U', 'Ref', 'X'])
      assert.equal(
        new RegExp(`\\bFoo as ${binding}\\b`, 'u').test(fixed),
        retained.includes(binding),
        `${name}: ${binding}`,
      );
    assert.equal(run(process.execPath, [fixturePath]).stdout.trim(), String(retained.length > 0), name);
  }
});

test('resolves JSDoc imports against their visible lexical bindings', () => {
  const cases = [
    ['function-local', 'export function use() { class Foo {} /** @type {Foo} */ let value; }', false],
    ['block-local', 'export function use() { { class Foo {} /** @type {Foo} */ let value; } }', false],
    ['hoisted-local', 'export function use() { /** @type {Foo} */ let value; class Foo {} }', false],
    ['module-visible', '/** @type {Foo} */ export let value;', true],
    [
      'shadowed-and-visible',
      'export function use() { class Foo {} /** @type {Foo} */ let local; }\n/** @type {Foo} */ export let visible;',
      true,
    ],
  ];
  for (const [name, body, keepFoo] of cases) {
    const fixturePath = writeFixture(
      `jsdoc-binding-${name}.js`,
      `// @ts-check\nimport { Foo, Bar, Ref } from './type-dep.js';\n${body}\n/** @type {Bar} */ export let imported;\n`,
    );
    assertNoMissingJSDocTypes(fixturePath, `${name}: before fix`);
    runOxlintFix(fixturePath);
    assertNoMissingJSDocTypes(fixturePath, `${name}: after fix`);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    assert.equal(/\bFoo\b/u.test(fixed.split('\n')[1]), keepFoo, `${name}: Foo import`);
    assert.match(fixed, /import \{[^}]*\bBar\b/u, `${name}: imported Bar`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unused Ref`);
  }
});

test('recognizes real sibling tags after individually closed prose code spans', () => {
  for (const [name, prose] of [
    ['comma-separated', '`a`, `b`'],
    ['prose-separated', '`a` and `b`'],
    ['three-spans', '`a`, ordinary `b`, then `c`'],
  ]) {
    const source = `// @ts-check\nimport { Foo, Bar, Ref } from './type-dep.js';\n/** @param {Foo} x ${prose} @returns {Bar} */\nexport function convert(x) { return x; }\n`;
    const fixturePath = writeFixture(`jsdoc-closed-spans-${name}.js`, source);
    const compilerSource = ts.createSourceFile(fixturePath, source, ts.ScriptTarget.Latest, true);
    const tags = compilerSource.statements.at(-1).jsDoc[0].tags;
    assert.ok(ts.isJSDocParameterTag(tags[0]) && ts.isJSDocReturnTag(tags[1]), name);
    assertNoMissingJSDocTypes(fixturePath, `${name}: before fix`);
    runOxlintFix(fixturePath);
    assertNoMissingJSDocTypes(fixturePath, `${name}: after fix`);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    assert.match(fixed, /import \{ Foo, Bar \}/u, `${name}: Foo and Bar`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unused Ref`);
  }
});

test('retains imports used in nested callback and overload JSDoc signatures', () => {
  const cases = [
    [
      'callback',
      '/**\n * @callback Handler\n * @param {Foo} value\n * @returns {Bar}\n */\n/** @type {Handler} */\nexport let handler;',
    ],
    [
      'overload',
      '/**\n * @overload\n * @param {Foo} value\n * @returns {Bar}\n */\n/** @param {*} value @returns {*} */\nexport function convert(value) { return value; }',
    ],
  ];
  for (const [name, body] of cases) {
    const source = `// @ts-check\nimport { Foo, Bar, Ref } from './type-dep.js';\n${body}\n`;
    const fixturePath = writeFixture(`jsdoc-signature-${name}.js`, source);
    const compilerSource = ts.createSourceFile(fixturePath, source, ts.ScriptTarget.Latest, true);
    const signature = compilerSource.statements.at(-1).jsDoc[0].tags[0];
    assert.equal(
      signature.kind,
      ts.SyntaxKind[name === 'callback' ? 'JSDocCallbackTag' : 'JSDocOverloadTag'],
    );
    assert.ok(signature.typeExpression.parameters.length && signature.typeExpression.type, name);
    assertNoMissingJSDocTypes(fixturePath, `${name}: before fix`);
    runOxlintFix(fixturePath);
    assertNoMissingJSDocTypes(fixturePath, `${name}: after fix`);
    const fixed = fs.readFileSync(fixturePath, 'utf8');
    assert.match(fixed, /import \{ Foo, Bar \}/u, `${name}: Foo and Bar`);
    assert.doesNotMatch(fixed, /import \{[^}]*\bRef\b/u, `${name}: unused Ref`);
  }
});

test('preserves genuine JSDoc documentation links without counting labels or URLs', () => {
  const cases = [
    ['SeeSymbolOnly', '/** @see SeeSymbolOnly */', true],
    ['SeeQualifiedOnly', '/** @see SeeQualifiedOnly.member */', true],
    ['SeeHashOnly', '/** @see SeeHashOnly#member */', true],
    ['SeeTildeOnly', '/** @see SeeTildeOnly~member */', true],
    ['SeeLabelOnly', '/** @see SeeLabelOnly readable label */', true],
    ['SeePipeOnly', '/** @see SeePipeOnly|readable label */', true],
    ['LienÉchappé', '/** @see Lien\\u00c9chapp\\u00e9 */', true],
    ['LinkSymbolOnly', '/** @link LinkSymbolOnly */', true],
    ['LinkCodeSymbolOnly', '/** @linkcode LinkCodeSymbolOnly */', true],
    ['LinkPlainSymbolOnly', '/** @linkplain LinkPlainSymbolOnly */', true],
    ['InlineSymbolOnly', '/** Description {@link InlineSymbolOnly}. */', true],
    ['InlineLabelOnly', '/** Description {@link InlineLabelOnly readable label}. */', true],
    ['InlinePipeOnly', '/** Description {@link InlinePipeOnly|readable label}. */', true],
    ['InlineQualifiedOnly', '/** Description {@link InlineQualifiedOnly.member}. */', true],
    ['InlineHashOnly', '/** Description {@link InlineHashOnly#member}. */', true],
    ['InlineCodeOnly', '/** Description {@linkcode InlineCodeOnly}. */', true],
    ['InlinePlainOnly', '/** Description {@linkplain InlinePlainOnly}. */', true],
    ['InlineDeprecatedOnly', '/** @deprecated Use {@link InlineDeprecatedOnly}. */', true],
    ['SiblingSeeOnly', '/** @see SiblingSeeOnly details @returns {string} */', true],
    ['QuotedInlineOnly', '/** See "{@link QuotedInlineOnly}". */', true],
    ['BacktickedInlineOnly', '/** See `{@link BacktickedInlineOnly}`. */', true],
    ['QuotedDeprecatedInlineOnly', '/** @deprecated Use "{@link QuotedDeprecatedInlineOnly}". */', true],
    [
      'BacktickedDeprecatedInlineOnly',
      '/** @deprecated Use `{@link BacktickedDeprecatedInlineOnly}`. */',
      true,
    ],
    ['Foo', '/** @deprecated "{@link Foo}" and `{@link Bar}`. */', true],
    ['Bar', '/** @deprecated "{@link Foo}" and `{@link Bar}`. */', true],
    ['SeeDisplayOnly', '/** @see Other SeeDisplayOnly */', false],
    ['SeeMemberOnly', '/** @see Namespace.SeeMemberOnly */', false],
    ['SeeEscapedPrefixOnly', '/** @see SeeEscapedPrefixOnly\\u0042 */', false],
    ['SeeUrlOnly', '/** @see https://example.com/SeeUrlOnly */', false],
    ['SeeMailOnly', '/** @see mailto:SeeMailOnly */', false],
    ['QuotedSeeOnly', '/** @see "QuotedSeeOnly" */', false],
    ['BracedSeeOnly', '/** @see {BracedSeeOnly} */', false],
    ['LinkDisplayOnly', '/** @link Other LinkDisplayOnly */', false],
    ['LinkUrlOnly', '/** @link https://example.com/LinkUrlOnly */', false],
    ['InlineDisplayOnly', '/** Description {@link Other InlineDisplayOnly}. */', false],
    ['InlinePipeDisplayOnly', '/** Description {@link Other|InlinePipeDisplayOnly}. */', false],
    ['InlineMemberOnly', '/** Description {@link Namespace.InlineMemberOnly}. */', false],
    ['InlineUrlOnly', '/** Description {@link https://example.com/InlineUrlOnly}. */', false],
    ['InlineModuleOnly', '/** Description {@link module:InlineModuleOnly}. */', false],
    ['ExampleInlineOnly', '/** @example {@link ExampleInlineOnly} */', false],
    ['ExampleBlockOnly', '/** @example @see ExampleBlockOnly */', false],
    ['EscapedInlineOnly', '/** Description \\{@link EscapedInlineOnly}. */', false],
  ];
  assertJSDocCases('jsdoc-documentation-links.js', cases);
});

test('recognizes complete Unicode JSDoc identifiers without matching identifier prefixes', () => {
  const cases = [
    ['Café', 'CaféÉ', false],
    ['CaféExact', 'CaféExact', true],
    ['Éclair', 'Namespace.Éclair', false],
    ['Δelta', '{ Δelta: string }', false],
    ['变量', '{ value: 变量 }', true],
    ['Cafe\u0301', 'Cafe\u0301Suffix', false],
    ['Exact\u0301', 'Exact\u0301', true],
    ['𐐀stral', '𐐀stralSuffix', false],
    ['𐐁xact', '𐐁xact', true],
    ['CaféEscaped', 'Caf\\u00e9Escaped', true],
    ['ÉscapedStart', '\\u00c9scapedStart', true],
    ['𐐀EscapedAstral', '\\u{10400}EscapedAstral', true],
    ['Combining\u0301Escaped', 'Combining\\u0301Escaped', true],
    ['FooEscapedPrefix', 'FooEscapedPrefix\\u0042', false],
    ['FooEscapedJoiner', 'FooEscapedJoiner\\u200cBar', false],
  ];
  assertJSDocCases(
    'jsdoc-unicode-identifiers.js',
    cases.map(([name, type, retained]) => [name, `/** @type {${type}} */`, retained]),
  );
});

test('preserves every genuine type reference in same-line sibling JSDoc tags', () => {
  const names = words`Foo Bar NamedFirstArgOnly ArgumentAliasOnly ReturnAliasOnly ExceptionAliasOnly YieldAliasOnly
    YieldsAliasOnly PropertyAliasOnly NameFirstPropertyOnly ThrowsAliasOnly SatisfiesAliasOnly
    BareImplementsOnly BareAugmentsOnly BareExtendsOnly BareTypeOnly BareThisOnly BareEnumOnly
    TypedefAliasOnly TemplateAliasOnly ConstAliasOnly ConstantAliasOnly DefineAliasOnly VarAliasOnly
    MemberAliasOnly ModuleAliasOnly NamespaceAliasOnly NamedFirstParamOnly NamedFirstPropOnly
    NamedFirstArgumentOnly UntypedTemplateParamOnly UntypedTemplateReturnsOnly BareNestedSiblingOnly
    AfterBareGenericOnly ArrowBareGenericOnly AfterArrowBareGenericOnly NonBreakingSpaceParamOnly
    NonBreakingSpaceReturnsOnly NestedArrowInputOnly NestedArrowResultOnly NestedArrowMemberOnly
    AfterNestedArrowOnly EmSpaceParamOnly EmSpaceReturnsOnly`;
  const comments = [
    '/** @param {Foo} x @returns {Bar} */',
    '/** @arg input {NamedFirstArgOnly} @argument {ArgumentAliasOnly} value @return {ReturnAliasOnly} @exception {ExceptionAliasOnly} @yield {YieldAliasOnly} @yields {YieldsAliasOnly} */',
    '/** @prop {PropertyAliasOnly} field @property named {NameFirstPropertyOnly} @throws {ThrowsAliasOnly} @satisfies {SatisfiesAliasOnly} */',
    '/** @implements BareImplementsOnly @augments BareAugmentsOnly @extends BareExtendsOnly @type BareTypeOnly @this BareThisOnly @enum BareEnumOnly */',
    '/** @typedef {TypedefAliasOnly} Alias @template {TemplateAliasOnly} T @const {ConstAliasOnly} @constant {ConstantAliasOnly} @define {DefineAliasOnly} @var {VarAliasOnly} @member {MemberAliasOnly} */',
    '/** @module {ModuleAliasOnly} InlineModule @namespace {NamespaceAliasOnly} InlineNamespace */',
    '/** @param first {NamedFirstParamOnly} @prop field {NamedFirstPropOnly} @argument last {NamedFirstArgumentOnly} */',
    '/** @template T @param {UntypedTemplateParamOnly} value @returns {UntypedTemplateReturnsOnly} */',
    '/** @implements Wrapper<Inner<string>, BareNestedSiblingOnly> @returns {AfterBareGenericOnly} */',
    '/** @implements Wrapper<() => ArrowBareGenericOnly> @returns {AfterArrowBareGenericOnly} */',
    '/** @param {NonBreakingSpaceParamOnly} value\u00a0@returns {NonBreakingSpaceReturnsOnly} */',
    '/** @implements Wrapper<{ run: (value: NestedArrowInputOnly) => NestedArrowResultOnly }, NestedArrowMemberOnly> @returns {AfterNestedArrowOnly} */',
    '/** @param {EmSpaceParamOnly} value\u2003@returns {EmSpaceReturnsOnly} */',
  ];
  const unused = 'UnusedInlineOnly';
  const imports = [...names, unused].map((name) => `import { Foo as ${name} } from './dep.js';`);
  const fixturePath = writeFixture(
    'jsdoc-same-line-siblings.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );
  const before = fs.readFileSync(fixturePath, 'utf8');
  runOxlintFix(fixturePath);
  assert.equal(
    fs.readFileSync(fixturePath, 'utf8'),
    before.replace(`import { Foo as ${unused} } from './dep.js';`, ''),
  );
});

test('ignores example and prose lookalikes while preserving later genuine sibling tags', () => {
  const unused = words`UnquotedInlineExampleOnly UnquotedEmbeddedExampleOnly QuotedInlineExampleOnly
    QuotedEmbeddedExampleOnly BacktickedInlineExampleOnly BacktickedEmbeddedExampleOnly NestedQuotedExampleOnly
    NestedBacktickedExampleOnly SingleLineCommentExampleOnly SingleLineBareExampleOnly UnquotedBareExampleOnly
    UnquotedBareEmbeddedExampleOnly DeprecatedQuotedOnly DeprecatedBacktickedOnly DeprecatedBracedOnly
    InterleavedDeprecatedBracedOnly ExternalNestedFakeOnly DeprecatedQuotedSiblingFakeOnly
    InterpolatedBacktickProseFakeOnly EmailProseOnly QuotedAfterRealOnly BacktickedAfterRealOnly EmailAfterRealOnly
    AfterRealExampleOnly AfterRealEmbeddedExampleOnly InlineExampleBeforeRecoveryOnly MultilineCommentExampleOnly
    MultilineCommentEmbeddedOnly MultilineSourceBareExampleOnly MultilineQuotedExampleOnly UnusedExampleControlOnly`;
  const retained = words`RealBeforeProseOnly RealAfterProseOnly RealBeforeExampleOnly AfterDeprecatedOnly
    BeforeDeprecatedOnly AfterInterleavedDeprecatedOnly AfterExternalOnly AfterQuotedDeprecatedOnly
    BeforeInterpolatedBacktickOnly AfterInterpolatedBacktickOnly AfterExampleParamOnly AfterExampleReturnsOnly
    AfterExampleBareOnly AfterExampleAugmentsOnly`;
  const comments = [
    '/** @example @type {UnquotedInlineExampleOnly} @returns {UnquotedEmbeddedExampleOnly} */',
    '/** @example "@type {QuotedInlineExampleOnly} @returns {QuotedEmbeddedExampleOnly}" */',
    '/** @example `@type {BacktickedInlineExampleOnly} @implements BacktickedEmbeddedExampleOnly` */',
    '/** @example call("@type {NestedQuotedExampleOnly}", `@returns {NestedBacktickedExampleOnly}`) */',
    '/** @example // @type {SingleLineCommentExampleOnly} @implements SingleLineBareExampleOnly */',
    '/** @example @implements UnquotedBareExampleOnly @type {UnquotedBareEmbeddedExampleOnly} */',
    '/** @deprecated "@type {DeprecatedQuotedOnly}" `@returns {DeprecatedBacktickedOnly}` */',
    '/** @deprecated description {DeprecatedBracedOnly} @returns {AfterDeprecatedOnly} */',
    '/** @param {BeforeDeprecatedOnly} input @deprecated old {InterleavedDeprecatedBracedOnly} @returns {AfterInterleavedDeprecatedOnly} */',
    '/** @external { @type {ExternalNestedFakeOnly} } @returns {AfterExternalOnly} */',
    '/** @deprecated "@returns {DeprecatedQuotedSiblingFakeOnly}" @returns {AfterQuotedDeprecatedOnly} */',
    '/** @param {BeforeInterpolatedBacktickOnly} x `${flag ? ` @returns {InterpolatedBacktickProseFakeOnly} ` : `x`}` @returns {AfterInterpolatedBacktickOnly} */',
    '/** Contact user@type {EmailProseOnly} */',
    '/** @param {RealBeforeProseOnly} input "@type {QuotedAfterRealOnly}" `@throws {BacktickedAfterRealOnly}` user@returns {EmailAfterRealOnly} @returns {RealAfterProseOnly} */',
    '/** @returns {RealBeforeExampleOnly} @example @type {AfterRealExampleOnly} @throws {AfterRealEmbeddedExampleOnly} */',
    '/**\n * @example @type {InlineExampleBeforeRecoveryOnly}\n * // @type {MultilineCommentExampleOnly} @returns {MultilineCommentEmbeddedOnly}\n * source @implements MultilineSourceBareExampleOnly\n * "@throws {MultilineQuotedExampleOnly}"\n * @param {AfterExampleParamOnly} input @returns {AfterExampleReturnsOnly}\n * @implements AfterExampleBareOnly @augments AfterExampleAugmentsOnly\n */',
  ];
  const imports = [...unused, ...retained].map((name) => `import { Foo as ${name} } from './dep.js';`);
  const fixturePath = writeFixture(
    'jsdoc-example-lookalikes.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );
  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');
  for (const name of [...unused, ...retained]) {
    assert.equal(fixed.includes(`import { Foo as ${name} }`), retained.includes(name), name);
  }
});

test('distinguishes type-bearing JSDoc tags from prose and documentation tags', () => {
  const typeTags = words`arg argument augments const constant define enum exception extends implements member module
    namespace param prop property return returns satisfies template this throws type typedef var yield yields`;
  const proseTags = words`example external host deprecated description desc see link linkcode linklinkplain summary
    remarks author since version todo license default lends modifies callback overload class constructor private
    protected public custom-tag`;
  const tagged = [
    ...typeTags.map((tag) => [tag, `Type${tag}Only`, true]),
    ...proseTags.map((tag) => [tag, `Prose${tag.replaceAll('-', '')}Only`, false]),
  ];
  const misleading = ['throws', 'returns', 'typedef', 'template'].map((tag) => [tag, `Misleading${tag}Only`]);
  const literalTypes = [
    ['TemplateLiteralOnly', 'Record<`}`, TemplateLiteralOnly>'],
    ['OpeningBraceTemplateLiteralOnly', 'Record<`{`, OpeningBraceTemplateLiteralOnly>'],
    ['EscapedBacktickTemplateLiteralOnly', 'Record<`\\`}`, EscapedBacktickTemplateLiteralOnly>'],
    ['EscapedBackslashTemplateLiteralOnly', 'Record<`\\\\}`, EscapedBackslashTemplateLiteralOnly>'],
    ['InterpolatedTemplateLiteralOnly', 'Record<`${InterpolatedTemplateLiteralOnly}`, string>'],
    [
      'NestedTemplateLiteralOnly',
      'Record<`${string extends string ? `}` : `x`}`, NestedTemplateLiteralOnly>',
    ],
  ];
  const lineBoundaries = [
    ['UnicodeLineSeparatorOnly', '/**\u2028 * @type {UnicodeLineSeparatorOnly}\u2028 */'],
    ['UnicodeParagraphSeparatorOnly', '/**\u2029 * @implements UnicodeParagraphSeparatorOnly\u2029 */'],
  ];
  const lookalikes = [
    ['QuotedExampleOnly', '/** @example "@type {QuotedExampleOnly}" */'],
    ['BacktickedExampleOnly', '/** @example `@type {BacktickedExampleOnly}` */'],
    ['UnquotedExampleOnly', '/** @example @type {UnquotedExampleOnly} */'],
    ['SingleLineCommentedExampleOnly', '/** @example // @type {SingleLineCommentedExampleOnly} */'],
    ['ExampleOnly', '/**\n * @example\n * // @type {ExampleOnly}\n */'],
    ['MultilineUnquotedExampleOnly', '/**\n * @example\n * source @type {MultilineUnquotedExampleOnly}\n */'],
    ['QuotedDeprecatedOnly', '/** @deprecated "@type {QuotedDeprecatedOnly}" */'],
    ['EmailOnly', '/** Contact user@type {EmailOnly} */'],
    ['QuotedBareExampleOnly', '/** @example "@type QuotedBareExampleOnly" */'],
    ['UnquotedBareExampleOnly', '/** @example @implements UnquotedBareExampleOnly */'],
    ['MultilineBareExampleOnly', '/**\n * @example\n * // @implements MultilineBareExampleOnly\n */'],
    ['BacktickedBareExampleOnly', '/** @example `@implements BacktickedBareExampleOnly` */'],
    ['BareEmailOnly', '/** Contact user@type BareEmailOnly */'],
  ];
  const extra = [
    ['ExampleBeforeRealOnly', false],
    ['RealNestedTagOnly', true],
    ['RealNestedBareTagOnly', true],
  ];
  const entries = [
    ...tagged.map(([, name, retained]) => [name, retained]),
    ...misleading.map(([, name]) => [name, false]),
    ...literalTypes.map(([name]) => [name, true]),
    ...lineBoundaries.map(([name]) => [name, true]),
    ...lookalikes.map(([name]) => [name, false]),
    ...extra,
  ];
  const comments = [
    ...tagged.map(
      ([tag, name]) =>
        `/** @${tag} {${name}}${tag === 'module' || tag === 'namespace' ? ' DocumentedName' : ''} */`,
    ),
    ...misleading.map(([tag, name]) => `/** @${tag} description {${name}} */`),
    ...literalTypes.map(([, type]) => `/** @type {${type}} */`),
    ...lineBoundaries.map(([, comment]) => comment),
    ...lookalikes.map(([, comment]) => comment),
    '/**\n * @example\n * // @type {ExampleBeforeRealOnly}\n * @param {RealNestedTagOnly} value\n * @implements RealNestedBareTagOnly\n */',
  ];
  const imports = entries.map(([name]) => `import { Foo as ${name} } from './dep.js';`);
  const fixturePath = writeFixture(
    'jsdoc-tag-classification.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );
  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');
  for (const [name, retained] of entries)
    assert.equal(fixed.includes(`import { Foo as ${name} }`), retained, name);
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

test('fast-format lints TSX and JSX files incrementally', () => {
  const files = ['component.tsx', 'component.jsx'].map((name) =>
    writeFixture(name, `import { Foo } from './dep.js';\nexport const Component = () => <div />;\n`),
  );
  const list = writeFixture(
    'component-files.txt',
    `${files.map((file) => path.relative(repoRoot, file)).join(os.EOL)}${os.EOL}`,
  );
  run(fastFormat, [path.relative(repoRoot, list)]);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /import \{ Foo \}/);
});

test('fast-format accepts lists containing only ignored lint files', () => {
  const ignored = writeFixture('tmp.ts', `import { Foo } from './dep.js';\n`, ignoredFixtureRoot);
  const list = writeFixture('ignored-files.txt', `${path.relative(repoRoot, ignored)}${os.EOL}`);
  run(fastFormat, [path.relative(repoRoot, list)]);
});

test('preserves valid per-file classic JSX pragmas only for actual elements and fragments', () => {
  const h = '/** @jsx h */';
  const fragment = `${h}\n/** @jsxFrag Fragment */`;
  const cases = [
    ['pragma-element.jsx', h, '<div />', 'h !Unused'],
    ['pragma-same-line.jsx', h, 'const node = <div />;', 'h', 'inline'],
    ['pragma-plain-block.jsx', '/* @jsx h */', '<div />', 'h'],
    ['pragma-case-insensitive.jsx', '/** @JSX h */', '<div />', 'h'],
    ['pragma-fragment.jsx', fragment, '<>value</>', 'h Fragment !Unused'],
    ['pragma-without-fragment.jsx', fragment, '<div />', 'h !Fragment'],
    ['pragma-without-jsx.jsx', fragment, "export const node = '<div />';", '!h !Fragment'],
    ['pragma-member-root.jsx', '/** @jsx Renderer.createElement */', '<div />', 'Renderer !Unused'],
    [
      'pragma-fragment-member.jsx',
      '/** @jsx Renderer.createElement */\n/** @jsxFrag Fragments.Unit */',
      '<></>',
      'Renderer Fragments',
    ],
    ['pragma-same-line-sibling.jsx', '/** @jsx h @jsxFrag Fragment */', '<></>', 'h !Fragment'],
    [
      'pragma-multiline.jsx',
      '/**\n * @jsx Renderer.createElement\n * @jsxFrag Pieces.Fragment\n */',
      '<></>',
      'Renderer Pieces',
    ],
    ['pragma-line-comment.jsx', '// @jsx h', '<div />', '!h'],
    ['pragma-after-code.jsx', '', `${h}\nexport const node = <div />;`, '!h'],
    ['pragma-quoted-lookalike.jsx', '/** "@jsx h" */', '<div />', '!h'],
    ['pragma-backticked-lookalike.jsx', '/** `@jsx h` */', '<div />', '!h'],
    ['pragma-prose-lookalike.jsx', '/** @description @jsx h */', '<div />', '!h'],
    ['pragma-example-lookalike.jsx', '/** @example @jsx h */', '<div />', '!h'],
    ['pragma-multiline-example.jsx', '/**\n * @example\n * @jsx h\n */', '<div />', '!h'],
    ['pragma-shadowed.jsx', h, 'export function render(h) { return <div />; }', '!h'],
    [
      'pragma-shadowed-visible.jsx',
      h,
      'export function render(h) { return <div />; }\nexport const node = <div />;',
      'h',
    ],
    [
      'pragma-shadowed-fragment.jsx',
      fragment,
      'export function render(h, Fragment) { return <></>; }',
      '!h !Fragment',
    ],
    [
      'pragma-fragment-root-shadowed.jsx',
      fragment,
      'export function render(Fragment) { return <></>; }',
      'h !Fragment',
    ],
    ['pragma-unicode-root.jsx', '/** @jsx CaféRenderer.createElement */', '<div />', 'CaféRenderer'],
    ['pragma-escaped-root.jsx', '/** @jsx Caf\\u00e9Renderer.createElement */', '<div />', 'CaféRenderer'],
    ['pragma-escaped-alias.jsx', '/** @jsx CaféRenderer.createElement */', '<div />', 'Caf\\u00e9Renderer'],
    ['pragma-astral-root.jsx', '/** @jsx \\u{10400}Renderer.createElement */', '<div />', '𐐀Renderer'],
    [
      'pragma-identifier-prefix.jsx',
      '/** @jsx CaféRendererSuffix.createElement */',
      '<div />',
      '!CaféRenderer',
    ],
    ['pragma-invalid-factory.jsx', '/** @jsx Renderer.createElement() */', '<div />', '!Renderer'],
  ];
  runJSXCases('', undefined, cases);
});

test('preserves compiler-recognized JSX pragmas embedded in leading-comment prose', () => {
  const source = `/* prose @jsx h */\nimport { Foo as h, Foo as Unused } from './dep.js';\nexport const node = <div />;\n`;
  const emitted = ts.transpileModule(source, {
    fileName: 'compiler-pragma.jsx',
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext },
  }).outputText;
  assert.match(emitted, /h\("div", null\)/u, 'TypeScript recognizes the prose-prefixed @jsx pragma');
  const fixturePath = writeFixture('compiler-prose-pragma.jsx', source);
  runOxlintFix(fixturePath);
  assertJSXImportBindings(fixturePath, { h: true, Unused: false }, 'compiler-prose-pragma.jsx');
});

test('preserves configured classic JSX factory roots only where JSX requires them', () => {
  const directory = 'configured-classic-jsx';
  const configuration = writeJSXConfiguration(directory, {
    jsxRuntime: 'classic',
    jsxFactory: 'Factories.createElement',
    jsxFragmentFactory: 'Fragments.Unit',
  });
  runJSXCases(directory, configuration, [
    'element.tsx ::  :: <div /> :: Factories !Fragments !Unused',
    'fragment.tsx ::  :: <></> :: Factories Fragments !Unused',
    'without-jsx.tsx ::  :: export const node = "<div />"; :: !Factories !Fragments',
    'pragma-override.tsx :: /** @jsx Local.create */\n/** @jsxFrag Pieces.Fragment */ :: <></> :: !Factories !Fragments Local Pieces',
    'shadowed-factory.tsx ::  :: export function render(Factories) { return <div />; } :: !Factories !Fragments',
    'shadowed-visible.tsx ::  :: export function render(Factories) { return <div />; }\nexport const node = <div />; :: Factories !Fragments',
    'shadowed-fragment.tsx ::  :: export function render(Fragments) { return <></>; } :: Factories !Fragments',
    'block-shadowed.tsx ::  :: export function render() { const Factories = () => null; return <div />; } :: !Factories',
    'arrow-shadowed.tsx ::  :: export const render = (Factories) => <div />; :: !Factories',
    'var-hoisted.tsx ::  :: export function render() { const node = <div />; var Factories = () => null; return node; } :: !Factories',
    'class-method.tsx ::  :: export class View { render(Factories) { return <div />; } } :: !Factories',
    'nested-fragments.tsx ::  :: <><><div /></></> :: Factories Fragments',
    'shadowed-visible-fragment.tsx ::  :: export function render(Fragments) { return <></>; }\nexport const node = <></>; :: Factories Fragments',
    'default-react.tsx ::  :: <div /> :: !React :: React',
    'default-react-shadowed.tsx ::  :: export function render(React) { return <div />; } :: !React :: React',
    'explicit-react.tsx ::  :: export const node = <div />;\nconsole.log(React); :: React :: React',
  ]);
  const invalid = 'configured-invalid-classic-jsx';
  const invalidConfiguration = writeJSXConfiguration(invalid, {
    jsxRuntime: 'classic',
    jsxFactory: 'Factories.createElement()',
    jsxFragmentFactory: 'Fragments[Unit]',
  });
  runJSXCases(invalid, invalidConfiguration, ['invalid.tsx ::  :: <></> :: !Factories !Fragments']);
});

test('respects automatic JSX runtime and per-file runtime overrides', () => {
  const automatic = 'configured-automatic-jsx';
  const automaticConfiguration = writeJSXConfiguration(automatic, {
    jsxRuntime: 'automatic',
    jsxFactory: 'Factories.createElement',
    jsxFragmentFactory: 'Fragments.Unit',
  });
  runJSXCases(automatic, automaticConfiguration, [
    'element.tsx ::  :: <div /> :: !React !Factories !Fragments :: React',
    'fragment.tsx ::  :: <></> :: !React !Factories !Fragments :: React',
    'explicit.tsx ::  :: export const node = <div />;\nconsole.log(React); :: React !Factories :: React',
    'component.tsx ::  :: <React /> :: React :: React',
    'classic-override.tsx :: /** @jsxRuntime classic */\n/** @jsx Local.build */\n/** @jsxFrag Pieces.Fragment */ :: <></> :: !Factories !Fragments Local Pieces',
  ]);
  const classic = 'runtime-override-jsx';
  const classicConfiguration = writeJSXConfiguration(classic, {
    jsxRuntime: 'classic',
    jsxFactory: 'Factories.createElement',
    jsxFragmentFactory: 'Fragments.Unit',
  });
  runJSXCases(classic, classicConfiguration, [
    'automatic-pragma.tsx :: /** @jsxRuntime automatic */ :: <></> :: !React !Factories !Fragments :: React',
    'automatic-source.tsx :: /** @jsxImportSource custom-framework */ :: <div /> :: !React !Factories !Fragments :: React',
    'classic-override.tsx :: /** @jsxImportSource custom-framework */\n/** @jsxRuntime classic */ :: <></> :: Factories Fragments',
    'invalid-runtime.tsx :: /** @jsxRuntime unknown */ :: <div /> :: Factories',
  ]);
});
