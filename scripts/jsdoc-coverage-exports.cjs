const ts = require('typescript');
const { canonicalName, isInternal } = require('./jsdoc-coverage-syntax.cjs');

function createCoverageExports(context) {
  const { checker, sourceFile, moduleSymbol, handwrittenFiles, activeNamespaces, publicTargets } = context;

  function inspectExports(namespace, prefix = '') {
    const exports = checker.getExportsOfModule(namespace);
    for (const exported of exports) {
      const target = context.resolvedSymbol(exported);
      if (context.localSymbol(target)) {
        publicTargets.add(target);
      }
    }

    for (const exported of exports) {
      const target = context.resolvedSymbol(exported);
      const owner = `${prefix}${exported.getName()}`;
      if (context.localSymbol(target)) {
        context.inspectSymbol(target, owner, exported);
      } else if (context.internalHandwrittenSymbol(target)) {
        inspectInternalExport(target, owner, exported);
      } else if (exported.declarations?.some(ts.isNamespaceExport)) {
        inspectNamespaceModule(target, owner);
      }
    }
  }

  function inspectNamespaceModule(symbol, owner) {
    const handwritten = symbol.declarations?.some((declaration) =>
      handwrittenFiles.has(declaration.getSourceFile().fileName),
    );
    if (!handwritten || activeNamespaces.has(symbol)) {
      return;
    }
    activeNamespaces.add(symbol);
    try {
      inspectExports(symbol, `${owner}.`);
    } finally {
      activeNamespaces.delete(symbol);
    }
  }

  function inspectInternalExport(symbol, owner, exported) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration || !handwrittenFiles.has(declaration.getSourceFile().fileName)) {
      return;
    }

    const alias = exported.declarations?.find((candidate) => candidate.getSourceFile() === sourceFile);
    if (alias && !isInternal(alias)) {
      context.record(alias, owner, 'export', exported);
    }
    if (ts.isModuleDeclaration(declaration)) {
      if (activeNamespaces.has(symbol)) {
        return;
      }
      activeNamespaces.add(symbol);
      try {
        inspectExports(symbol, `${owner}.`);
      } finally {
        activeNamespaces.delete(symbol);
      }
      return;
    }

    context.inspectTypeParameters(declaration, owner);
    const type =
      ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration);
    context.inspectResolvedType(type, owner, declaration);
  }

  function inspectGlobalDeclaration(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const symbol = checker.getSymbolAtLocation(declaration.name);
          if (symbol && context.localSymbol(symbol)) {
            context.inspectSymbol(symbol, declaration.name.text);
          }
        }
      }
      return;
    }

    if (!node.name) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(node.name);
    if (symbol && context.localSymbol(symbol)) {
      context.inspectSymbol(symbol, node.name.text);
    }
  }

  function inspectAmbientDeclarations() {
    const globalScript = !ts.isExternalModule(sourceFile);
    for (const statement of sourceFile.statements) {
      if (ts.isModuleDeclaration(statement) && ts.isAmbientModule(statement)) {
        const symbol = checker.getSymbolAtLocation(statement.name);
        if (symbol && !isInternal(statement)) {
          const name = ts.isGlobalScopeAugmentation(statement) ? 'global' : statement.name.text;
          if (!inspectExportAssignment(symbol)) {
            inspectExports(symbol, `${name}.`);
          }
        }
      } else if (globalScript) {
        inspectGlobalDeclaration(statement);
      }
    }
  }

  function inspectExportAssignment(namespace) {
    const exportAssignment = namespace?.exports?.get(ts.InternalSymbolName.ExportEquals);
    if (!exportAssignment) {
      return false;
    }
    const target = context.resolvedSymbol(exportAssignment);
    const declaration = target.declarations?.find((candidate) => candidate.getSourceFile() === sourceFile);
    if (declaration) {
      publicTargets.add(target);
      context.inspectSymbol(target, canonicalName(declaration), exportAssignment);
    } else if (context.internalHandwrittenSymbol(target)) {
      const external = target.valueDeclaration ?? target.declarations?.[0];
      if (external) {
        inspectInternalExport(target, canonicalName(external), exportAssignment);
      }
    }
    return true;
  }

  function inspectSurface() {
    if (moduleSymbol && !inspectExportAssignment(moduleSymbol)) {
      inspectExports(moduleSymbol);
    }
    inspectAmbientDeclarations();
    return [...context.declarations.values()];
  }

  return { inspectExports, inspectSurface };
}

module.exports = { createCoverageExports };
