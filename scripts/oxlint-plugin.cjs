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
const JSDOC_REFERENCE_TAGS = new Set(['see', 'link', 'linkcode', 'linkplain']);
const JSDOC_IDENTIFIER_START = /[$_\p{ID_Start}]/u;
const JSDOC_IDENTIFIER_CONTINUE = /[$\u200c\u200d\p{ID_Continue}]/u;

function readJSDocIdentifierCodePoint(text, start) {
  if (start >= text.length) return;
  if (text[start] !== '\\' || text[start + 1] !== 'u') {
    const codePoint = text.codePointAt(start);
    const value = String.fromCodePoint(codePoint);
    return { value, end: start + value.length };
  }

  let hex;
  let end;
  if (text[start + 2] === '{') {
    end = start + 3;
    while (/[\da-f]/iu.test(text[end] ?? '')) end++;
    if (end === start + 3 || text[end] !== '}') return;
    hex = text.slice(start + 3, end++);
  } else {
    hex = text.slice(start + 2, start + 6);
    if (!/^[\da-f]{4}$/iu.test(hex)) return;
    end = start + 6;
  }

  const codePoint = Number.parseInt(hex, 16);
  if (codePoint > 0x10ffff) return;
  return { value: String.fromCodePoint(codePoint), end };
}

function readJSDocIdentifier(text, start) {
  let character = readJSDocIdentifierCodePoint(text, start);
  if (!character || !JSDOC_IDENTIFIER_START.test(character.value)) return;

  let value = character.value;
  let end = character.end;
  while ((character = readJSDocIdentifierCodePoint(text, end))) {
    if (!JSDOC_IDENTIFIER_CONTINUE.test(character.value)) break;
    value += character.value;
    end = character.end;
  }

  return { value, end };
}

function isJSDocIdentifierContinueBefore(text, index) {
  if (index === 0) return false;

  let start = index - 1;
  const trailingCodeUnit = text.charCodeAt(start);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && start > 0) start--;

  return JSDOC_IDENTIFIER_CONTINUE.test(String.fromCodePoint(text.codePointAt(start)));
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

function isJSDocBareTypeContinuation(comment, start, whitespace, next) {
  const previous = tokenizeJSDocType(comment.slice(start, whitespace)).at(-1);
  if (!previous || comment[next] === '@') return false;

  const identifier = readJSDocIdentifier(comment, next);
  if (identifier) {
    return (
      ['extends', 'in', 'as', 'is', 'satisfies'].includes(identifier.value) ||
      [
        'keyof',
        'typeof',
        'infer',
        'readonly',
        'new',
        'abstract',
        'function',
        'unique',
        'asserts',
        'extends',
        'in',
        'as',
        'is',
        'satisfies',
        '|',
        '&',
        '?',
        ':',
        '=>',
        '=',
        '.',
        '?.',
        '#',
        '~',
      ].includes(previous.value)
    );
  }

  if (comment[next] === '(') return ['function', 'new'].includes(previous.value);
  return ['|', '&', '?', ':', '.', '[', '<', '=', '!'].includes(comment[next]);
}

function readJSDocBareType(comment, start) {
  if (start >= comment.length || comment[start] === '@' || isJSDocLineTerminator(comment[start])) {
    return;
  }

  let braceDepth = 0;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let genericDepth = 0;
  let quote;
  const templateInterpolationDepths = [];
  let end = start;

  for (let cursor = start; cursor < comment.length; cursor++) {
    const character = comment[cursor];
    if (isJSDocLineTerminator(character)) break;

    if (
      !quote &&
      braceDepth === 0 &&
      parenthesisDepth === 0 &&
      bracketDepth === 0 &&
      genericDepth === 0 &&
      /\s/u.test(character)
    ) {
      let next = cursor;
      while (next < comment.length && /\s/u.test(comment[next]) && !isJSDocLineTerminator(comment[next]))
        next++;
      if (next >= comment.length || !isJSDocBareTypeContinuation(comment, start, cursor, next)) break;
    }

    if (quote) {
      if (character === '\\') {
        cursor++;
      } else if (quote === '`' && character === '$' && comment[cursor + 1] === '{') {
        templateInterpolationDepths.push(braceDepth++);
        quote = undefined;
        cursor++;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      braceDepth++;
    } else if (character === '}') {
      if (braceDepth === 0) break;
      braceDepth--;
      if (templateInterpolationDepths.at(-1) === braceDepth) {
        templateInterpolationDepths.pop();
        quote = '`';
      }
    } else if (character === '(') {
      parenthesisDepth++;
    } else if (character === ')' && parenthesisDepth > 0) {
      parenthesisDepth--;
    } else if (character === '[') {
      bracketDepth++;
    } else if (character === ']' && bracketDepth > 0) {
      bracketDepth--;
    } else if (character === '<' && comment[cursor + 1] !== '=') {
      genericDepth++;
    } else if (character === '>' && comment[cursor - 1] !== '=' && genericDepth > 0) {
      genericDepth--;
    } else if (
      character === '@' &&
      braceDepth === 0 &&
      parenthesisDepth === 0 &&
      bracketDepth === 0 &&
      genericDepth === 0 &&
      /\s/u.test(comment[cursor - 1] ?? '')
    ) {
      break;
    }
    end = cursor + 1;
  }

  while (end > start && /\s/u.test(comment[end - 1])) end--;
  if (end === start) return;

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
      (character === "'" && !isJSDocIdentifierContinueBefore(comment, index))
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

function readJSDocLinkTarget(comment, start) {
  let identifier = readJSDocIdentifier(comment, start);
  if (!identifier) return;

  let end = identifier.end;
  while (comment[end] === '.' || comment[end] === '#' || comment[end] === '~') {
    identifier = readJSDocIdentifier(comment, end + 1);
    if (!identifier) break;
    end = identifier.end;
  }

  if (comment[end] === ':' || comment[end] === '/' || comment[end] === '\\') return;
  return { expression: comment.slice(start, end), end };
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
      if (!JSDOC_TYPE_BEARING_TAGS.has(tag) && !JSDOC_REFERENCE_TAGS.has(tag)) {
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

      if (JSDOC_REFERENCE_TAGS.has(tag)) {
        type = readJSDocLinkTarget(comment, afterWhitespace);
      } else if (comment[afterWhitespace] === '{') {
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

function* getJSDocInlineLinkExpressions(comment) {
  let inExample = false;

  for (let lineStart = 0; lineStart < comment.length;) {
    let lineEnd = lineStart;
    while (lineEnd < comment.length && !isJSDocLineTerminator(comment[lineEnd])) lineEnd++;

    let contentStart = lineStart;
    while (comment[contentStart] === ' ' || comment[contentStart] === '\t') contentStart++;
    if (comment[contentStart] === '*') contentStart++;
    while (comment[contentStart] === ' ' || comment[contentStart] === '\t') contentStart++;

    const lineTag = /^@([A-Za-z][\w-]*)/u.exec(comment.slice(contentStart, lineEnd));
    if (lineTag) inExample = lineTag[1] === 'example';

    if (!inExample) {
      let quote;
      for (let index = contentStart; index < lineEnd; index++) {
        const character = comment[index];

        if (character === '\\') {
          index++;
          continue;
        }
        if (quote) {
          if (character === quote) quote = undefined;
          continue;
        }
        if (
          character === '`' ||
          character === '"' ||
          (character === "'" && !isJSDocIdentifierContinueBefore(comment, index))
        ) {
          quote = character;
          continue;
        }

        if (
          character === '@' &&
          /\s/u.test(comment[index - 1] ?? '') &&
          /^@example(?:\s|$)/u.test(comment.slice(index, lineEnd))
        ) {
          inExample = true;
          break;
        }

        if (character !== '{' || comment[index + 1] !== '@') continue;
        const tag = /^@(?:link|linkcode|linkplain)(?=\s)/u.exec(comment.slice(index + 1, lineEnd));
        if (!tag) continue;

        const targetStart = skipJSDocWhitespace(comment, index + 1 + tag[0].length);
        const target = readJSDocLinkTarget(comment, targetStart);
        if (target) yield target.expression;

        while (index < lineEnd && comment[index] !== '}') index++;
      }
    }

    lineStart = getNextJSDocLine(comment, lineEnd);
  }
}

function tokenizeJSDocType(expression) {
  const tokens = [];
  const templateInterpolationDepths = [];
  let braceDepth = 0;
  let quote;

  for (let index = 0; index < expression.length;) {
    const character = expression[index];

    if (quote) {
      if (character === '\\') {
        index += 2;
      } else if (quote === '`' && character === '$' && expression[index + 1] === '{') {
        tokens.push({ kind: 'punctuator', value: '${' });
        templateInterpolationDepths.push(braceDepth);
        quote = undefined;
        index += 2;
      } else {
        if (character === quote) quote = undefined;
        index++;
      }
      continue;
    }

    if (/\s/u.test(character)) {
      index++;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      tokens.push({ kind: 'literal', value: character });
      quote = character;
      index++;
      continue;
    }

    const identifier = readJSDocIdentifier(expression, index);
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier.value });
      index = identifier.end;
      continue;
    }

    if (/\d/u.test(character)) {
      const numeric = /^[\d][\w.]*/u.exec(expression.slice(index));
      tokens.push({ kind: 'literal', value: numeric[0] });
      index += numeric[0].length;
      continue;
    }

    const punctuation = expression.slice(index, index + 3);
    const value = punctuation.startsWith('...')
      ? '...'
      : punctuation.startsWith('=>')
        ? '=>'
        : punctuation.startsWith('?.')
          ? '?.'
          : character;
    tokens.push({ kind: 'punctuator', value });
    index += value.length;

    if (value === '{') {
      braceDepth++;
    } else if (value === '}') {
      if (templateInterpolationDepths.at(-1) === braceDepth) {
        templateInterpolationDepths.pop();
        quote = '`';
      } else if (braceDepth > 0) {
        braceDepth--;
      }
    }
  }

  return tokens;
}

function getJSDocTokenPairs(tokens) {
  const pairs = new Map();
  const openings = [];
  const openingFor = { ')': '(', ']': '[', '}': ['{', '${'], '>': '<' };

  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].value;
    if (value === '(' || value === '[' || value === '{' || value === '${' || value === '<') {
      openings.push(index);
      continue;
    }

    const expected = openingFor[value];
    if (!expected) continue;
    const opening = openings.at(-1);
    if (opening === undefined) continue;
    const actual = tokens[opening].value;
    if (Array.isArray(expected) ? !expected.includes(actual) : expected !== actual) continue;

    openings.pop();
    pairs.set(opening, index);
    pairs.set(index, opening);
  }

  return pairs;
}

function isJSDocMemberStart(tokens, index) {
  let previous = index - 1;
  while (
    previous >= 0 &&
    [
      'readonly',
      'get',
      'set',
      'public',
      'private',
      'protected',
      'static',
      'abstract',
      'override',
      '+',
      '-',
    ].includes(tokens[previous].value)
  ) {
    previous--;
  }
  return previous < 0 || ['{', '(', '[', ',', ';', '...'].includes(tokens[previous].value);
}

function isJSDocSignatureParameter(tokens, index, pairs) {
  for (let opening = index - 1; opening >= 0; opening--) {
    if (tokens[opening].value !== '(') continue;
    const closing = pairs.get(opening);
    if (closing === undefined || closing < index) continue;
    if (tokens[opening - 1]?.value === 'function') return false;

    return ['=>', ':'].includes(tokens[closing + 1]?.value);
  }

  return false;
}

function getJSDocBindingRanges(tokens, pairs) {
  const bindings = [];

  for (let opening = 0; opening < tokens.length; opening++) {
    if (!['{', '['].includes(tokens[opening].value)) continue;
    if (!['(', ',', '...'].includes(tokens[opening - 1]?.value)) continue;
    const closing = pairs.get(opening);
    if (closing === undefined || ![':', '?', '='].includes(tokens[closing + 1]?.value)) continue;

    for (let index = opening + 1; index < closing; index++) {
      if (tokens[index].kind === 'identifier') {
        bindings.push({ name: tokens[index].value, start: index, end: index + 1 });
      }
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'identifier') continue;
    const name = tokens[index].value;

    if (tokens[index - 1]?.value === 'infer') {
      let question = index + 1;
      while (question < tokens.length && tokens[question].value !== '?') question++;
      let end = tokens.length;
      if (question < tokens.length) {
        let conditionalDepth = 0;
        for (let cursor = question + 1; cursor < tokens.length; cursor++) {
          const closing = pairs.get(cursor);
          if (closing > cursor) {
            cursor = closing;
            continue;
          }
          const value = tokens[cursor].value;
          if (value === '?') conditionalDepth++;
          if (value === ':') {
            if (conditionalDepth === 0) {
              end = cursor;
              break;
            }
            conditionalDepth--;
          }
        }
      }
      bindings.push({ name, start: index, end });
      continue;
    }

    if (tokens[index + 1]?.value === 'in' && tokens[index - 1]?.value === '[') {
      let end = tokens.length;
      for (let cursor = index - 2; cursor >= 0; cursor--) {
        if (tokens[cursor].value === '{' && pairs.get(cursor) > index) {
          end = pairs.get(cursor) + 1;
          break;
        }
      }
      bindings.push({ name, start: index, end });
    }
  }

  for (let opening = 0; opening < tokens.length; opening++) {
    if (tokens[opening].value !== '<') continue;
    const closing = pairs.get(opening);
    if (closing === undefined || tokens[closing + 1]?.value !== '(') continue;
    const before = tokens[opening - 1];
    if (before?.kind === 'identifier' && before.value !== 'new' && !isJSDocMemberStart(tokens, opening - 1)) {
      continue;
    }

    let end = tokens.length;
    for (let cursor = opening - 1; cursor >= 0; cursor--) {
      const close = pairs.get(cursor);
      if (close > closing && ['(', '[', '{'].includes(tokens[cursor].value)) {
        end = close;
        break;
      }
    }

    const parametersEnd = pairs.get(closing + 1);
    if (parametersEnd !== undefined) {
      for (let cursor = parametersEnd + 1; cursor < end; cursor++) {
        const nestedEnd = pairs.get(cursor);
        if (nestedEnd > cursor) {
          cursor = nestedEnd;
          continue;
        }
        if (tokens[cursor].value === ',' || tokens[cursor].value === ';') {
          end = cursor;
          break;
        }
      }
    }

    let segmentStart = opening + 1;
    for (let cursor = opening + 1; cursor <= closing; cursor++) {
      const nextPair = pairs.get(cursor);
      if (nextPair > cursor && nextPair < closing) {
        cursor = nextPair;
        continue;
      }
      if (cursor < closing && tokens[cursor].value !== ',') continue;

      const parameter = tokens[segmentStart];
      if (parameter?.kind === 'identifier') {
        bindings.push({ name: parameter.value, start: segmentStart, end });
      }
      segmentStart = cursor + 1;
    }
  }

  return bindings;
}

function isJSDocTypeReference(expression, name) {
  const tokens = tokenizeJSDocType(expression);
  const pairs = getJSDocTokenPairs(tokens);
  const bindings = getJSDocBindingRanges(tokens, pairs);

  return tokens.some((token, index) => {
    if (token.kind !== 'identifier' || token.value !== name) return false;
    if (bindings.some((binding) => binding.name === name && index >= binding.start && index < binding.end)) {
      return false;
    }
    if (['.', '?.', '#', '~'].includes(tokens[index - 1]?.value)) return false;
    if (tokens[index - 1]?.value === 'asserts' || tokens[index + 1]?.value === 'is') return false;

    let next = index + 1;
    if (tokens[next]?.value === '?') next++;
    if (tokens[next]?.value === ':' && isJSDocMemberStart(tokens, index)) return false;
    if (
      [')', ',', '='].includes(tokens[next]?.value) &&
      isJSDocMemberStart(tokens, index) &&
      isJSDocSignatureParameter(tokens, index, pairs)
    ) {
      return false;
    }
    if (tokens[next]?.value === '(' && isJSDocMemberStart(tokens, index)) return false;
    if (['}', ',', ';'].includes(tokens[next]?.value) && isJSDocMemberStart(tokens, index)) {
      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const closing = pairs.get(cursor);
        if (closing <= index) continue;
        if (tokens[cursor].value === '{') return false;
        if (['(', '[', '${'].includes(tokens[cursor].value)) break;
      }
    }
    if (tokens[next]?.value === '<') {
      const closing = pairs.get(next);
      if (closing !== undefined && tokens[closing + 1]?.value === '(' && isJSDocMemberStart(tokens, index)) {
        return false;
      }
    }

    return true;
  });
}

function isUsedThroughJSDoc(sourceCode, name) {
  return sourceCode.getAllComments().some((comment) => {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
      return false;
    }

    const expressions = [
      ...getJSDocTypeExpressions(comment.value),
      ...getJSDocInlineLinkExpressions(comment.value),
    ];
    return expressions.some((expression) => isJSDocTypeReference(expression, name));
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
