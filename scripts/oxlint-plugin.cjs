/** Import-only unused-binding checks for Oxlint, backed by TypeScript's compiler parser. */

const ts = require('typescript');
const jsdoc = require('./oxlint-jsdoc.cjs');

function getJSXFactoryRoot(expression) {
  if (typeof expression !== 'string') return;
  return jsdoc.getEntityRoot(ts.parseIsolatedEntityName(expression, ts.ScriptTarget.Latest));
}

function getJSXPragma(sourceFile, name, useLast = false) {
  const pragma = sourceFile.pragmas.get(name);
  const selected = Array.isArray(pragma) ? pragma[useLast ? pragma.length - 1 : 0] : pragma;
  return selected?.arguments.factory;
}

function getJSXRootBinding(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable;
  }
}

function getJSXImportUsage(context) {
  if (!context.languageOptions.parserOptions.ecmaFeatures.jsx) return new Set();

  const sourceCode = context.sourceCode;
  const nodes = [sourceCode.ast];
  const jsxNodes = [];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (!node) continue;
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') jsxNodes.push(node);
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) nodes.push(...child);
      else if (child) nodes.push(child);
    }
  }
  if (jsxNodes.length === 0) return new Set();

  const compilerSource = ts.createSourceFile(
    'oxlint-jsx.tsx',
    sourceCode.text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    false,
    ts.ScriptKind.TSX,
  );
  const options = context.options[0] ?? {};
  const runtimeOverride = getJSXPragma(compilerSource, 'jsxruntime', true);
  let runtime = options.jsxRuntime ?? 'classic';
  if (getJSXPragma(compilerSource, 'jsximportsource', true)) runtime = 'automatic';
  if (runtimeOverride === 'classic' || runtimeOverride === 'automatic') runtime = runtimeOverride;
  if (runtime !== 'classic') return new Set();

  const factory =
    getJSXFactoryRoot(getJSXPragma(compilerSource, 'jsx')) ??
    getJSXFactoryRoot(options.jsxFactory ?? 'React.createElement');
  const fragment =
    getJSXFactoryRoot(getJSXPragma(compilerSource, 'jsxfrag')) ??
    getJSXFactoryRoot(options.jsxFragmentFactory ?? 'React.Fragment');
  const used = new Set();

  for (const node of jsxNodes) {
    if (factory) {
      const binding = getJSXRootBinding(sourceCode, node, factory);
      if (binding) used.add(binding);
    }
    if (fragment && node.type === 'JSXFragment') {
      const binding = getJSXRootBinding(sourceCode, node, fragment);
      if (binding) used.add(binding);
    }
  }

  return used;
}

function hasCommentInRange(comments, start, end) {
  return comments.some((comment) => comment.range[0] < end && comment.range[1] > start);
}

function hasUnsafeRemovalComments(sourceCode, specifier, comma) {
  const comments = sourceCode.getAllComments();
  const removalStart = Math.min(specifier.range[0], comma.range[0]);
  const removalEnd = Math.max(specifier.range[1], comma.range[1]);
  if (hasCommentInRange(comments, removalStart, removalEnd)) return true;

  if (comma.range[0] < specifier.range[0]) {
    const nextToken = sourceCode.getTokenAfter(specifier);
    if (nextToken && hasCommentInRange(comments, specifier.range[1], nextToken.range[0])) {
      return true;
    }
  }

  return false;
}

function fixCommentedUnusedImports(sourceCode, declaration, unusedSpecifiers, retainedSpecifiers, fixer) {
  if (retainedSpecifiers.length === 0) return null;

  const retainedNamedSpecifiers = retainedSpecifiers.filter(
    (specifier) => specifier.type === 'ImportSpecifier',
  );
  if (
    retainedNamedSpecifiers.length === 0 &&
    unusedSpecifiers.some((specifier) => specifier.type === 'ImportSpecifier')
  ) {
    return null;
  }

  const fixes = [];
  for (const specifier of unusedSpecifiers) {
    if (sourceCode.getCommentsInside(specifier).length > 0) return null;

    let comma;
    if (specifier.type === 'ImportDefaultSpecifier') {
      comma = sourceCode.getTokenAfter(specifier);
    } else if (specifier.type === 'ImportNamespaceSpecifier') {
      comma = sourceCode.getTokenBefore(specifier);
    } else if (specifier.type === 'ImportSpecifier') {
      const retainedPrecedes = retainedNamedSpecifiers.some(
        (retained) => retained.range[0] < specifier.range[0],
      );
      comma = retainedPrecedes ? sourceCode.getTokenBefore(specifier) : sourceCode.getTokenAfter(specifier);
    }

    if (comma?.value !== ',' || hasUnsafeRemovalComments(sourceCode, specifier, comma)) return null;
    fixes.push(fixer.remove(specifier), fixer.remove(comma));
  }

  return fixes;
}

function fixUnusedImports(sourceCode, declaration, unusedSpecifiers, fixer) {
  const unused = new Set(unusedSpecifiers);
  const retainedSpecifiers = declaration.specifiers.filter((specifier) => !unused.has(specifier));
  if (sourceCode.getCommentsInside(declaration).length > 0) {
    return fixCommentedUnusedImports(sourceCode, declaration, unusedSpecifiers, retainedSpecifiers, fixer);
  }
  if (retainedSpecifiers.length === 0) return fixer.remove(declaration);

  const defaultSpecifier = retainedSpecifiers.find(
    (specifier) => specifier.type === 'ImportDefaultSpecifier',
  );
  const namespaceSpecifier = retainedSpecifiers.find(
    (specifier) => specifier.type === 'ImportNamespaceSpecifier',
  );
  const namedSpecifiers = retainedSpecifiers.filter((specifier) => specifier.type === 'ImportSpecifier');
  const bindings = [];
  if (defaultSpecifier) bindings.push(sourceCode.getText(defaultSpecifier));
  if (namespaceSpecifier) {
    bindings.push(sourceCode.getText(namespaceSpecifier));
  } else if (namedSpecifiers.length > 0) {
    bindings.push(`{ ${namedSpecifiers.map((specifier) => sourceCode.getText(specifier)).join(', ')} }`);
  }

  const importToken = sourceCode.getFirstToken(declaration);
  const fromToken = sourceCode.getTokenBefore(declaration.source);
  let bindingStart = importToken ? sourceCode.getTokenAfter(importToken) : undefined;
  if (declaration.importKind === 'type' && bindingStart?.value === 'type') {
    bindingStart = sourceCode.getTokenAfter(bindingStart);
  }
  if (!bindingStart || fromToken?.value !== 'from') return null;

  return fixer.replaceTextRange([bindingStart.range[0], fromToken.range[0]], `${bindings.join(', ')} `);
}

const noUnusedImports = {
  meta: {
    type: 'problem',
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          jsxRuntime: { enum: ['classic', 'automatic'] },
          jsxFactory: { type: 'string' },
          jsxFragmentFactory: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: { unused: 'Imported bindings {{names}} are never used.' },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    let jsxUsedImports;
    let jsDocUsedImports;

    function isUsedByJSXOrJSDoc(variable) {
      jsxUsedImports ??= getJSXImportUsage(context);
      if (jsxUsedImports.has(variable)) return true;
      jsDocUsedImports ??= jsdoc.getJSDocImportUsage(context);
      return jsDocUsedImports.has(variable);
    }

    return {
      ImportDeclaration(declaration) {
        const unusedSpecifiers = [];
        for (const variable of sourceCode.getDeclaredVariables(declaration)) {
          if (
            variable.references.some((reference) => reference.identifier !== variable.identifiers[0]) ||
            isUsedByJSXOrJSDoc(variable)
          ) {
            continue;
          }

          const specifier = declaration.specifiers.find(
            (candidate) => candidate.local.name === variable.name,
          );
          if (specifier) unusedSpecifiers.push(specifier);
        }

        if (unusedSpecifiers.length > 0) {
          context.report({
            node: declaration,
            messageId: 'unused',
            data: { names: unusedSpecifiers.map((specifier) => `'${specifier.local.name}'`).join(', ') },
            fix: (fixer) => fixUnusedImports(sourceCode, declaration, unusedSpecifiers, fixer),
          });
        }
      },
      TSImportEqualsDeclaration(declaration) {
        if (declaration.parent?.type === 'ExportNamedDeclaration') return;

        const [variable] = sourceCode.getDeclaredVariables(declaration);
        if (
          !variable ||
          variable.references.some((reference) => reference.identifier !== variable.identifiers[0]) ||
          isUsedByJSXOrJSDoc(variable)
        ) {
          return;
        }

        context.report({
          node: declaration,
          messageId: 'unused',
          data: { names: `'${variable.name}'` },
          fix: (fixer) =>
            sourceCode.getCommentsInside(declaration).length > 0 ? null : fixer.remove(declaration),
        });
      },
    };
  },
};

module.exports = { meta: { name: 'sdk' }, rules: { 'no-unused-imports': noUnusedImports } };
