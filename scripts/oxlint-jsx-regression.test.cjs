const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const {
  assertJSXImportBindings,
  fastFormat,
  ignoredFixtureRoot,
  repoRoot,
  run,
  runJSXCases,
  runOxlintFix,
  writeFixture,
  writeJSXConfiguration,
} = require('./oxlint-regression.test.cjs');

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
