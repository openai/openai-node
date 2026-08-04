/** TypeScript symbol analysis for documentation links and local JSDoc declarations. */

const ts = require('typescript');

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
    const root = getEntityRootNode(entity);
    if (!root) return;
    const name = ts.unescapeLeadingUnderscores(root.escapedText);
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

module.exports = { getEntityRootNode, getJSDocNamespaceInfo, isStandaloneJSDocDeclarationTag };
