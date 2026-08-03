/**
 * Import-only unused-binding checks for Oxlint, without ESLint dependencies.
 *
 * Stainless-generated sources sometimes import both a namespace and the same
 * unaliased member from one module. Preserve that existing convention when the
 * member is accessed through the namespace, even if the direct binding is
 * unused.
 */
function isUsedThroughSiblingNamespace(sourceCode, importDeclaration, specifier) {
  if (
    specifier.type !== 'ImportSpecifier' ||
    specifier.imported.type !== 'Identifier' ||
    specifier.imported.name !== specifier.local.name
  ) {
    return false;
  }

  const name = specifier.imported.name;

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

const JSDOC_TYPE_TAG = /@(?:type|typedef|param|returns?)\s*\{([^}]*)\}/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isUsedThroughJSDoc(sourceCode, name) {
  const identifier = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}(?=$|[^A-Za-z0-9_$])`);

  return sourceCode.getAllComments().some((comment) => {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
      return false;
    }

    return Array.from(comment.value.matchAll(JSDOC_TYPE_TAG), (match) => match[1]).some((typeExpression) =>
      identifier.test(typeExpression),
    );
  });
}

function fixUnusedImports(sourceCode, declaration, unusedSpecifiers, fixer) {
  const unused = new Set(unusedSpecifiers);
  const retainedSpecifiers = declaration.specifiers.filter((specifier) => !unused.has(specifier));

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

          if (isUsedThroughSiblingNamespace(sourceCode, declaration, specifier)) {
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
