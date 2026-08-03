/** Import-only unused-binding checks for Oxlint, without ESLint dependencies. */

const JSDOC_TYPE_BEARING_TAGS = new Set([
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
]);
const JSDOC_NAMED_TYPE_TAGS = new Set(['arg', 'argument', 'param', 'prop', 'property']);
const JSDOC_BRACED_TYPE_TAG =
  /(?:^|[\r\n\u2028\u2029])[\t ]*\*?[\t ]*@([A-Za-z][\w-]*)(?:(?:\s|\*(?=\s))+([^\s{}*@]+))?(?:\s|\*(?=\s))*\{/g;
const JSDOC_BARE_TYPE_TAG =
  /(?:^|[\r\n\u2028\u2029])[\t ]*\*?[\t ]*@(?:implements|augments|extends|type|this|enum)(?:\s|\*(?=\s))+(?!\{)([A-Za-z_$][\w$.]*(?:\s*<[^\r\n]*>)?)/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* getJSDocTypeExpressions(comment) {
  for (const match of comment.matchAll(JSDOC_BRACED_TYPE_TAG)) {
    if (!JSDOC_TYPE_BEARING_TAGS.has(match[1]) || (match[2] && !JSDOC_NAMED_TYPE_TAGS.has(match[1]))) {
      continue;
    }

    const start = match.index + match[0].length;
    let depth = 1;
    let quote;
    const templateInterpolationDepths = [];

    for (let end = start; end < comment.length; end++) {
      const character = comment[end];
      if (quote) {
        if (character === '\\') {
          end++;
        } else if (quote === '`' && character === '$' && comment[end + 1] === '{') {
          templateInterpolationDepths.push(depth++);
          quote = undefined;
          end++;
        } else if (character === quote) {
          quote = undefined;
        }
        continue;
      }

      if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth++;
      } else if (character === '}') {
        if (--depth === 0) {
          yield comment.slice(start, end);
          break;
        }
        if (templateInterpolationDepths.at(-1) === depth) {
          templateInterpolationDepths.pop();
          quote = '`';
        }
      }
    }
  }

  for (const match of comment.matchAll(JSDOC_BARE_TYPE_TAG)) {
    yield match[1];
  }
}

function isUsedThroughJSDoc(sourceCode, name) {
  const identifier = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}(?=$|[^A-Za-z0-9_$])`);

  return sourceCode.getAllComments().some((comment) => {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
      return false;
    }

    return Array.from(getJSDocTypeExpressions(comment.value)).some((typeExpression) =>
      identifier.test(typeExpression),
    );
  });
}

function fixCommentedUnusedImports(sourceCode, declaration, unusedSpecifiers, retainedSpecifiers, fixer) {
  if (retainedSpecifiers.length === 0) {
    return null;
  }

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
    if (sourceCode.getCommentsInside(specifier).length > 0) {
      return null;
    }

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

    if (comma?.value !== ',') {
      return null;
    }

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

  if (retainedSpecifiers.length === 0) {
    return fixer.remove(declaration);
  }

  const defaultSpecifier = retainedSpecifiers.find(
    (specifier) => specifier.type === 'ImportDefaultSpecifier',
  );
  const namespaceSpecifier = retainedSpecifiers.find(
    (specifier) => specifier.type === 'ImportNamespaceSpecifier',
  );
  const namedSpecifiers = retainedSpecifiers.filter((specifier) => specifier.type === 'ImportSpecifier');
  const bindings = [];

  if (defaultSpecifier) {
    bindings.push(sourceCode.getText(defaultSpecifier));
  }

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

  if (!bindingStart || fromToken?.value !== 'from') {
    return null;
  }

  return fixer.replaceTextRange([bindingStart.range[0], fromToken.range[0]], `${bindings.join(', ')} `);
}

const noUnusedImports = {
  meta: {
    type: 'problem',
    fixable: 'code',
    schema: [],
    messages: {
      unused: 'Imported bindings {{names}} are never used.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      ImportDeclaration(declaration) {
        const unusedSpecifiers = [];

        for (const variable of sourceCode.getDeclaredVariables(declaration)) {
          if (variable.references.length > 0 || isUsedThroughJSDoc(sourceCode, variable.name)) {
            continue;
          }

          const specifier = declaration.specifiers.find(
            (candidate) => candidate.local.name === variable.name,
          );
          if (!specifier) {
            continue;
          }

          unusedSpecifiers.push(specifier);
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
    };
  },
};

module.exports = {
  meta: { name: 'sdk' },
  rules: { 'no-unused-imports': noUnusedImports },
};
