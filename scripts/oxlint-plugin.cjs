/** Import-only unused-binding checks for Oxlint, backed by TypeScript's compiler parser. */

const ts = require('typescript');

const TYPE_BEARING_TAGS = new Set([
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
const REFERENCE_TAGS = new Set(['see', 'link', 'linkcode', 'linkplain']);

function parseJSDocComment(comment) {
  const sourceFile = ts.createSourceFile(
    'oxlint-jsdoc.js',
    `${comment}\nvoid 0;`,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseAll },
    true,
    ts.ScriptKind.JS,
  );

  return {
    comment: sourceFile.statements[0]?.jsDoc?.[0],
    diagnostics: sourceFile.jsDocDiagnostics ?? [],
    text: sourceFile.text,
  };
}

function getEntityRoot(entity) {
  while (entity) {
    if (ts.isIdentifier(entity)) return ts.unescapeLeadingUnderscores(entity.escapedText);
    if (ts.isQualifiedName(entity) || ts.isJSDocMemberName(entity)) {
      entity = entity.left;
    } else if (ts.isPropertyAccessExpression(entity)) {
      entity = entity.expression;
    } else {
      return;
    }
  }
}

function addEntityReference(entity, bindings, used) {
  const name = getEntityRoot(entity);
  if (name && !bindings.has(name)) used.add(name);
}

function getInferBindings(node, bindings = new Set()) {
  if (ts.isInferTypeNode(node)) {
    bindings.add(ts.unescapeLeadingUnderscores(node.typeParameter.name.escapedText));
  }
  ts.forEachChild(node, (child) => {
    getInferBindings(child, bindings);
  });
  return bindings;
}

function collectExpressionReferences(node, bindings, used) {
  if (!node) return;
  if (ts.isIdentifier(node)) {
    addEntityReference(node, bindings, used);
  } else if (ts.isPropertyAccessExpression(node)) {
    collectExpressionReferences(node.expression, bindings, used);
  } else {
    ts.forEachChild(node, (child) => collectExpressionReferences(child, bindings, used));
  }
}

function collectTypeReferences(node, bindings, used) {
  if (!node) return;

  if (ts.isTypeReferenceNode(node)) {
    addEntityReference(node.typeName, bindings, used);
    node.typeArguments?.forEach((argument) => collectTypeReferences(argument, bindings, used));
    return;
  }

  if (ts.isTypeQueryNode(node)) {
    addEntityReference(node.exprName, bindings, used);
    node.typeArguments?.forEach((argument) => collectTypeReferences(argument, bindings, used));
    return;
  }

  if (ts.isExpressionWithTypeArguments(node)) {
    addEntityReference(node.expression, bindings, used);
    node.typeArguments?.forEach((argument) => collectTypeReferences(argument, bindings, used));
    return;
  }

  if (ts.isComputedPropertyName(node)) {
    collectExpressionReferences(node.expression, bindings, used);
    return;
  }

  if (ts.isMappedTypeNode(node)) {
    collectTypeReferences(node.typeParameter.constraint, bindings, used);
    collectTypeReferences(node.typeParameter.default, bindings, used);
    const mappedBindings = new Set(bindings);
    mappedBindings.add(ts.unescapeLeadingUnderscores(node.typeParameter.name.escapedText));
    collectTypeReferences(node.nameType, mappedBindings, used);
    collectTypeReferences(node.type, mappedBindings, used);
    return;
  }

  if (ts.isConditionalTypeNode(node)) {
    collectTypeReferences(node.checkType, bindings, used);
    collectTypeReferences(node.extendsType, bindings, used);
    const trueBindings = new Set([...bindings, ...getInferBindings(node.extendsType)]);
    collectTypeReferences(node.trueType, trueBindings, used);
    collectTypeReferences(node.falseType, bindings, used);
    return;
  }

  if (ts.isInferTypeNode(node)) {
    collectTypeReferences(node.typeParameter.constraint, bindings, used);
    return;
  }

  if (ts.isTypePredicateNode(node)) {
    collectTypeReferences(node.type, bindings, used);
    return;
  }

  if (node.typeParameters?.length) {
    const innerBindings = new Set(bindings);
    for (const parameter of node.typeParameters) {
      collectTypeReferences(parameter.constraint, bindings, used);
      collectTypeReferences(parameter.default, bindings, used);
      innerBindings.add(ts.unescapeLeadingUnderscores(parameter.name.escapedText));
    }
    ts.forEachChild(node, (child) => {
      if (!ts.isTypeParameterDeclaration(child)) collectTypeReferences(child, innerBindings, used);
    });
    return;
  }

  ts.forEachChild(node, (child) => collectTypeReferences(child, bindings, used));
}

function collectDocumentationLinks(comment, bindings, used, text) {
  if (!Array.isArray(comment)) return;

  for (const node of comment) {
    if (!ts.isJSDocLinkLike(node) || text[node.pos - 1] === '\\') continue;
    addEntityReference(node.name, bindings, used);
  }
}

function collectBacktickedDocumentationLinks(tag, bindings, used, text) {
  const comment = text.slice(tag.tagName.end, tag.end);
  if (!comment.includes('{@') || !comment.includes('`')) {
    return;
  }

  const normalized = parseJSDocComment(`/** @deprecated${comment.replaceAll('`', ' ')} */`);
  collectDocumentationLinks(normalized.comment?.tags?.[0]?.comment, bindings, used, normalized.text);
}

function startsJSDocLine(text, position) {
  let lineStart = position;
  while (lineStart > 0 && !/[\n\r\u2028\u2029]/u.test(text[lineStart - 1])) lineStart--;
  return /^(?:\/\*\*|\s*\*)?\s*$/u.test(text.slice(lineStart, position));
}

function hasUnclosedBrace(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let depth = 0;

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.OpenBraceToken) depth++;
    if (token === ts.SyntaxKind.CloseBraceToken && depth > 0) depth--;
  }

  return depth > 0;
}

function isWithinTemplateProse(text, previous, current) {
  if (!previous) return false;

  const start =
    previous.name?.end ?? previous.typeExpression?.end ?? previous.class?.end ?? previous.tagName.end;
  const prose = text.slice(start, current.pos).trim();
  const opening = prose.indexOf('`');
  if (opening < 0) return false;

  const closing = prose.lastIndexOf('`');
  const expression = prose.slice(opening, closing + 1);
  const source = ts.createSourceFile(
    'oxlint-prose.ts',
    `const value = ${expression};`,
    ts.ScriptTarget.Latest,
  );
  return source.parseDiagnostics.length > 0;
}

function getCanonicalTemplateTag(tag, parsed) {
  const invalid = parsed.diagnostics.some(
    (diagnostic) => diagnostic.start >= tag.pos && diagnostic.start < tag.end,
  );
  if (!invalid) return tag;

  const tail = parsed.text.slice(tag.tagName.end, tag.end);
  if (!/[\n\r\u2028\u2029]/u.test(tail)) return;

  const normalized = tail.replace(/(?:\r\n|[\n\r\u2028\u2029])\s*\*?/gu, ' ');
  const reparsed = parseJSDocComment(`/** @template${normalized} */`);
  return reparsed.diagnostics.length === 0 ? reparsed.comment?.tags?.[0] : undefined;
}

function collectClosureTypeReferences(tag, text, bindings, used) {
  const tail = text.slice(tag.tagName.end, tag.end);
  const opening = tail.indexOf('{');
  const closing = tail.lastIndexOf('}');
  const expression = opening >= 0 && closing > opening ? tail.slice(opening + 1, closing) : tail.trim();
  if (!expression) return false;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, expression);
  const changes = [];
  const functionDepths = [];
  let functionStart;
  let depth = 0;
  let awaitingReturnType = false;

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (awaitingReturnType && token !== ts.SyntaxKind.ColonToken) awaitingReturnType = false;

    if (token === ts.SyntaxKind.FunctionKeyword) {
      functionStart = scanner.getTokenPos();
    } else if (token === ts.SyntaxKind.OpenParenToken) {
      depth++;
      if (functionStart !== undefined) {
        changes.push({ start: functionStart, end: scanner.getTokenPos(), text: '' });
        functionDepths.push(depth);
        functionStart = undefined;
      }
    } else if (token === ts.SyntaxKind.CloseParenToken) {
      if (functionDepths.at(-1) === depth) {
        functionDepths.pop();
        awaitingReturnType = true;
      }
      depth--;
    } else if (token === ts.SyntaxKind.ColonToken && awaitingReturnType) {
      changes.push({ start: scanner.getTokenPos(), end: scanner.getTextPos(), text: '=>' });
      awaitingReturnType = false;
    }
  }

  if (changes.length === 0) return false;
  let normalized = expression;
  for (const change of changes.reverse()) {
    normalized = `${normalized.slice(0, change.start)}${change.text}${normalized.slice(change.end)}`;
  }

  const source = ts.createSourceFile(
    'oxlint-type.ts',
    `type OxlintType = ${normalized};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const alias = source.statements[0];
  if (!alias || !ts.isTypeAliasDeclaration(alias)) return false;
  collectTypeReferences(alias.type, bindings, used);
  return true;
}

function collectJSDocTagReferences(tag, original, parsed, bindings, used) {
  const diagnostics = parsed.diagnostics.some(
    (diagnostic) => diagnostic.start >= original.pos && diagnostic.start < original.end,
  );

  if (diagnostics && parsed.text.slice(original.tagName.end, original.end).includes('function')) {
    if (collectClosureTypeReferences(original, parsed.text, bindings, used)) return;
  }

  if (diagnostics && tag.typeExpression?.type?.pos === tag.typeExpression?.type?.end) {
    const tail = parsed.text.slice(original.tagName.end, original.end).trim();
    if (/^[?!]/u.test(tail)) {
      const normalized = parseJSDocComment(`/** @type {${tail}} */`);
      collectTypeReferences(normalized.comment?.tags?.[0]?.typeExpression, bindings, used);
      return;
    }
  }

  collectTypeReferences(tag.typeExpression ?? tag.class, bindings, used);
}

function normalizeJSDocTag(tag, text) {
  const name = ts.unescapeLeadingUnderscores(tag.tagName.escapedText).toLowerCase();
  if (!TYPE_BEARING_TAGS.has(name) && !REFERENCE_TAGS.has(name)) return;
  if (tag.kind !== ts.SyntaxKind.JSDocTag) return tag;

  const canonicalName = REFERENCE_TAGS.has(name)
    ? 'see'
    : name === 'prop' || name === 'property'
      ? 'param'
      : 'type';
  const tail = text.slice(tag.tagName.end, tag.end);
  return parseJSDocComment(`/** @${canonicalName}${tail} */`).comment?.tags?.[0];
}

function getJSDocImportUsage(sourceCode) {
  const used = new Set();

  for (const comment of sourceCode.getAllComments()) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;

    const raw = sourceCode.text.slice(comment.range[0], comment.range[1]);
    const parsed = parseJSDocComment(raw);
    const doc = parsed.comment;
    if (!doc) continue;

    const tags = doc.tags ?? [];
    const bindings = new Set();
    const templates = new Map();
    for (const tag of tags) {
      if (!ts.isJSDocTemplateTag(tag)) continue;
      const normalized = getCanonicalTemplateTag(tag, parsed);
      if (!normalized) continue;
      templates.set(tag, normalized);
      for (const parameter of normalized.typeParameters) {
        bindings.add(ts.unescapeLeadingUnderscores(parameter.name.escapedText));
      }
    }

    collectDocumentationLinks(doc.comment, bindings, used, parsed.text);

    let inExample = false;
    let documentationTag;
    let previousTag;
    for (const originalTag of tags) {
      const name = ts.unescapeLeadingUnderscores(originalTag.tagName.escapedText).toLowerCase();
      const startsLine = startsJSDocLine(parsed.text, originalTag.pos);

      if (inExample && !startsLine) continue;
      if (inExample && startsLine) inExample = false;
      if (name === 'example') {
        inExample = true;
        continue;
      }

      if (!startsLine && isWithinTemplateProse(parsed.text, previousTag, originalTag)) continue;

      if (
        documentationTag &&
        !startsLine &&
        hasUnclosedBrace(parsed.text.slice(documentationTag.tagName.end, originalTag.pos))
      ) {
        continue;
      }

      if (!TYPE_BEARING_TAGS.has(name) && !REFERENCE_TAGS.has(name)) {
        documentationTag = originalTag;
        collectDocumentationLinks(originalTag.comment, bindings, used, parsed.text);
        collectBacktickedDocumentationLinks(originalTag, bindings, used, parsed.text);
        previousTag = originalTag;
        continue;
      }

      documentationTag = undefined;
      const tag = templates.get(originalTag) ?? normalizeJSDocTag(originalTag, parsed.text);
      if (!tag) continue;

      if (ts.isJSDocTemplateTag(tag)) {
        collectTypeReferences(tag.constraint, new Set(), used);
        for (const parameter of tag.typeParameters) {
          collectTypeReferences(parameter.default, new Set(), used);
        }
      } else if (ts.isJSDocSeeTag(tag)) {
        const prefix = parsed.text.slice(
          originalTag.tagName.end,
          originalTag.name?.name?.pos ?? originalTag.name?.pos ?? originalTag.end,
        );
        if (!prefix.includes('{')) addEntityReference(tag.name?.name, bindings, used);
      } else {
        collectJSDocTagReferences(tag, originalTag, parsed, bindings, used);
      }

      collectDocumentationLinks(originalTag.comment, bindings, used, parsed.text);
      collectBacktickedDocumentationLinks(originalTag, bindings, used, parsed.text);
      previousTag = originalTag;
    }
  }

  return used;
}

function getJSXFactoryRoot(expression) {
  if (typeof expression !== 'string') return;
  return getEntityRoot(ts.parseIsolatedEntityName(expression, ts.ScriptTarget.Latest));
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

    if (comma?.value !== ',') return null;
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
    const jsxUsedImports = getJSXImportUsage(context);
    const jsDocUsedImports = getJSDocImportUsage(sourceCode);

    return {
      ImportDeclaration(declaration) {
        const unusedSpecifiers = [];
        for (const variable of sourceCode.getDeclaredVariables(declaration)) {
          if (
            variable.references.some((reference) => reference.identifier !== variable.identifiers[0]) ||
            jsxUsedImports.has(variable) ||
            jsDocUsedImports.has(variable.name)
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
    };
  },
};

module.exports = { meta: { name: 'sdk' }, rules: { 'no-unused-imports': noUnusedImports } };
