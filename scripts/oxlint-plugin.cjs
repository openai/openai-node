/**
 * Import-only unused-binding checks for Oxlint, without ESLint dependencies.
 *
 * Stainless-generated sources sometimes import both a namespace and the same
 * member from one module. Preserve that existing convention when the member
 * is accessed through the namespace, even if the direct binding is unused.
 */
function isUsedThroughSiblingNamespace(sourceCode, importDeclaration, name) {
  for (const declaration of sourceCode.ast.body) {
    if (
      declaration.type !== 'ImportDeclaration' ||
      declaration === importDeclaration ||
      declaration.source.value !== importDeclaration.source.value
    ) {
      continue;
    }

    for (const specifier of declaration.specifiers) {
      if (specifier.type !== 'ImportNamespaceSpecifier') {
        continue;
      }

      const variable = sourceCode
        .getDeclaredVariables(declaration)
        .find((candidate) => candidate.name === specifier.local.name);

      if (
        variable?.references.some(({ identifier }) => {
          const parent = identifier.parent;
          return (
            (parent?.type === 'MemberExpression' &&
              parent.object === identifier &&
              !parent.computed &&
              parent.property.name === name) ||
            (parent?.type === 'TSQualifiedName' && parent.left === identifier && parent.right.name === name)
          );
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

function fixUnusedImport(sourceCode, declaration, specifier, fixer) {
  if (declaration.specifiers.length === 1) {
    return fixer.remove(declaration);
  }

  const namedSpecifiers = declaration.specifiers.filter((candidate) => candidate.type === 'ImportSpecifier');

  if (specifier.type === 'ImportSpecifier' && namedSpecifiers.length === 1) {
    const openingBrace = sourceCode.getTokenBefore(specifier, {
      filter: (token) => token.value === '{',
    });
    const precedingComma = openingBrace
      ? sourceCode.getTokenBefore(openingBrace, {
          filter: (token) => token.value === ',',
        })
      : undefined;
    const closingBrace = sourceCode.getTokenAfter(specifier, {
      filter: (token) => token.value === '}',
    });

    if (precedingComma && closingBrace) {
      return fixer.removeRange([precedingComma.range[0], closingBrace.range[1]]);
    }
  }

  const nextToken = sourceCode.getTokenAfter(specifier);
  if (nextToken?.value === ',') {
    return fixer.removeRange([specifier.range[0], nextToken.range[1]]);
  }

  const previousToken = sourceCode.getTokenBefore(specifier);
  if (previousToken?.value === ',') {
    return fixer.removeRange([previousToken.range[0], specifier.range[1]]);
  }

  return null;
}

const noUnusedImports = {
  meta: {
    type: 'problem',
    fixable: 'code',
    schema: [],
    messages: {
      unused: "'{{name}}' is imported but never used.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      ImportDeclaration(declaration) {
        for (const variable of sourceCode.getDeclaredVariables(declaration)) {
          if (
            variable.references.length > 0 ||
            isUsedThroughSiblingNamespace(sourceCode, declaration, variable.name)
          ) {
            continue;
          }

          const specifier = declaration.specifiers.find(
            (candidate) => candidate.local.name === variable.name,
          );
          if (!specifier) {
            continue;
          }

          context.report({
            node: specifier.local,
            messageId: 'unused',
            data: { name: variable.name },
            fix: (fixer) => fixUnusedImport(sourceCode, declaration, specifier, fixer),
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
