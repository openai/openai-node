const ts = require('typescript');
const { canonicalName, isVisibleMember } = require('./jsdoc-coverage-syntax.cjs');
const { isMappedType } = require('./jsdoc-coverage-type-system.cjs');

function createCoverageTypes(context) {
  const { checker, sourceFile, handwrittenFiles, activeValueSymbols, publicTargets } = context;

  function inspectReference(node) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) {
      return;
    }

    const target = context.resolvedSymbol(symbol);
    if (!context.localSymbol(target) || publicTargets.has(target)) {
      return;
    }

    const declaration = target.declarations?.find(
      (candidate) =>
        candidate.getSourceFile() === sourceFile &&
        (ts.isClassDeclaration(candidate) ||
          ts.isInterfaceDeclaration(candidate) ||
          ts.isTypeAliasDeclaration(candidate) ||
          ts.isEnumDeclaration(candidate)),
    );
    if (declaration) {
      context.inspectSymbol(target, canonicalName(declaration), undefined, 'type');
    }
  }

  function inspectConditionalAlias(symbol) {
    if (!symbol || !context.localSymbol(symbol) || publicTargets.has(symbol)) {
      return;
    }

    const declaration = symbol.declarations?.find(
      (candidate) => candidate.getSourceFile() === sourceFile && ts.isTypeAliasDeclaration(candidate),
    );
    if (declaration) {
      const owner = canonicalName(declaration);
      context.record(declaration, owner, 'type', symbol);
      context.inspectTypeParameters(declaration, owner);
    }
  }

  function inspectTypeReference(node, owner) {
    const type = checker.getTypeAtLocation(node);
    const mapped = isMappedType(type);
    const referenced = checker.getSymbolAtLocation(node.typeName);
    const target = referenced && context.resolvedSymbol(referenced);
    if (context.internalHandwrittenSymbol(target)) {
      const declaration = target.declarations?.find((candidate) =>
        handwrittenFiles.has(candidate.getSourceFile().fileName),
      );
      if (declaration) {
        context.inspectTypeParameters(declaration, owner);
      }
      context.inspectResolvedType(type, owner, node);
      return true;
    }
    const conditional = target?.declarations?.some(
      (declaration) => ts.isTypeAliasDeclaration(declaration) && ts.isConditionalTypeNode(declaration.type),
    );
    const deferred = Math.trunc(type.flags / ts.TypeFlags.Conditional) % 2 === 1;
    if (!conditional || deferred || !node.typeArguments?.length) {
      inspectReference(node.typeName);
    } else {
      inspectConditionalAlias(target);
    }
    const projection = mapped || (conditional && type.intrinsicName !== 'error');
    if (!projection || !node.typeArguments?.length) {
      return false;
    }
    context.inspectResolvedType(type, owner, node);
    if (mapped) {
      inspectMappedArguments(node.typeArguments, owner);
    }
    return true;
  }

  function inspectType(node, owner) {
    if (!node) {
      return;
    }

    if (ts.isTypeReferenceNode(node) && inspectTypeReference(node, owner)) {
      return;
    }
    if (ts.isImportTypeNode(node)) {
      inspectImportType(node, owner);
      return;
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      context.inspectResolvedType(checker.getTypeAtLocation(node), owner, node);
      return;
    }
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
      return;
    }
    if (ts.isMappedTypeNode(node)) {
      context.inspectResolvedType(checker.getTypeAtLocation(node), owner, node);
      return;
    }
    if (ts.isTypeQueryNode(node)) {
      inspectTypeQuery(node, owner);
      return;
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      inspectReference(node.expression);
    }
    if (ts.isTypeLiteralNode(node)) {
      context.inspectMembers(node.members, owner, 'option');
      return;
    }
    if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
      context.inspectSignature(node, owner);
      return;
    }
    if (ts.isIntersectionTypeNode(node)) {
      inspectIntersection(node, owner);
      return;
    }

    ts.forEachChild(node, (child) => inspectType(child, owner));
  }

  function inspectImportType(node, owner) {
    const type = checker.getTypeAtLocation(node);
    const mapped = isMappedType(type);
    if (mapped || context.internalHandwrittenSymbol(type.symbol) || context.internalImport(node)) {
      context.inspectResolvedType(type, owner, node);
    }
    if (mapped) {
      inspectMappedArguments(node.typeArguments ?? [], owner);
      return;
    }
    for (const argument of node.typeArguments ?? []) {
      inspectType(argument, owner);
    }
  }

  function inspectIntersection(node, owner) {
    for (const [index, constituent] of node.types.entries()) {
      const type = checker.getTypeAtLocation(constituent);
      const callable = type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
      if (!callable) {
        inspectType(constituent, owner);
        continue;
      }

      const previousBranch = context.semantic.branch;
      const previousIntersection = context.semantic.intersection;
      context.semantic.branch = `${previousBranch}:${node.pos}:${index}`;
      context.semantic.intersection = true;
      try {
        inspectType(constituent, owner);
      } finally {
        context.semantic.branch = previousBranch;
        context.semantic.intersection = previousIntersection;
      }
    }
  }

  function inspectMappedArguments(nodes, owner) {
    for (const node of nodes) {
      if (ts.isMappedTypeNode(node)) {
        inspectType(node.type, owner);
      } else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
        inspectMappedArguments(node.types, owner);
      } else if (ts.isParenthesizedTypeNode(node)) {
        inspectMappedArguments([node.type], owner);
      }
    }
  }

  function inspectTypeQuery(node, owner) {
    const symbol = checker.getSymbolAtLocation(node.exprName);
    if (!symbol) {
      return;
    }

    const target = context.resolvedSymbol(symbol);
    const internal = context.internalHandwrittenSymbol(target);
    if (!context.localSymbol(target) && !internal) {
      return;
    }
    if (activeValueSymbols.has(target)) {
      return;
    }

    activeValueSymbols.add(target);
    try {
      for (const declaration of target.declarations ?? []) {
        const handwritten = handwrittenFiles.has(declaration.getSourceFile().fileName);
        if (!handwritten || (!internal && !isVisibleMember(declaration))) {
          continue;
        }

        const type = checker.getTypeOfSymbolAtLocation(target, declaration);
        context.inspectResolvedType(type, owner, declaration);
      }
    } finally {
      activeValueSymbols.delete(target);
    }
  }

  return { inspectReference, inspectType, inspectMappedArguments };
}

module.exports = { createCoverageTypes };
