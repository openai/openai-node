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

test('removes imports appearing only in JSDoc string literals and property names', () => {
  const cases = [
    {
      name: 'jsdoc-string-literal.js',
      comment: '/** @type {"Foo"} */',
    },
    {
      name: 'jsdoc-object-property-name.js',
      comment: '/** @type {{ Foo: string }} */',
    },
  ];

  for (const fixture of cases) {
    const source = `import { Foo } from './dep';\n${fixture.comment}\nconsole.log('done');\n`;
    const fixturePath = writeFixture(fixture.name, source);

    runOxlintFix(fixturePath);
    assert.equal(
      fs.readFileSync(fixturePath, 'utf8'),
      `\n${fixture.comment}\nconsole.log('done');\n`,
      fixture.name,
    );
  }
});

test('distinguishes JSDoc type references from literals, members, keys, and binders', () => {
  const cases = [
    { name: 'StringLiteralOnly', type: '"StringLiteralOnly"', used: false },
    { name: 'SingleQuotedLiteralOnly', type: "'SingleQuotedLiteralOnly'", used: false },
    { name: 'TemplateLiteralTextOnly', type: '`TemplateLiteralTextOnly`', used: false },
    { name: 'ObjectKeyOnly', type: '{ ObjectKeyOnly: string }', used: false },
    { name: 'QuotedObjectKeyOnly', type: '{ "QuotedObjectKeyOnly": string }', used: false },
    { name: 'SingleQuotedObjectKeyOnly', type: "{ 'SingleQuotedObjectKeyOnly': string }", used: false },
    { name: 'OptionalObjectKeyOnly', type: '{ OptionalObjectKeyOnly?: string }', used: false },
    { name: 'ReadonlyObjectKeyOnly', type: '{ readonly ReadonlyObjectKeyOnly: string }', used: false },
    { name: 'ObjectMethodNameOnly', type: '{ ObjectMethodNameOnly(value: string): number }', used: false },
    { name: 'QualifiedMemberOnly', type: 'Namespace.QualifiedMemberOnly', used: false },
    { name: 'TypeofMemberOnly', type: 'typeof Namespace.TypeofMemberOnly', used: false },
    { name: 'IndexedStringOnly', type: 'Container["IndexedStringOnly"]', used: false },
    { name: 'ParameterNameOnly', type: '(ParameterNameOnly: string) => void', used: false },
    { name: 'OptionalParameterOnly', type: '(OptionalParameterOnly?: string) => void', used: false },
    { name: 'RestParameterOnly', type: '(...RestParameterOnly: string[]) => void', used: false },
    { name: 'UntypedParameterOnly', type: '(UntypedParameterOnly) => string', used: false },
    { name: 'OptionalUntypedParameterOnly', type: '(OptionalUntypedParameterOnly?) => string', used: false },
    { name: 'RestUntypedParameterOnly', type: '(...RestUntypedParameterOnly) => string', used: false },
    { name: 'DefaultParameterOnly', type: '(DefaultParameterOnly = value) => string', used: false },
    {
      name: 'UntypedConstructorParameterOnly',
      type: 'new (UntypedConstructorParameterOnly) => string',
      used: false,
    },
    {
      name: 'UntypedMethodParameterOnly',
      type: '{ method(UntypedMethodParameterOnly): string }',
      used: false,
    },
    { name: 'UntypedCallParameterOnly', type: '{ (UntypedCallParameterOnly): string }', used: false },
    { name: 'DestructuredPropertyOnly', type: '({ DestructuredPropertyOnly }: Input) => void', used: false },
    { name: 'DestructuredAliasOnly', type: '({ value: DestructuredAliasOnly }: Input) => void', used: false },
    { name: 'DestructuredArrayOnly', type: '([DestructuredArrayOnly]: Input) => void', used: false },
    {
      name: 'ConstructorParameterOnly',
      type: 'new (ConstructorParameterOnly: string) => object',
      used: false,
    },
    { name: 'ClosureParameterOnly', type: 'function(ClosureParameterOnly: string): void', used: false },
    { name: 'TupleLabelOnly', type: '[TupleLabelOnly: string]', used: false },
    { name: 'OptionalTupleLabelOnly', type: '[OptionalTupleLabelOnly?: string]', used: false },
    { name: 'IndexSignatureNameOnly', type: '{ [IndexSignatureNameOnly: string]: number }', used: false },
    { name: 'MappedBinderOnly', type: '{ [MappedBinderOnly in keyof Shape]: string }', used: false },
    {
      name: 'MappedShadowOnly',
      type: '{ [MappedShadowOnly in keyof Shape]: MappedShadowOnly }',
      used: false,
    },
    {
      name: 'RemappedShadowOnly',
      type: '{ [RemappedShadowOnly in keyof Shape as `${RemappedShadowOnly}`]: string }',
      used: false,
    },
    {
      name: 'InferredBinderOnly',
      type: 'Source extends infer InferredBinderOnly ? string : never',
      used: false,
    },
    {
      name: 'InferredShadowOnly',
      type: 'Source extends infer InferredShadowOnly ? InferredShadowOnly : never',
      used: false,
    },
    {
      name: 'GenericBinderOnly',
      type: '<GenericBinderOnly extends Base>(value: GenericBinderOnly) => void',
      used: false,
    },
    { name: 'ObjectValueOnly', type: '{ value: ObjectValueOnly }', used: true },
    { name: 'QuotedPropertyValueOnly', type: '{ "label": QuotedPropertyValueOnly }', used: true },
    { name: 'SingleQuotedPropertyValueOnly', type: "{ 'label': SingleQuotedPropertyValueOnly }", used: true },
    { name: 'NumericPropertyValueOnly', type: '{ 0: NumericPropertyValueOnly }', used: true },
    { name: 'HexPropertyValueOnly', type: '{ 0x10: HexPropertyValueOnly }', used: true },
    { name: 'QualifiedNamespaceOnly', type: 'QualifiedNamespaceOnly.Member', used: true },
    { name: 'NestedNamespaceOnly', type: 'NestedNamespaceOnly.Member.Deep', used: true },
    { name: 'GenericValueOnly', type: 'Record<string, GenericValueOnly>', used: true },
    { name: 'UnionLeftOnly', type: 'UnionLeftOnly | string', used: true },
    { name: 'UnionRightOnly', type: 'string | UnionRightOnly', used: true },
    { name: 'IntersectionOnly', type: 'IntersectionOnly & Record<string, unknown>', used: true },
    { name: 'NullableOnly', type: '?NullableOnly', used: true },
    { name: 'NonNullableOnly', type: '!NonNullableOnly', used: true },
    { name: 'GroupedOnly', type: '(GroupedOnly | null)', used: true },
    { name: 'TupleFirstOnly', type: '[TupleFirstOnly, string]', used: true },
    { name: 'TupleSecondOnly', type: '[string, TupleSecondOnly?]', used: true },
    { name: 'ArrayElementOnly', type: 'ArrayElementOnly[]', used: true },
    { name: 'ReadonlyArrayOnly', type: 'readonly ReadonlyArrayOnly[]', used: true },
    { name: 'FunctionParameterTypeOnly', type: '(value: FunctionParameterTypeOnly) => void', used: true },
    { name: 'FunctionResultOnly', type: '(value: string) => FunctionResultOnly', used: true },
    {
      name: 'ConstructorParameterTypeOnly',
      type: 'new (value: ConstructorParameterTypeOnly) => object',
      used: true,
    },
    { name: 'ConstructorResultOnly', type: 'new (value: string) => ConstructorResultOnly', used: true },
    { name: 'ClosureThisOnly', type: 'function(this: ClosureThisOnly): void', used: true },
    { name: 'ClosureNewOnly', type: 'function(new: ClosureNewOnly): void', used: true },
    { name: 'ClosureValueOnly', type: 'function(value: ClosureValueOnly): void', used: true },
    {
      name: 'ClosureUnnamedParameterTypeOnly',
      type: 'function(ClosureUnnamedParameterTypeOnly): void',
      used: true,
    },
    { name: 'ClosureResultOnly', type: 'function(value: string): ClosureResultOnly', used: true },
    { name: 'MappedConstraintOnly', type: '{ [Key in keyof MappedConstraintOnly]: string }', used: true },
    { name: 'MappedValueOnly', type: '{ [Key in keyof Shape]: MappedValueOnly }', used: true },
    { name: 'IndexedContainerOnly', type: 'IndexedContainerOnly[string]', used: true },
    { name: 'IndexedAccessOnly', type: 'Container[IndexedAccessOnly]', used: true },
    { name: 'ComputedKeyOnly', type: '{ [ComputedKeyOnly]: string }', used: true },
    { name: 'KeyofValueOnly', type: 'keyof KeyofValueOnly', used: true },
    { name: 'TypeofRootOnly', type: 'typeof TypeofRootOnly.member', used: true },
    {
      name: 'ConditionalConditionOnly',
      type: 'ConditionalConditionOnly extends Base ? string : number',
      used: true,
    },
    {
      name: 'ConditionalConstraintOnly',
      type: 'Source extends ConditionalConstraintOnly ? string : number',
      used: true,
    },
    { name: 'ConditionalTrueOnly', type: 'Source extends Base ? ConditionalTrueOnly : string', used: true },
    { name: 'ConditionalFalseOnly', type: 'Source extends Base ? string : ConditionalFalseOnly', used: true },
    {
      name: 'InferConstraintOnly',
      type: 'Source extends infer Value extends InferConstraintOnly ? Value : never',
      used: true,
    },
    {
      name: 'GenericSiblingReferenceOnly',
      type: '{ first: <GenericSiblingReferenceOnly>(value: GenericSiblingReferenceOnly) => string; second: GenericSiblingReferenceOnly }',
      used: true,
    },
    {
      name: 'GenericMethodSiblingReferenceOnly',
      type: '{ method<GenericMethodSiblingReferenceOnly>(value: GenericMethodSiblingReferenceOnly): string; second: GenericMethodSiblingReferenceOnly }',
      used: true,
    },
    { name: 'TemplateInterpolationOnly', type: '`${TemplateInterpolationOnly}`', used: true },
    {
      name: 'NestedTemplateInterpolationOnly',
      type: '`${string extends string ? `${NestedTemplateInterpolationOnly}` : `x`}`',
      used: true,
    },
  ];
  const imports = cases.map(({ name }) => `import { Foo as ${name} } from './dep.js';`);
  const comments = cases.map(({ type }) => `/** @type {${type}} */`);
  const fixturePath = writeFixture(
    'jsdoc-structural-type-references.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const { name, used } of cases) {
    assert.equal(fixed.includes(`import { Foo as ${name} }`), used, name);
  }
});

test('preserves every reference in complete unbraced JSDoc type expressions', () => {
  const used = [
    'BareUnionLeftOnly',
    'BareUnionRightOnly',
    'BareNullableOnly',
    'BareNonNullableOnly',
    'BareGroupedOnly',
    'BareIntersectionLeftOnly',
    'BareIntersectionRightOnly',
    'BareTupleFirstOnly',
    'BareTupleSecondOnly',
    'BareArrayOnly',
    'BareKeyofOnly',
    'BareTypeofOnly',
    'BareFunctionParameterOnly',
    'BareFunctionResultOnly',
    'BareClosureParameterOnly',
    'BareClosureResultOnly',
    'BareConstructorParameterOnly',
    'BareConstructorResultOnly',
    'BareConditionalTrueOnly',
    'BareConditionalFalseOnly',
    'BareNestedGenericOnly',
    'BareAfterSiblingOnly',
  ];
  const imports = [
    ...used.map((name) => `import { Foo as ${name} } from './dep.js';`),
    `import { Foo as BareTrailingProseOnly } from './dep.js';`,
  ];
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
  const fixturePath = writeFixture(
    'jsdoc-complete-bare-types.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const name of used) {
    assert.ok(fixed.includes(`import { Foo as ${name} }`), name);
  }
  assert.ok(!fixed.includes('import { Foo as BareTrailingProseOnly }'));
});

test('preserves genuine JSDoc documentation links without counting labels or URLs', () => {
  const cases = [
    { name: 'SeeSymbolOnly', comment: '/** @see SeeSymbolOnly */', used: true },
    { name: 'SeeQualifiedOnly', comment: '/** @see SeeQualifiedOnly.member */', used: true },
    { name: 'SeeHashOnly', comment: '/** @see SeeHashOnly#member */', used: true },
    { name: 'SeeTildeOnly', comment: '/** @see SeeTildeOnly~member */', used: true },
    { name: 'SeeLabelOnly', comment: '/** @see SeeLabelOnly readable label */', used: true },
    { name: 'SeePipeOnly', comment: '/** @see SeePipeOnly|readable label */', used: true },
    { name: 'LienÉchappé', comment: '/** @see Lien\\u00c9chapp\\u00e9 */', used: true },
    { name: 'LinkSymbolOnly', comment: '/** @link LinkSymbolOnly */', used: true },
    { name: 'LinkCodeSymbolOnly', comment: '/** @linkcode LinkCodeSymbolOnly */', used: true },
    { name: 'LinkPlainSymbolOnly', comment: '/** @linkplain LinkPlainSymbolOnly */', used: true },
    { name: 'InlineSymbolOnly', comment: '/** Description {@link InlineSymbolOnly}. */', used: true },
    {
      name: 'InlineLabelOnly',
      comment: '/** Description {@link InlineLabelOnly readable label}. */',
      used: true,
    },
    {
      name: 'InlinePipeOnly',
      comment: '/** Description {@link InlinePipeOnly|readable label}. */',
      used: true,
    },
    {
      name: 'InlineQualifiedOnly',
      comment: '/** Description {@link InlineQualifiedOnly.member}. */',
      used: true,
    },
    { name: 'InlineHashOnly', comment: '/** Description {@link InlineHashOnly#member}. */', used: true },
    { name: 'InlineCodeOnly', comment: '/** Description {@linkcode InlineCodeOnly}. */', used: true },
    { name: 'InlinePlainOnly', comment: '/** Description {@linkplain InlinePlainOnly}. */', used: true },
    {
      name: 'InlineDeprecatedOnly',
      comment: '/** @deprecated Use {@link InlineDeprecatedOnly}. */',
      used: true,
    },
    { name: 'SiblingSeeOnly', comment: '/** @see SiblingSeeOnly details @returns {string} */', used: true },
    { name: 'SeeDisplayOnly', comment: '/** @see Other SeeDisplayOnly */', used: false },
    { name: 'SeeMemberOnly', comment: '/** @see Namespace.SeeMemberOnly */', used: false },
    { name: 'SeeEscapedPrefixOnly', comment: '/** @see SeeEscapedPrefixOnly\\u0042 */', used: false },
    { name: 'SeeUrlOnly', comment: '/** @see https://example.com/SeeUrlOnly */', used: false },
    { name: 'SeeMailOnly', comment: '/** @see mailto:SeeMailOnly */', used: false },
    { name: 'QuotedSeeOnly', comment: '/** @see "QuotedSeeOnly" */', used: false },
    { name: 'BracedSeeOnly', comment: '/** @see {BracedSeeOnly} */', used: false },
    { name: 'LinkDisplayOnly', comment: '/** @link Other LinkDisplayOnly */', used: false },
    { name: 'LinkUrlOnly', comment: '/** @link https://example.com/LinkUrlOnly */', used: false },
    {
      name: 'InlineDisplayOnly',
      comment: '/** Description {@link Other InlineDisplayOnly}. */',
      used: false,
    },
    {
      name: 'InlinePipeDisplayOnly',
      comment: '/** Description {@link Other|InlinePipeDisplayOnly}. */',
      used: false,
    },
    {
      name: 'InlineMemberOnly',
      comment: '/** Description {@link Namespace.InlineMemberOnly}. */',
      used: false,
    },
    {
      name: 'InlineUrlOnly',
      comment: '/** Description {@link https://example.com/InlineUrlOnly}. */',
      used: false,
    },
    { name: 'InlineModuleOnly', comment: '/** Description {@link module:InlineModuleOnly}. */', used: false },
    { name: 'ExampleInlineOnly', comment: '/** @example {@link ExampleInlineOnly} */', used: false },
    { name: 'ExampleBlockOnly', comment: '/** @example @see ExampleBlockOnly */', used: false },
    { name: 'QuotedInlineOnly', comment: '/** Description "{@link QuotedInlineOnly}". */', used: false },
    {
      name: 'BacktickedInlineOnly',
      comment: '/** Description `{@link BacktickedInlineOnly}`. */',
      used: false,
    },
    { name: 'EscapedInlineOnly', comment: '/** Description \\{@link EscapedInlineOnly}. */', used: false },
  ];
  const imports = cases.map(({ name }) => `import { Foo as ${name} } from './dep.js';`);
  const comments = cases.map(({ comment }) => comment);
  const fixturePath = writeFixture(
    'jsdoc-documentation-links.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const { name, used } of cases) {
    assert.equal(fixed.includes(`import { Foo as ${name} }`), used, name);
  }
});

test('recognizes complete Unicode JSDoc identifiers without matching identifier prefixes', () => {
  const cases = [
    { name: 'Café', type: 'CaféÉ', used: false },
    { name: 'CaféExact', type: 'CaféExact', used: true },
    { name: 'Éclair', type: 'Namespace.Éclair', used: false },
    { name: 'Δelta', type: '{ Δelta: string }', used: false },
    { name: '变量', type: '{ value: 变量 }', used: true },
    { name: 'Cafe\u0301', type: 'Cafe\u0301Suffix', used: false },
    { name: 'Exact\u0301', type: 'Exact\u0301', used: true },
    { name: '𐐀stral', type: '𐐀stralSuffix', used: false },
    { name: '𐐁xact', type: '𐐁xact', used: true },
    { name: 'CaféEscaped', type: 'Caf\\u00e9Escaped', used: true },
    { name: 'ÉscapedStart', type: '\\u00c9scapedStart', used: true },
    { name: '𐐀EscapedAstral', type: '\\u{10400}EscapedAstral', used: true },
    { name: 'Combining\u0301Escaped', type: 'Combining\\u0301Escaped', used: true },
    { name: 'FooEscapedPrefix', type: 'FooEscapedPrefix\\u0042', used: false },
    { name: 'FooEscapedJoiner', type: 'FooEscapedJoiner\\u200cBar', used: false },
  ];
  const imports = cases.map(({ name }) => `import { Foo as ${name} } from './dep.js';`);
  const comments = cases.map(({ type }) => `/** @type {${type}} */`);
  const fixturePath = writeFixture(
    'jsdoc-unicode-type-identifiers.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const { name, used } of cases) {
    assert.equal(fixed.includes(`import { Foo as ${name} }`), used, name);
  }
});

test('preserves every genuine type reference in same-line sibling JSDoc tags', () => {
  const usedImports = [
    'Foo',
    'Bar',
    'NamedFirstArgOnly',
    'ArgumentAliasOnly',
    'ReturnAliasOnly',
    'ExceptionAliasOnly',
    'YieldAliasOnly',
    'YieldsAliasOnly',
    'PropertyAliasOnly',
    'NameFirstPropertyOnly',
    'ThrowsAliasOnly',
    'SatisfiesAliasOnly',
    'BareImplementsOnly',
    'BareAugmentsOnly',
    'BareExtendsOnly',
    'BareTypeOnly',
    'BareThisOnly',
    'BareEnumOnly',
    'TypedefAliasOnly',
    'TemplateAliasOnly',
    'ConstAliasOnly',
    'ConstantAliasOnly',
    'DefineAliasOnly',
    'VarAliasOnly',
    'MemberAliasOnly',
    'ModuleAliasOnly',
    'NamespaceAliasOnly',
    'NamedFirstParamOnly',
    'NamedFirstPropOnly',
    'NamedFirstArgumentOnly',
    'UntypedTemplateParamOnly',
    'UntypedTemplateReturnsOnly',
    'BareNestedSiblingOnly',
    'AfterBareGenericOnly',
    'ArrowBareGenericOnly',
    'AfterArrowBareGenericOnly',
    'NonBreakingSpaceParamOnly',
    'NonBreakingSpaceReturnsOnly',
    'NestedArrowInputOnly',
    'NestedArrowResultOnly',
    'NestedArrowMemberOnly',
    'AfterNestedArrowOnly',
    'EmSpaceParamOnly',
    'EmSpaceReturnsOnly',
  ];
  const unusedImport = `import { Foo as UnusedInlineOnly } from './dep.js';`;
  const imports = [
    ...usedImports.map((name) =>
      name === 'Foo' ? `import { Foo } from './dep.js';` : `import { Foo as ${name} } from './dep.js';`,
    ),
    unusedImport,
  ];
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
  const fixturePath = writeFixture(
    'jsdoc-same-line-sibling-tags.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  const before = fs.readFileSync(fixturePath, 'utf8');
  runOxlintFix(fixturePath);
  assert.equal(fs.readFileSync(fixturePath, 'utf8'), before.replace(unusedImport, ''));
});

test('ignores example and prose lookalikes while preserving later genuine sibling tags', () => {
  const exampleAndProseOnly = [
    'UnquotedInlineExampleOnly',
    'UnquotedEmbeddedExampleOnly',
    'QuotedInlineExampleOnly',
    'QuotedEmbeddedExampleOnly',
    'BacktickedInlineExampleOnly',
    'BacktickedEmbeddedExampleOnly',
    'NestedQuotedExampleOnly',
    'NestedBacktickedExampleOnly',
    'SingleLineCommentExampleOnly',
    'SingleLineBareExampleOnly',
    'UnquotedBareExampleOnly',
    'UnquotedBareEmbeddedExampleOnly',
    'DeprecatedQuotedOnly',
    'DeprecatedBacktickedOnly',
    'DeprecatedBracedOnly',
    'InterleavedDeprecatedBracedOnly',
    'ExternalNestedFakeOnly',
    'DeprecatedQuotedSiblingFakeOnly',
    'InterpolatedBacktickProseFakeOnly',
    'EmailProseOnly',
    'QuotedAfterRealOnly',
    'BacktickedAfterRealOnly',
    'EmailAfterRealOnly',
    'AfterRealExampleOnly',
    'AfterRealEmbeddedExampleOnly',
    'InlineExampleBeforeRecoveryOnly',
    'MultilineCommentExampleOnly',
    'MultilineCommentEmbeddedOnly',
    'MultilineSourceBareExampleOnly',
    'MultilineQuotedExampleOnly',
    'UnusedExampleControlOnly',
  ];
  const genuineTypes = [
    'RealBeforeProseOnly',
    'RealAfterProseOnly',
    'RealBeforeExampleOnly',
    'AfterDeprecatedOnly',
    'BeforeDeprecatedOnly',
    'AfterInterleavedDeprecatedOnly',
    'AfterExternalOnly',
    'AfterQuotedDeprecatedOnly',
    'BeforeInterpolatedBacktickOnly',
    'AfterInterpolatedBacktickOnly',
    'AfterExampleParamOnly',
    'AfterExampleReturnsOnly',
    'AfterExampleBareOnly',
    'AfterExampleAugmentsOnly',
  ];
  const imports = [...exampleAndProseOnly, ...genuineTypes].map(
    (name) => `import { Foo as ${name} } from './dep.js';`,
  );
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
  const fixturePath = writeFixture(
    'jsdoc-inline-example-lookalikes.js',
    `${imports.join('\n')}\n${comments.join('\n')}\nconsole.log('done');\n`,
  );

  runOxlintFix(fixturePath);
  const fixed = fs.readFileSync(fixturePath, 'utf8');

  for (const name of exampleAndProseOnly) {
    assert.ok(!fixed.includes(`import { Foo as ${name} }`), name);
  }
  for (const name of genuineTypes) {
    assert.ok(fixed.includes(`import { Foo as ${name} }`), name);
  }
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
    'external',
    'host',
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
    'lends',
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
  const templateLiteralTypes = [
    { name: 'TemplateLiteralOnly', type: 'Record<`}`, TemplateLiteralOnly>' },
    { name: 'OpeningBraceTemplateLiteralOnly', type: 'Record<`{`, OpeningBraceTemplateLiteralOnly>' },
    {
      name: 'EscapedBacktickTemplateLiteralOnly',
      type: 'Record<`\\`}`, EscapedBacktickTemplateLiteralOnly>',
    },
    {
      name: 'EscapedBackslashTemplateLiteralOnly',
      type: 'Record<`\\\\}`, EscapedBackslashTemplateLiteralOnly>',
    },
    {
      name: 'InterpolatedTemplateLiteralOnly',
      type: 'Record<`${InterpolatedTemplateLiteralOnly}`, string>',
    },
    {
      name: 'NestedTemplateLiteralOnly',
      type: 'Record<`${string extends string ? `}` : `x`}`, NestedTemplateLiteralOnly>',
    },
  ];
  const unicodeLineBoundaryTypes = [
    { name: 'UnicodeLineSeparatorOnly', comment: '/**\u2028 * @type {UnicodeLineSeparatorOnly}\u2028 */' },
    {
      name: 'UnicodeParagraphSeparatorOnly',
      comment: '/**\u2029 * @implements UnicodeParagraphSeparatorOnly\u2029 */',
    },
  ];
  const embeddedTypeTags = [
    { name: 'QuotedExampleOnly', comment: '/** @example "@type {QuotedExampleOnly}" */' },
    { name: 'BacktickedExampleOnly', comment: '/** @example `@type {BacktickedExampleOnly}` */' },
    { name: 'UnquotedExampleOnly', comment: '/** @example @type {UnquotedExampleOnly} */' },
    {
      name: 'SingleLineCommentedExampleOnly',
      comment: '/** @example // @type {SingleLineCommentedExampleOnly} */',
    },
    { name: 'ExampleOnly', comment: '/**\n * @example\n * // @type {ExampleOnly}\n */' },
    {
      name: 'MultilineUnquotedExampleOnly',
      comment: '/**\n * @example\n * source @type {MultilineUnquotedExampleOnly}\n */',
    },
    { name: 'QuotedDeprecatedOnly', comment: '/** @deprecated "@type {QuotedDeprecatedOnly}" */' },
    { name: 'EmailOnly', comment: '/** Contact user@type {EmailOnly} */' },
    { name: 'QuotedBareExampleOnly', comment: '/** @example "@type QuotedBareExampleOnly" */' },
    { name: 'UnquotedBareExampleOnly', comment: '/** @example @implements UnquotedBareExampleOnly */' },
    {
      name: 'MultilineBareExampleOnly',
      comment: '/**\n * @example\n * // @implements MultilineBareExampleOnly\n */',
    },
    {
      name: 'BacktickedBareExampleOnly',
      comment: '/** @example `@implements BacktickedBareExampleOnly` */',
    },
    { name: 'BareEmailOnly', comment: '/** Contact user@type BareEmailOnly */' },
  ];
  const imports = [
    ...tags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...misleadingTags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...templateLiteralTypes.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...unicodeLineBoundaryTypes.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    ...embeddedTypeTags.map(({ name }) => `import { Foo as ${name} } from './dep.js';`),
    `import { Foo as ExampleBeforeRealOnly } from './dep.js';`,
    `import { Foo as RealNestedTagOnly } from './dep.js';`,
    `import { Foo as RealNestedBareTagOnly } from './dep.js';`,
  ];
  const comments = [
    ...tags.map(
      ({ tag, name }) =>
        `/** @${tag} {${name}}${tag === 'module' || tag === 'namespace' ? ' DocumentedName' : ''} */`,
    ),
    ...misleadingTags.map(({ tag, name }) => `/** @${tag} description {${name}} */`),
    ...templateLiteralTypes.map(({ type }) => `/** @type {${type}} */`),
    ...unicodeLineBoundaryTypes.map(({ comment }) => comment),
    ...embeddedTypeTags.map(({ comment }) => comment),
    `/**\n * @example\n * // @type {ExampleBeforeRealOnly}\n * @param {RealNestedTagOnly} value\n * @implements RealNestedBareTagOnly\n */`,
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
  for (const { name } of templateLiteralTypes) {
    assert.ok(fixed.includes(`import { Foo as ${name} }`), name);
  }
  for (const { name } of unicodeLineBoundaryTypes) {
    assert.ok(fixed.includes(`import { Foo as ${name} }`), name);
  }
  for (const { name } of embeddedTypeTags) {
    assert.ok(!fixed.includes(`import { Foo as ${name} }`), name);
  }
  assert.ok(!fixed.includes(`import { Foo as ExampleBeforeRealOnly }`));
  assert.ok(fixed.includes(`import { Foo as RealNestedTagOnly }`));
  assert.ok(fixed.includes(`import { Foo as RealNestedBareTagOnly }`));
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
