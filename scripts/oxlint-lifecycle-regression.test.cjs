const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('./oxlint-plugin.cjs');
const jsdocSymbols = require('./oxlint-jsdoc-symbols.cjs');

function createContext(documentedType = 'string', withImports = true) {
  const imports = withImports ? "import { Foo, Bar } from './dep.js';\n" : '';
  const text = `${imports}/** @type {${documentedType}} */\nconst documented = null;\n`;
  const start = text.indexOf('/**');
  const end = text.indexOf('*/', start) + 2;
  const comment = { type: 'Block', value: text.slice(start + 2, end - 2), range: [start, end] };
  const ast = { type: 'Program', range: [0, text.length] };
  const variables = new Map();
  const scope = { block: ast, set: variables, upper: null };
  let jsxAnalyses = 0;
  const ecmaFeatures = {};
  Object.defineProperty(ecmaFeatures, 'jsx', {
    get() {
      jsxAnalyses++;
      return false;
    },
  });
  const diagnostics = [];
  const sourceCode = {
    ast,
    text,
    visitorKeys: { Program: [] },
    getAllComments: () => [comment],
    getTokenAfter: () => ({ range: [end + 1, end + 2] }),
    getNodeByRangeIndex: () => ast,
    getScope: () => scope,
    getDeclaredVariables: (declaration) => declaration.variables,
  };
  const context = {
    filename: 'oxlint-lifecycle.ts',
    languageOptions: { parserOptions: { ecmaFeatures } },
    options: [],
    report: (diagnostic) => diagnostics.push(diagnostic),
    sourceCode,
  };

  function declaration(name, kind = 'import', runtimeUsed = false) {
    const identifier = { name };
    const variable = {
      name,
      identifiers: [identifier],
      references: runtimeUsed ? [{ identifier: { name } }] : [],
      defs: [{ type: 'ImportBinding' }],
    };
    variables.set(name, variable);
    if (kind === 'equals') return { variables: [variable], parent: { type: 'Program' } };
    return { variables: [variable], specifiers: [{ type: 'ImportSpecifier', local: identifier }] };
  }

  return {
    context,
    declaration,
    diagnostics,
    getJSXAnalyses: () => jsxAnalyses,
    visitors: plugin.rules['no-unused-imports'].create(context),
  };
}

function withSymbolAnalysisSpy(callback) {
  const original = jsdocSymbols.getJSDocNamespaceInfo;
  let analyses = 0;
  jsdocSymbols.getJSDocNamespaceInfo = (sourceFile) => {
    analyses++;
    return original(sourceFile);
  };
  try {
    callback(() => analyses);
  } finally {
    jsdocSymbols.getJSDocNamespaceInfo = original;
  }
}

test('defers JSX and JSDoc analysis until an import binding may be unused', () => {
  withSymbolAnalysisSpy((getAnalyses) => {
    const withoutImports = createContext('string', false);
    assert.equal(getAnalyses(), 0, 'creating a rule visitor does not analyze JSDoc');
    assert.equal(withoutImports.getJSXAnalyses(), 0, 'creating a rule visitor does not inspect JSX');

    const used = createContext();
    used.visitors.ImportDeclaration(used.declaration('Foo', 'import', true));
    used.visitors.TSImportEqualsDeclaration(used.declaration('Bar', 'equals', true));
    assert.equal(getAnalyses(), 0, 'runtime-used imports do not analyze JSDoc');
    assert.equal(used.getJSXAnalyses(), 0, 'runtime-used imports do not inspect JSX');
    assert.equal(used.diagnostics.length, 0, 'runtime-used imports produce no diagnostics');
  });
});

test('memoizes JSX and JSDoc import analysis across both import visitor kinds', () => {
  withSymbolAnalysisSpy((getAnalyses) => {
    const state = createContext();
    state.visitors.ImportDeclaration(state.declaration('Foo'));
    state.visitors.ImportDeclaration(state.declaration('Bar'));
    state.visitors.TSImportEqualsDeclaration(state.declaration('Baz', 'equals'));
    assert.equal(getAnalyses(), 1, 'one JSDoc analysis is shared across every import declaration');
    assert.equal(state.getJSXAnalyses(), 1, 'one JSX analysis is shared across every import declaration');
    assert.equal(state.diagnostics.length, 3, 'all genuinely unused imports are still reported');
  });
});

test('isolates lazy import-usage caches between separate source-file contexts', () => {
  withSymbolAnalysisSpy((getAnalyses) => {
    const retained = createContext('Foo');
    retained.visitors.ImportDeclaration(retained.declaration('Foo'));
    assert.equal(retained.diagnostics.length, 0, 'the first file retains its genuine JSDoc import');

    const unused = createContext('Bar');
    unused.visitors.ImportDeclaration(unused.declaration('Foo'));
    assert.equal(unused.diagnostics.length, 1, 'the second file does not reuse stale import usage');
    assert.equal(getAnalyses(), 2, 'each source-file context performs its own JSDoc analysis');
    assert.equal(retained.getJSXAnalyses(), 1, 'the first context memoizes its JSX scan');
    assert.equal(unused.getJSXAnalyses(), 1, 'the second context independently scans JSX');
  });
});
