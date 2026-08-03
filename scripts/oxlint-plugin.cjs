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
const JSDOC_BARE_TYPE_TAGS = new Set(['implements', 'augments', 'extends', 'type', 'this', 'enum']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isJSDocLineTerminator(character) {
  return character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';
}

function skipJSDocWhitespace(comment, index) {
  while (
    index < comment.length &&
    (/\s/u.test(comment[index]) || (comment[index] === '*' && /\s/u.test(comment[index + 1] ?? '')))
  ) {
    index++;
  }
  return index;
}

function readJSDocBracedType(comment, start) {
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
        return { expression: comment.slice(start, end), end: end + 1 };
      }
      if (templateInterpolationDepths.at(-1) === depth) {
        templateInterpolationDepths.pop();
        quote = '`';
      }
    }
  }
}

function readJSDocBareType(comment, start) {
  const identifier = /^[A-Za-z_$][\w$.]*/u.exec(comment.slice(start));
  if (!identifier) return;

  let end = start + identifier[0].length;
  let genericStart = end;
  while (comment[genericStart] === ' ' || comment[genericStart] === '\t') genericStart++;
  if (comment[genericStart] !== '<') {
    return { expression: comment.slice(start, end), end };
  }

  let depth = 1;
  let quote;
  for (let cursor = genericStart + 1; cursor < comment.length; cursor++) {
    const character = comment[cursor];
    if (isJSDocLineTerminator(character)) break;
    if (quote) {
      if (character === '\\') {
        cursor++;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '<' && comment[cursor + 1] !== '=') {
      depth++;
    } else if (
      character === '>' &&
      comment[cursor - 1] !== '=' &&
      comment[cursor + 1] !== '=' &&
      --depth === 0
    ) {
      end = cursor + 1;
      break;
    }
  }

  return { expression: comment.slice(start, end), end };
}

function getNextJSDocLine(comment, index) {
  while (index < comment.length && !isJSDocLineTerminator(comment[index])) index++;
  if (comment[index] === '\r' && comment[index + 1] === '\n') return index + 2;
  return index + 1;
}

function findJSDocSiblingTag(comment, index) {
  let braceDepth = 0;
  let quote;
  const templateInterpolationDepths = [];

  for (; index < comment.length && !isJSDocLineTerminator(comment[index]); index++) {
    const character = comment[index];
    if (quote) {
      if (character === '\\') {
        index++;
      } else if (quote === '`' && character === '$' && comment[index + 1] === '{') {
        templateInterpolationDepths.push(braceDepth++);
        quote = undefined;
        index++;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (
      character === '`' ||
      character === '"' ||
      (character === "'" && !/[A-Za-z0-9_$]/u.test(comment[index - 1] ?? ''))
    ) {
      quote = character;
    } else if (character === '\\') {
      index++;
    } else if (character === '{') {
      braceDepth++;
    } else if (character === '}' && braceDepth > 0) {
      braceDepth--;
      if (templateInterpolationDepths.at(-1) === braceDepth) {
        templateInterpolationDepths.pop();
        quote = '`';
      }
    } else if (character === '@' && braceDepth === 0 && /\s/u.test(comment[index - 1] ?? '')) {
      return index;
    }
  }
}

function* getJSDocTypeExpressions(comment) {
  for (let index = 0; index < comment.length;) {
    while (comment[index] === ' ' || comment[index] === '\t') index++;
    if (comment[index] === '*') index++;
    while (comment[index] === ' ' || comment[index] === '\t') index++;

    if (comment[index] !== '@') {
      index = getNextJSDocLine(comment, index);
      continue;
    }

    while (index < comment.length) {
      const tagMatch = /^@([A-Za-z][\w-]*)/u.exec(comment.slice(index));
      if (!tagMatch || tagMatch[1] === 'example') {
        index = getNextJSDocLine(comment, index);
        break;
      }

      const tag = tagMatch[1];
      const afterTag = index + tagMatch[0].length;
      if (!JSDOC_TYPE_BEARING_TAGS.has(tag)) {
        const sibling = findJSDocSiblingTag(comment, afterTag);
        if (sibling === undefined) {
          index = getNextJSDocLine(comment, afterTag);
          break;
        }
        index = sibling;
        continue;
      }

      const afterWhitespace = skipJSDocWhitespace(comment, afterTag);
      let type;

      if (comment[afterWhitespace] === '{') {
        type = readJSDocBracedType(comment, afterWhitespace + 1);
      } else if (JSDOC_NAMED_TYPE_TAGS.has(tag)) {
        let afterName = afterWhitespace;
        while (
          afterName < comment.length &&
          !/\s/u.test(comment[afterName]) &&
          !/[{}*@]/u.test(comment[afterName])
        ) {
          afterName++;
        }
        if (afterName > afterWhitespace) {
          const afterNameWhitespace = skipJSDocWhitespace(comment, afterName);
          if (comment[afterNameWhitespace] === '{') {
            type = readJSDocBracedType(comment, afterNameWhitespace + 1);
          }
        }
      } else if (JSDOC_BARE_TYPE_TAGS.has(tag) && afterWhitespace > afterTag) {
        type = readJSDocBareType(comment, afterWhitespace);
      }

      if (type) yield type.expression;

      const sibling = findJSDocSiblingTag(comment, type?.end ?? afterTag);
      if (sibling === undefined) {
        index = getNextJSDocLine(comment, type?.end ?? afterTag);
        break;
      }
      index = sibling;
    }
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
