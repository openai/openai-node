const ts = require('typescript');
const {
  hasCommentText,
  hasNodeDocumentation,
  isInternal,
  positionalBranch,
} = require('./jsdoc-coverage-syntax.cjs');
const { relativePath } = require('./jsdoc-coverage-compiler.cjs');
const { sourceSymbolAtPath } = require('./jsdoc-coverage-type-system.cjs');

function createCoverageRecords(context) {
  const {
    checker,
    sourceFile,
    originalChecker,
    originalSourceFile,
    originalModule,
    originalProgram,
    handwrittenFiles,
    declarations,
    displayFile,
    sourceMappings,
    semantic,
  } = context;
  const recordedDeclarations = new Map();

  function resolvedSymbol(symbol) {
    return symbol.flags === ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }

  function symbolDocumentation(symbol) {
    if (!symbol) {
      return false;
    }
    return (
      hasCommentText(symbol.getDocumentationComment(checker)) ||
      symbol.getJsDocTags(checker).some((tag) => tag.name !== 'internal' && hasCommentText(tag.text))
    );
  }

  function externalMappedPosition(node, external) {
    const declarationFile = node.getSourceFile();
    const generated = declarationFile.getLineAndCharacterOfPosition(node.getStart(declarationFile));
    let closest;
    for (const mapping of ts.decodeMappings(external.declarationMap?.mappings ?? '')) {
      if (
        mapping.generatedLine === generated.line &&
        mapping.generatedCharacter <= generated.character &&
        mapping.sourceLine !== undefined &&
        mapping.sourceCharacter !== undefined
      ) {
        closest = mapping;
      }
    }
    return {
      file: relativePath(external.originalFile),
      line: (closest?.sourceLine ?? generated.line) + 1,
      column: (closest?.sourceCharacter ?? generated.character) + 1,
    };
  }

  function externalOriginalPosition(node, name) {
    if (node.getSourceFile() === sourceFile) {
      return;
    }

    const external = handwrittenFiles.get(node.getSourceFile().fileName);
    if (!external) {
      return;
    }
    const externalSourceFile = originalProgram.getSourceFile(external.originalFile);
    if (!externalSourceFile) {
      return;
    }

    const originalSymbol =
      !unionBranch(node, false) &&
      originalModule &&
      sourceSymbolAtPath(originalChecker, originalModule, name);
    const originalNode = originalSymbol?.valueDeclaration ?? originalSymbol?.declarations?.[0];
    if (originalNode?.getSourceFile() !== externalSourceFile) {
      return externalMappedPosition(node, external);
    }

    const original = externalSourceFile.getLineAndCharacterOfPosition(
      originalNode.getStart(externalSourceFile),
    );
    return {
      file: relativePath(external.originalFile),
      line: original.line + 1,
      column: original.character + 1,
    };
  }

  function originalPosition(node, name) {
    const external = externalOriginalPosition(node, name);
    if (external) {
      return external;
    }

    const generated = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const mappings = sourceMappings.get(generated.line) ?? [];
    const mapping = mappings.findLast((candidate) => candidate.generatedCharacter <= generated.character);
    const branchSpecific = unionBranch(node, false);
    const originalSymbol =
      !branchSpecific && originalModule && sourceSymbolAtPath(originalChecker, originalModule, name);
    const originalNode = originalSymbol?.valueDeclaration ?? originalSymbol?.declarations?.[0];
    const original =
      originalNode?.getSourceFile() === originalSourceFile
        ? originalSourceFile.getLineAndCharacterOfPosition(originalNode.getStart(originalSourceFile))
        : undefined;

    return {
      line: (original?.line ?? mapping?.sourceLine ?? generated.line) + 1,
      column: (original?.character ?? mapping?.sourceCharacter ?? generated.character) + 1,
    };
  }

  function unionBranch(node, synthetic) {
    const branches = [];
    let child = node;
    let { parent } = child;
    while (parent) {
      const branch = positionalBranch(parent, child);
      if (branch !== undefined) {
        branches.push(branch);
      }
      child = parent;
      ({ parent } = child);
    }
    if (branches.length > 0) {
      return branches.join(':');
    }
    return synthetic || semantic.conditional || semantic.intersection ? semantic.branch : '';
  }

  function declarationPriority(node) {
    if (!node || !ts.isClassDeclaration(node.parent)) {
      return 0;
    }
    return node.getSourceFile() === sourceFile ? 2 : 1;
  }

  function record(node, name, kind, ...symbols) {
    if (isInternal(node)) {
      return;
    }

    const synthetic = symbols[0] === null;
    const statement = ts.isVariableDeclaration(node) ? node.parent?.parent : undefined;
    const documented =
      (!synthetic && (hasNodeDocumentation(node) || (statement && hasNodeDocumentation(statement)))) ||
      symbols.some(symbolDocumentation);
    const key = `${kind}:${name}:${unionBranch(node, synthetic)}`;
    const existing = declarations.get(key);
    if (existing) {
      const previous = recordedDeclarations.get(key);
      const previousPriority = declarationPriority(previous);
      const nextPriority = declarationPriority(node);
      if (previousPriority > nextPriority) {
        return;
      }
      if (nextPriority > previousPriority) {
        const { file = displayFile, line, column } = originalPosition(node, name);
        Object.assign(existing, { file, line, column, documented: Boolean(documented) });
        recordedDeclarations.set(key, node);
        return;
      }
      existing.documented ||= Boolean(documented);
      return;
    }

    const { file = displayFile, line, column } = originalPosition(node, name);
    declarations.set(key, {
      file,
      line,
      column,
      kind,
      name,
      documented: Boolean(documented),
    });
    recordedDeclarations.set(key, node);
  }

  function localSymbol(symbol) {
    return symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile);
  }

  function internalHandwrittenSymbol(symbol) {
    return Boolean(
      symbol?.declarations?.some(
        (declaration) =>
          handwrittenFiles.has(declaration.getSourceFile().fileName) &&
          Boolean(ts.findAncestor(declaration, isInternal)),
      ),
    );
  }

  function internalImport(node) {
    const symbol = node.qualifier && checker.getSymbolAtLocation(node.qualifier);
    return internalHandwrittenSymbol(symbol && resolvedSymbol(symbol));
  }

  return { resolvedSymbol, unionBranch, record, localSymbol, internalHandwrittenSymbol, internalImport };
}

module.exports = { createCoverageRecords };
