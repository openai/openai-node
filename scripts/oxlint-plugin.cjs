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

function getEntityRootNode(entity) {
  while (entity) {
    if (ts.isIdentifier(entity)) return entity;
    if (ts.isQualifiedName(entity) || ts.isJSDocMemberName(entity)) {
      entity = entity.left;
    } else if (ts.isPropertyAccessExpression(entity)) {
      entity = entity.expression;
    } else {
      return;
    }
  }
}

function getEntityRoot(entity) {
  const root = getEntityRootNode(entity);
  return root && ts.unescapeLeadingUnderscores(root.escapedText);
}

function addEntityReference(entity, bindings, used, namespace = 'type') {
  const name = getEntityRoot(entity);
  if (!name || bindings.has(name)) return;
  const namespaces = used.get(name) ?? new Set();
  namespaces.add(namespace);
  used.set(name, namespaces);
}

function getInferBindings(node, bindings = new Set()) {
  if (ts.isConditionalTypeNode(node)) return bindings;
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
    addEntityReference(node, bindings, used, 'value');
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
    addEntityReference(node.exprName, bindings, used, 'value');
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
      collectTypeReferences(parameter.constraint, innerBindings, used);
      collectTypeReferences(parameter.default, innerBindings, used);
      innerBindings.add(ts.unescapeLeadingUnderscores(parameter.name.escapedText));
    }
    ts.forEachChild(node, (child) => {
      if (!ts.isTypeParameterDeclaration(child)) collectTypeReferences(child, innerBindings, used);
    });
    return;
  }

  ts.forEachChild(node, (child) => collectTypeReferences(child, bindings, used));
}

function addDocumentationReference(entity, bindings, used, namespaces) {
  if (namespaces?.size) {
    for (const namespace of namespaces) addEntityReference(entity, bindings, used, namespace);
    return;
  }

  addEntityReference(entity, bindings, used);
}

function collectDocumentationLinks(comment, bindings, used, text, documentationNamespaces) {
  if (!Array.isArray(comment)) return;

  for (const node of comment) {
    if (!ts.isJSDocLinkLike(node) || text[node.pos - 1] === '\\') continue;
    const name = getEntityRoot(node.name);
    addDocumentationReference(node.name, bindings, used, documentationNamespaces?.get(name));
  }
}

function collectBacktickedDocumentationLinks(tag, bindings, used, text, documentationNamespaces) {
  const comment = text.slice(tag.tagName.end, tag.end);
  if (!comment.includes('{@') || !comment.includes('`')) {
    return;
  }

  const normalized = parseJSDocComment(`/** @deprecated${comment.replaceAll('`', ' ')} */`);
  collectDocumentationLinks(
    normalized.comment?.tags?.[0]?.comment,
    bindings,
    used,
    normalized.text,
    documentationNamespaces,
  );
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
  return source.parseDiagnostics.some(
    (diagnostic) => diagnostic.code === ts.Diagnostics.Unterminated_template_literal.code,
  );
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

function isTypeBinding(variable) {
  if (typeof variable.isTypeVariable === 'boolean') return variable.isTypeVariable;

  return variable.defs.some((definition) => {
    if (typeof definition.isTypeDefinition === 'boolean') return definition.isTypeDefinition;

    return (
      definition.type === 'ImportBinding' ||
      definition.type === 'ClassName' ||
      definition.type === 'Type' ||
      definition.type === 'TSEnumName' ||
      definition.type === 'TSModuleName' ||
      definition.type === 'TypeParameterName' ||
      definition.node?.type === 'ClassDeclaration' ||
      definition.node?.type === 'TSTypeAliasDeclaration' ||
      definition.node?.type === 'TSInterfaceDeclaration' ||
      definition.node?.type === 'TSEnumDeclaration' ||
      definition.node?.type === 'TSModuleDeclaration' ||
      definition.node?.type === 'TSTypeParameter'
    );
  });
}

function isTypeParameterBinding(variable) {
  return variable?.defs.some(
    (definition) => definition.type === 'TypeParameterName' || definition.node?.type === 'TSTypeParameter',
  );
}

function getJSDocHost(sourceCode, comment) {
  const token = sourceCode.getTokenAfter(comment) ?? sourceCode.getTokenBefore(comment);
  const node = token && sourceCode.getNodeByRangeIndex(token.range[0]);
  let documented = node;
  if (documented?.type === 'ExportNamedDeclaration' || documented?.type === 'ExportDefaultDeclaration') {
    documented = documented.declaration;
  }
  if (documented?.type === 'Identifier' && documented.parent?.key === documented) {
    documented = documented.parent;
  }
  return { node, documented };
}

function getJSDocCallableHost(documented) {
  if (documented?.type === 'VariableDeclaration') return documented.declarations[0]?.init;
  if (documented?.type === 'MethodDefinition' || documented?.type === 'Property') {
    return documented.value;
  }
  return documented;
}

function getJSDocRootBinding(sourceCode, comment, name, namespace) {
  const { node, documented } = getJSDocHost(sourceCode, comment);
  const callable = getJSDocCallableHost(documented);

  if (namespace === 'value') {
    if (
      callable?.type === 'ArrowFunctionExpression' ||
      callable?.type === 'FunctionExpression' ||
      callable?.type === 'FunctionDeclaration'
    ) {
      const parameter = sourceCode.getScope(callable).set.get(name);
      if (parameter?.defs.some((definition) => definition.type === 'Parameter')) return parameter;
    }
  }

  if (namespace === 'type' && callable) {
    const typeParameter = sourceCode.getScope(callable).set.get(name);
    if (isTypeParameterBinding(typeParameter)) return typeParameter;
  }

  for (let scope = sourceCode.getScope(node ?? sourceCode.ast); scope; scope = scope.upper) {
    const [start, end] = scope.block.range;
    if (comment.range[0] < start || comment.range[1] > end) continue;
    const variable = scope.set.get(name);
    if (variable && (namespace === 'value' || isTypeBinding(variable))) return variable;
  }
}

function isStandaloneJSDocDeclarationTag(tag) {
  return ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag);
}

function getSymbolNamespaces(checker, symbol) {
  if (!symbol) return;

  const original = symbol;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased && aliased !== symbol && !(aliased.flags & ts.SymbolFlags.Unknown)) {
      symbol = aliased;
    }
  }

  const namespaces = new Set();
  if (symbol.flags & ts.SymbolFlags.Type) namespaces.add('type');
  if (symbol.flags & ts.SymbolFlags.Value) namespaces.add('value');

  // An unresolved import alias is still a real documentation target. Keep both
  // namespaces rather than guessing which export the unresolved module provides.
  if (namespaces.size === 0 && original.flags & ts.SymbolFlags.Alias) {
    namespaces.add('type');
    namespaces.add('value');
  }

  return namespaces.size > 0 ? namespaces : undefined;
}

function isStandaloneJSDocDeclarationSymbol(symbol) {
  return symbol?.declarations?.some(isStandaloneJSDocDeclarationTag);
}

function createJSDocChecker(compilerSource) {
  const options = {
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  };
  const baseHost = ts.createCompilerHost(options, true);
  const rootPath = ts.sys.resolvePath(compilerSource.fileName);
  const isRoot = (filename) => ts.sys.resolvePath(filename) === rootPath;
  const host = {
    ...baseHost,
    fileExists(filename) {
      return isRoot(filename) || baseHost.fileExists(filename);
    },
    getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile) {
      if (isRoot(filename)) return compilerSource;
      return baseHost.getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
    },
    readFile(filename) {
      return isRoot(filename) ? compilerSource.text : baseHost.readFile(filename);
    },
  };
  const program = ts.createProgram({ rootNames: [compilerSource.fileName], options, host });
  return program.getTypeChecker();
}

function getJSDocNamespaceInfo(compilerSource) {
  const localTypeBindings = new Map();
  const documentationNamespaces = new Map();
  const comments = [];
  let needsChecker = false;

  function collectComment(comment) {
    comments.push(comment);
    function visit(node) {
      if (isStandaloneJSDocDeclarationTag(node) || ts.isJSDocLinkLike(node) || ts.isJSDocSeeTag(node)) {
        needsChecker = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(comment);
  }

  function collectSource(node) {
    for (const comment of node.jsDoc ?? []) collectComment(comment);
    ts.forEachChild(node, collectSource);
  }

  collectSource(compilerSource);
  if (!needsChecker) return { documentationNamespaces, localTypeBindings };
  const checker = createJSDocChecker(compilerSource);

  function addLocalTypeBinding(comment, entity, symbol) {
    if (!isStandaloneJSDocDeclarationSymbol(symbol)) return;
    const name = getEntityRoot(entity);
    if (!name) return;
    const bindings = localTypeBindings.get(comment.pos) ?? new Set();
    bindings.add(name);
    localTypeBindings.set(comment.pos, bindings);
  }

  function addDocumentationNamespaces(comment, entity) {
    const root = getEntityRootNode(entity);
    if (!root) return;
    const namespaces = getSymbolNamespaces(checker, checker.getSymbolAtLocation(root));
    if (!namespaces) return;
    const name = ts.unescapeLeadingUnderscores(root.escapedText);
    const references = documentationNamespaces.get(comment.pos) ?? new Map();
    const existing = references.get(name) ?? new Set();
    for (const namespace of namespaces) existing.add(namespace);
    references.set(name, existing);
    documentationNamespaces.set(comment.pos, references);
  }

  function visitComment(comment) {
    function visit(node) {
      if (ts.isTypeReferenceNode(node)) {
        const root = getEntityRootNode(node.typeName);
        addLocalTypeBinding(comment, root, checker.getSymbolAtLocation(root));
      } else if (ts.isJSDocLinkLike(node)) {
        addDocumentationNamespaces(comment, node.name);
      } else if (ts.isJSDocSeeTag(node)) {
        addDocumentationNamespaces(comment, node.name?.name);
      }
      ts.forEachChild(node, visit);
    }

    visit(comment);
  }

  for (const comment of comments) visitComment(comment);
  return { documentationNamespaces, localTypeBindings };
}

function getAttachedJSDocComments(context) {
  const sourceCode = context.sourceCode;
  const parserOptions = context.languageOptions.parserOptions;
  const filenames = [context.physicalFilename, context.filename, parserOptions.filePath, sourceCode.filename];
  let scriptKind = ts.ScriptKind.Unknown;
  let compilerFilename;

  for (const filename of filenames) {
    if (typeof filename !== 'string') continue;
    const cleanFilename = filename.split(/[?#]/u, 1)[0];
    scriptKind = ts.getScriptKindFromFileName(cleanFilename);
    if (scriptKind !== ts.ScriptKind.Unknown) {
      compilerFilename = cleanFilename;
      break;
    }
    const mode = /(?:\?|&)lang=(tsx?|jsx?)(?:&|$)/iu.exec(filename)?.[1];
    if (mode) {
      scriptKind = ts.getScriptKindFromFileName(`oxlint-jsdoc.${mode}`);
      compilerFilename = `oxlint-jsdoc.${mode}`;
      break;
    }
  }

  if (scriptKind === ts.ScriptKind.Unknown) {
    scriptKind = parserOptions.ecmaFeatures?.jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  }

  if (!compilerFilename) {
    const extension =
      scriptKind === ts.ScriptKind.TSX ? 'tsx' : scriptKind === ts.ScriptKind.JSX ? 'jsx' : 'ts';
    compilerFilename = `oxlint-jsdoc.${extension}`;
  }

  const compilerSource = ts.createSourceFile(
    compilerFilename,
    sourceCode.text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseAll },
    true,
    scriptKind,
  );
  const attached = new Map();

  function visit(node) {
    if (!ts.isEmptyStatement(node)) {
      for (const comment of node.jsDoc ?? []) {
        if (
          node.kind !== ts.SyntaxKind.EndOfFileToken ||
          comment.tags?.some(isStandaloneJSDocDeclarationTag)
        ) {
          attached.set(comment.pos, comment.end);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(compilerSource);
  return { attached, compilerSource };
}

function getJSDocImportUsage(context) {
  const sourceCode = context.sourceCode;
  const used = new Set();
  const { attached, compilerSource } = getAttachedJSDocComments(context);
  if (attached.size === 0) return used;
  const { documentationNamespaces, localTypeBindings } = getJSDocNamespaceInfo(compilerSource);

  for (const comment of sourceCode.getAllComments()) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
    if (attached.get(comment.range[0]) !== comment.range[1]) continue;

    const raw = sourceCode.text.slice(comment.range[0], comment.range[1]);
    const parsed = parseJSDocComment(raw);
    const doc = parsed.comment;
    if (!doc) continue;
    const commentDocumentationNamespaces = documentationNamespaces.get(comment.range[0]);
    const commentLocalTypeBindings = localTypeBindings.get(comment.range[0]);

    const references = new Map();
    const tags = doc.tags ?? [];
    const bindings = new Set();
    const templateBindings = new Set();
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

    collectDocumentationLinks(doc.comment, bindings, references, parsed.text, commentDocumentationNamespaces);

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

      if (ts.isJSDocCallbackTag(originalTag) || ts.isJSDocOverloadTag(originalTag)) {
        documentationTag = undefined;
        collectTypeReferences(originalTag.typeExpression, bindings, references);
        previousTag = originalTag;
        continue;
      }

      if (!TYPE_BEARING_TAGS.has(name) && !REFERENCE_TAGS.has(name)) {
        documentationTag = originalTag;
        collectDocumentationLinks(
          originalTag.comment,
          bindings,
          references,
          parsed.text,
          commentDocumentationNamespaces,
        );
        collectBacktickedDocumentationLinks(
          originalTag,
          bindings,
          references,
          parsed.text,
          commentDocumentationNamespaces,
        );
        previousTag = originalTag;
        continue;
      }

      documentationTag = undefined;
      const tag = templates.get(originalTag) ?? normalizeJSDocTag(originalTag, parsed.text);
      if (!tag) continue;

      if (ts.isJSDocTemplateTag(tag)) {
        collectTypeReferences(tag.constraint, templateBindings, references);
        for (const parameter of tag.typeParameters) {
          collectTypeReferences(parameter.default, templateBindings, references);
          templateBindings.add(ts.unescapeLeadingUnderscores(parameter.name.escapedText));
        }
      } else if (ts.isJSDocSeeTag(tag)) {
        const prefix = parsed.text.slice(
          originalTag.tagName.end,
          originalTag.name?.name?.pos ?? originalTag.name?.pos ?? originalTag.end,
        );
        if (!prefix.includes('{')) {
          const name = getEntityRoot(tag.name?.name);
          addDocumentationReference(
            tag.name?.name,
            bindings,
            references,
            commentDocumentationNamespaces?.get(name),
          );
        }
      } else {
        collectJSDocTagReferences(tag, originalTag, parsed, bindings, references);
      }

      collectDocumentationLinks(
        originalTag.comment,
        bindings,
        references,
        parsed.text,
        commentDocumentationNamespaces,
      );
      collectBacktickedDocumentationLinks(
        originalTag,
        bindings,
        references,
        parsed.text,
        commentDocumentationNamespaces,
      );
      previousTag = originalTag;
    }

    for (const [name, namespaces] of references) {
      for (const namespace of namespaces) {
        if (namespace === 'type' && commentLocalTypeBindings?.has(name)) continue;
        const binding = getJSDocRootBinding(sourceCode, comment, name, namespace);
        if (binding) used.add(binding);
      }
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
    const jsxUsedImports = getJSXImportUsage(context);
    const jsDocUsedImports = getJSDocImportUsage(context);

    return {
      ImportDeclaration(declaration) {
        const unusedSpecifiers = [];
        for (const variable of sourceCode.getDeclaredVariables(declaration)) {
          if (
            variable.references.some((reference) => reference.identifier !== variable.identifiers[0]) ||
            jsxUsedImports.has(variable) ||
            jsDocUsedImports.has(variable)
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
          jsxUsedImports.has(variable) ||
          jsDocUsedImports.has(variable)
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
