const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after } = require('node:test');
const ts = require('typescript');

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
  if (command === oxlint) args.unshift('--allow=all', '--deny=sdk/no-unused-imports');
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${path.basename(command)} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runOutput(command, args) {
  return run(command, args).stdout.trim();
}

function runOxlintFix(fixturePath, configurationPath) {
  const config = configurationPath ? ['--config', path.relative(repoRoot, configurationPath)] : [];
  run(oxlint, ['--fix', '--no-ignore', ...config, path.relative(repoRoot, fixturePath)]);
}

function fix(fixturePath) {
  runOxlintFix(fixturePath);
  return fs.readFileSync(fixturePath, 'utf8');
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

function findDocumentedNode(program, fixturePath, predicate) {
  let documented;
  function visit(node) {
    if (node.jsDoc?.some((comment) => comment.tags?.some(predicate))) documented ??= node;
    ts.forEachChild(node, visit);
  }
  visit(program.getSourceFile(fixturePath));
  return documented;
}

function findJSDocLink(program, fixturePath, name) {
  let link;
  function visitComment(node) {
    if (ts.isJSDocLinkLike(node) && node.name?.escapedText === name) link ??= node;
    ts.forEachChild(node, visitComment);
  }
  function visit(node) {
    for (const comment of node.jsDoc ?? []) visitComment(comment);
    ts.forEachChild(node, visit);
  }
  visit(program.getSourceFile(fixturePath));
  return link;
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
  return { output, stdout: runOutput(process.execPath, [outputPath]) };
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
  const { extends: _presets, rules, ...configuration } = require(path.join(repoRoot, 'oxlint.config.ts'));
  configuration.rules = { ...rules, 'sdk/no-unused-imports': ['error', jsxOptions] };
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
writeFixture('parameter-side-effect.mjs', 'globalThis.parameterImportRan = true; export class Foo {}\n');
writeFixture('parameter-types.mjs', 'export class Bar {}\nexport class Ref {}\n');
writeFixture(
  'external-side-effect.cjs',
  'globalThis.externalImportRan = true; module.exports = { value: 1 };\n',
);
writeFixture('external-retained.cjs', 'module.exports = { value: 42 };\n');

module.exports = {
  assertJSDocCases,
  assertJSXImportBindings,
  assertNoMissingJSDocTypes,
  assertNoMissingTypes,
  fastFormat,
  findDocumentedNode,
  findJSDocLink,
  fix,
  ignoredFixtureRoot,
  oxlint,
  repoRoot,
  run,
  runJSXCases,
  runOutput,
  runOxlintFix,
  runTypeScriptOutput,
  words,
  writeFixture,
  writeJSXConfiguration,
};
