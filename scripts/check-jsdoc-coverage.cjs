const path = require('node:path');
const ts = require('typescript');
const {
  canonicalName,
  collectSourceFiles,
  compilerOptions,
  createProgram,
  declarationProgram,
  emitDeclarations,
  externalTypeArguments,
  hasCommentText,
  hasNodeDocumentation,
  handwrittenIndexDeclaration,
  instantiateMappedType,
  isInternal,
  isMappedType,
  isVisibleMember,
  mappedArgument,
  memberName,
  positionalBranch,
  sourceSymbolAtPath,
  visibleHandwrittenMember,
} = require('./jsdoc-coverage-compiler.cjs');

const repositoryRoot = path.resolve(__dirname, '..');

function relativePath(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function inspectDeclarations(program, emitted, originalProgram, handwrittenFiles) {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(emitted.fileName);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const originalChecker = originalProgram.getTypeChecker();
  const originalSourceFile = originalProgram.getSourceFile(emitted.originalFile);
  const originalModule = originalChecker.getSymbolAtLocation(originalSourceFile);
  const declarations = new Map();
  const inspected = new Map();
  const activeTypes = new Set();
  const activeValueSymbols = new Set();
  const activeNamespaces = new Set();
  const publicTargets = new Set();
  const displayFile = relativePath(emitted.originalFile);
  const sourceMappings = new Map();
  let semanticUnionBranch = '';
  let semanticConditionalBranch = false;
  let semanticTypeMapper;

  for (const mapping of ts.decodeMappings(emitted.declarationMap?.mappings ?? '')) {
    if (mapping.sourceLine === undefined || mapping.sourceCharacter === undefined) {
      continue;
    }
    const mappings = sourceMappings.get(mapping.generatedLine) ?? [];
    mappings.push(mapping);
    sourceMappings.set(mapping.generatedLine, mappings);
  }

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

    const originalSymbol = originalModule && sourceSymbolAtPath(originalChecker, originalModule, name);
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
    return synthetic || semanticConditionalBranch ? semanticUnionBranch : '';
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

  function inspectReference(node) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) {
      return;
    }

    const target = resolvedSymbol(symbol);
    if (!localSymbol(target) || publicTargets.has(target)) {
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
      inspectSymbol(target, canonicalName(declaration), undefined, 'type');
    }
  }

  function inspectConditionalAlias(symbol) {
    if (!symbol || !localSymbol(symbol) || publicTargets.has(symbol)) {
      return;
    }

    const declaration = symbol.declarations?.find(
      (candidate) => candidate.getSourceFile() === sourceFile && ts.isTypeAliasDeclaration(candidate),
    );
    if (declaration) {
      const owner = canonicalName(declaration);
      record(declaration, owner, 'type', symbol);
      inspectTypeParameters(declaration, owner);
    }
  }

  function inspectTypeReference(node, owner) {
    const type = checker.getTypeAtLocation(node);
    const mapped = isMappedType(type);
    const referenced = checker.getSymbolAtLocation(node.typeName);
    const target = referenced && resolvedSymbol(referenced);
    if (internalHandwrittenSymbol(target)) {
      const declaration = target.declarations?.find((candidate) =>
        handwrittenFiles.has(candidate.getSourceFile().fileName),
      );
      if (declaration) {
        inspectTypeParameters(declaration, owner);
      }
      inspectResolvedType(type, owner, node);
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
    inspectResolvedType(type, owner, node);
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
      const type = checker.getTypeAtLocation(node);
      if (internalHandwrittenSymbol(type.symbol) || internalImport(node)) {
        inspectResolvedType(type, owner, node);
      }
      for (const argument of node.typeArguments ?? []) {
        inspectType(argument, owner);
      }
      return;
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      inspectResolvedType(checker.getTypeAtLocation(node), owner, node);
      return;
    }
    if (ts.isMappedTypeNode(node)) {
      inspectResolvedType(checker.getTypeAtLocation(node), owner, node);
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
      inspectMembers(node.members, owner, 'option');
      return;
    }
    if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
      inspectSignature(node, owner);
      return;
    }

    ts.forEachChild(node, (child) => inspectType(child, owner));
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

  function inspectResolvedSignatures(signatures, owner, anchor, constructor) {
    for (const signature of signatures) {
      const declaration = signature.getDeclaration();
      const handwritten = declaration && handwrittenFiles.has(declaration.getSourceFile().fileName);
      if (handwritten && !isVisibleMember(declaration)) {
        continue;
      }
      const callable = !constructor && handwritten && ts.isCallSignatureDeclaration(declaration);
      let signatureOwner = owner;
      if (constructor) {
        signatureOwner = `${owner}.constructor`;
      } else if (callable) {
        signatureOwner = `${owner}.[call]`;
      }
      if (
        constructor &&
        handwritten &&
        (ts.isConstructorDeclaration(declaration) || ts.isConstructSignatureDeclaration(declaration))
      ) {
        record(declaration, signatureOwner, 'constructor');
      } else if (callable) {
        record(declaration, signatureOwner, 'option');
      }

      if (handwritten) {
        inspectTypeParameters(declaration, signatureOwner);
      }
      for (const parameter of signature.getParameters()) {
        const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration ?? anchor);
        inspectResolvedType(parameterType, `${signatureOwner}.${parameter.getName()}`, declaration ?? anchor);
      }

      const returnOwner = constructor ? owner : `${signatureOwner}.result`;
      inspectResolvedType(signature.getReturnType(), returnOwner, declaration ?? anchor, 'member');
    }
  }

  function inspectResolvedTuple(type, owner, anchor) {
    const elements = checker.getTypeArguments(type);
    const labels = type.target?.labeledElementDeclarations ?? [];
    for (const [index, element] of elements.entries()) {
      inspectResolvedType(element, `${owner}.${index}`, labels[index] ?? anchor);
    }
  }

  function isExternalProjection(anchor) {
    if (!ts.isTypeReferenceNode(anchor)) {
      return false;
    }

    const [argument] = anchor.typeArguments ?? [];
    if (!argument || !ts.isTypeReferenceNode(argument)) {
      return false;
    }

    const symbol = checker.getSymbolAtLocation(argument.typeName);
    return !symbol || !localSymbol(resolvedSymbol(symbol));
  }

  function acceptsExternalMembers(type, anchor, inherited) {
    if (inherited || internalHandwrittenSymbol(type.symbol)) {
      return true;
    }
    if (ts.isImportTypeNode(anchor) && internalImport(anchor)) {
      return true;
    }
    if (!semanticTypeMapper) {
      return false;
    }
    return Boolean(
      type.symbol?.declarations?.some((declaration) =>
        handwrittenFiles.has(declaration.getSourceFile().fileName),
      ),
    );
  }

  function inspectResolvedProperties(type, owner, anchor, kind, staticValue, inheritedOnly = false) {
    const mapped = isMappedType(type);
    const includeExternal = acceptsExternalMembers(type, anchor, inheritedOnly);
    for (const property of checker.getPropertiesOfType(type)) {
      const localDeclaration = visibleHandwrittenMember(
        property,
        sourceFile,
        handwrittenFiles,
        anchor,
        includeExternal,
      );
      const synthetic =
        !localDeclaration && !property.declarations?.length && mapped && !isExternalProjection(anchor);
      if (!localDeclaration && !synthetic) {
        continue;
      }
      if (inheritedOnly && localDeclaration && ts.findAncestor(localDeclaration, (node) => node === anchor)) {
        continue;
      }

      const prefix = staticValue ? 'static.' : '';
      const name = `${owner}.${prefix}${property.getName()}`;
      const declaration = localDeclaration ?? anchor;
      const branch = unionBranch(declaration, synthetic);
      if (
        inheritedOnly &&
        ['member', 'property', 'option'].some((memberKind) =>
          declarations.has(`${memberKind}:${name}:${branch}`),
        )
      ) {
        continue;
      }
      if (synthetic) {
        record(declaration, name, kind, null, property);
      } else {
        record(declaration, name, kind, property);
      }

      const instantiated = checker.getTypeOfSymbolAtLocation(property, anchor);
      inspectResolvedType(instantiated, name, declaration, kind);
    }
  }

  function inspectUnresolvedMapped(type, owner, anchor, indexes) {
    if (indexes.length > 0 || checker.getPropertiesOfType(type).length > 0) {
      return;
    }

    const mappedDeclaration = type.target?.declaration ?? type.declaration;
    if (!mappedDeclaration || !ts.isMappedTypeNode(mappedDeclaration) || !mappedDeclaration.type) {
      return;
    }

    const { constraint } = mappedDeclaration.typeParameter;
    let keyNode = constraint;
    let value = mappedDeclaration.type;
    let key = constraint?.getText(mappedDeclaration.getSourceFile()) ?? 'unknown';
    if (mappedDeclaration.getSourceFile() !== sourceFile) {
      if (!ts.isTypeReferenceNode(anchor)) {
        return;
      }
      const argument = mappedArgument(value, mappedDeclaration, anchor);
      if (!argument) {
        return;
      }
      value = argument;
      if (constraint) {
        keyNode = mappedArgument(constraint, mappedDeclaration, anchor) ?? constraint;
        key = keyNode.getText(keyNode.getSourceFile());
      }
    }

    if (keyNode) {
      const keyType = checker.getTypeAtLocation(keyNode);
      const constraintType = checker.getBaseConstraintOfType(keyType);
      const impossible = [keyType, constraintType].some(
        (candidate) => candidate && Math.trunc(candidate.flags / ts.TypeFlags.Never) % 2 === 1,
      );
      if (impossible) {
        return;
      }
    }

    inspectResolvedType(checker.getTypeAtLocation(value), `${owner}.[key: ${key}]`, value);
  }

  function inspectDeferredConditional(type, owner, kind) {
    if (Math.trunc(type.flags / ts.TypeFlags.Conditional) % 2 !== 1) {
      return false;
    }

    const conditional = type.root?.node;
    if (
      !conditional ||
      !ts.isConditionalTypeNode(conditional) ||
      !handwrittenFiles.has(conditional.getSourceFile().fileName)
    ) {
      return false;
    }

    const previousBranch = semanticUnionBranch;
    const previousConditional = semanticConditionalBranch;
    const previousMapper = semanticTypeMapper;
    semanticConditionalBranch = true;
    semanticTypeMapper = previousMapper ? { mapper1: type.mapper, mapper2: previousMapper } : type.mapper;
    try {
      for (const [index, branch] of [conditional.trueType, conditional.falseType].entries()) {
        semanticUnionBranch = `${previousBranch}:${conditional.pos}:${index}`;
        const branchType = instantiateMappedType(checker.getTypeAtLocation(branch), type.mapper);
        inspectResolvedType(branchType, owner, branch, kind);
      }
    } finally {
      semanticUnionBranch = previousBranch;
      semanticConditionalBranch = previousConditional;
      semanticTypeMapper = previousMapper;
    }
    return true;
  }

  function inspectResolvedType(type, owner, anchor, kind = 'option') {
    const mapped = instantiateMappedType(type, semanticTypeMapper);
    if (mapped !== type) {
      inspectResolvedType(mapped, owner, anchor, kind);
      return;
    }
    if (!type || activeTypes.has(type)) {
      return;
    }
    activeTypes.add(type);

    try {
      if (type.isUnion()) {
        const previousBranch = semanticUnionBranch;
        for (const branch of type.types) {
          semanticUnionBranch = `${previousBranch}:${branch.id}`;
          inspectResolvedType(branch, owner, anchor, kind);
        }
        semanticUnionBranch = previousBranch;
        return;
      }

      if (checker.isTupleType(type)) {
        inspectResolvedTuple(type, owner, anchor);
        return;
      }

      if (inspectDeferredConditional(type, owner, kind)) {
        return;
      }

      for (const argument of externalTypeArguments(checker, type, handwrittenFiles)) {
        inspectResolvedType(argument, owner, anchor, kind);
      }

      const indexes = checker.getIndexInfosOfType(type);
      for (const index of indexes) {
        const declaration = handwrittenIndexDeclaration(checker, index, anchor, handwrittenFiles);
        if (declaration && !isVisibleMember(declaration)) {
          continue;
        }
        const name = declaration
          ? memberName(declaration, declaration.getSourceFile())
          : `[key: ${checker.typeToString(index.keyType)}]`;
        const indexOwner = `${owner}.${name}`;
        if (declaration) {
          record(declaration, indexOwner, kind);
        }
        inspectResolvedType(index.type, indexOwner, anchor, kind);
      }

      inspectUnresolvedMapped(type, owner, anchor, indexes);

      const constructors = type.getConstructSignatures();
      inspectResolvedSignatures(type.getCallSignatures(), owner, anchor, false);
      inspectResolvedSignatures(constructors, owner, anchor, true);
      inspectResolvedProperties(type, owner, anchor, kind, constructors.length > 0);
    } finally {
      activeTypes.delete(type);
    }
  }

  function inspectTypeQuery(node, owner) {
    const symbol = checker.getSymbolAtLocation(node.exprName);
    if (!symbol) {
      return;
    }

    const target = resolvedSymbol(symbol);
    const internal = internalHandwrittenSymbol(target);
    if (!localSymbol(target) && !internal) {
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
        inspectResolvedType(type, owner, declaration);
      }
    } finally {
      activeValueSymbols.delete(target);
    }
  }

  function inspectSignature(node, owner) {
    for (const parameter of node.parameters ?? []) {
      inspectType(parameter.type, `${owner}.${parameter.name.getText(parameter.getSourceFile())}`);
    }
    inspectTypeParameters(node, owner);
    inspectType(node.type, `${owner}.result`);
  }

  function inspectTypeParameters(node, owner) {
    for (const parameter of node.typeParameters ?? []) {
      const parameterName = `${owner}.${parameter.name.getText(parameter.getSourceFile())}`;
      inspectType(parameter.constraint, parameterName);
      inspectType(parameter.default, parameterName);
    }
  }

  function inspectMembers(members, owner, kind) {
    for (const member of members) {
      if (!isVisibleMember(member)) {
        continue;
      }

      const staticPrefix =
        ts.canHaveModifiers(member) &&
        (ts.getModifiers(member) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
          ? 'static.'
          : '';
      const name = `${owner}.${staticPrefix}${memberName(member, member.getSourceFile())}`;
      record(member, name, ts.isConstructorDeclaration(member) ? 'constructor' : kind);

      if (
        ts.isPropertySignature(member) ||
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member)
      ) {
        inspectType(member.type, name);
      } else {
        inspectSignature(member, name);
      }
    }
  }

  function inspectClassLikeValue(type, owner) {
    for (const member of type.members) {
      if (!isVisibleMember(member)) {
        continue;
      }
      if (ts.isConstructSignatureDeclaration(member)) {
        const constructorName = `${owner}.constructor`;
        record(member, constructorName, 'constructor');
        for (const parameter of member.parameters) {
          inspectType(
            parameter.type,
            `${constructorName}.${parameter.name.getText(parameter.getSourceFile())}`,
          );
        }
        inspectType(member.type, owner);
      } else {
        inspectMembers([member], `${owner}.static`, 'member');
      }
    }
  }

  function inspectHeritage(node) {
    for (const clause of node.heritageClauses ?? []) {
      for (const inherited of clause.types) {
        inspectReference(inherited.expression);
        const inheritedType = checker.getTypeAtLocation(inherited);
        if (isMappedType(inheritedType)) {
          inspectResolvedType(inheritedType, canonicalName(node), inherited);
          inspectMappedArguments(inherited.typeArguments ?? [], canonicalName(node));
          continue;
        }
        for (const argument of inherited.typeArguments ?? []) {
          inspectType(argument, canonicalName(node));
        }
      }
    }
  }

  function inspectInheritedClass(symbol, node, owner) {
    const instance = checker.getDeclaredTypeOfSymbol(symbol);
    const constructor = checker.getTypeOfSymbolAtLocation(symbol, node);
    inspectResolvedProperties(instance, owner, node, 'member', false, true);
    inspectResolvedProperties(constructor, owner, node, 'member', true, true);
  }

  function inspectNode(node, symbol, owner, exportSymbol, kind) {
    if (isInternal(node)) {
      return;
    }

    const declarationKind = ts.isModuleDeclaration(node) ? 'namespace' : kind;
    record(node, owner, declarationKind, exportSymbol, symbol);

    if (ts.isModuleDeclaration(node)) {
      inspectExports(symbol, `${owner}.`);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      inspectTypeParameters(node, owner);
      inspectHeritage(node);
      inspectMembers(node.members, owner, ts.isClassDeclaration(node) ? 'member' : 'property');
      if (ts.isClassDeclaration(node)) {
        inspectInheritedClass(symbol, node, owner);
      } else {
        const inherited = checker.getDeclaredTypeOfSymbol(symbol);
        inspectResolvedProperties(inherited, owner, node, 'property', false, true);
      }
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      inspectMembers(node.members, owner, 'member');
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      inspectTypeParameters(node, owner);
      inspectType(node.type, owner);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      inspectSignature(node, owner);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const isClassLike =
        node.type &&
        ts.isTypeLiteralNode(node.type) &&
        node.type.members.some(ts.isConstructSignatureDeclaration);
      if (isClassLike) {
        inspectClassLikeValue(node.type, owner);
      } else {
        inspectType(node.type, owner);
      }
    }
  }

  function inspectSymbol(symbol, owner, exportSymbol, kind = 'export') {
    const owners = inspected.get(symbol) ?? new Set();
    if (owners.has(owner)) {
      return;
    }
    owners.add(owner);
    inspected.set(symbol, owners);

    for (const declaration of symbol.declarations ?? []) {
      if (declaration.getSourceFile() === sourceFile) {
        inspectNode(declaration, symbol, owner, exportSymbol, kind);
      }
    }
  }

  function inspectExports(namespace, prefix = '') {
    const exports = checker.getExportsOfModule(namespace);
    for (const exported of exports) {
      const target = resolvedSymbol(exported);
      if (localSymbol(target)) {
        publicTargets.add(target);
      }
    }

    for (const exported of exports) {
      const target = resolvedSymbol(exported);
      const owner = `${prefix}${exported.getName()}`;
      if (localSymbol(target)) {
        inspectSymbol(target, owner, exported);
      } else if (internalHandwrittenSymbol(target)) {
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
      record(alias, owner, 'export', exported);
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

    inspectTypeParameters(declaration, owner);
    const type =
      ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration);
    inspectResolvedType(type, owner, declaration);
  }

  function inspectGlobalDeclaration(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const symbol = checker.getSymbolAtLocation(declaration.name);
          if (symbol && localSymbol(symbol)) {
            inspectSymbol(symbol, declaration.name.text);
          }
        }
      }
      return;
    }

    if (!node.name) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(node.name);
    if (symbol && localSymbol(symbol)) {
      inspectSymbol(symbol, node.name.text);
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
    const target = resolvedSymbol(exportAssignment);
    const declaration = target.declarations?.find((candidate) => candidate.getSourceFile() === sourceFile);
    if (declaration) {
      publicTargets.add(target);
      inspectSymbol(target, canonicalName(declaration), exportAssignment);
    } else if (internalHandwrittenSymbol(target)) {
      const external = target.valueDeclaration ?? target.declarations?.[0];
      if (external) {
        inspectInternalExport(target, canonicalName(external), exportAssignment);
      }
    }
    return true;
  }

  if (moduleSymbol && !inspectExportAssignment(moduleSymbol)) {
    inspectExports(moduleSymbol);
  }
  inspectAmbientDeclarations();
  return [...declarations.values()];
}

function inspectFiles(files, focusFile, virtualSources = new Map()) {
  const options = compilerOptions(virtualSources.size > 0);
  const sourceProgram = createProgram(files, virtualSources, options);
  const emitted = emitDeclarations(sourceProgram, files);
  const publicProgram = declarationProgram(emitted);
  const handwrittenFiles = new Map(emitted.map((declaration) => [declaration.fileName, declaration]));

  const declarations = emitted
    .filter((declaration) => !focusFile || declaration.originalFile === focusFile)
    .flatMap((declaration) =>
      inspectDeclarations(publicProgram, declaration, sourceProgram, handwrittenFiles),
    );
  const unique = new Map();
  for (const declaration of declarations) {
    const key = [
      declaration.file,
      declaration.kind,
      declaration.name,
      declaration.line,
      declaration.column,
    ].join(':');
    const existing = unique.get(key);
    if (existing) {
      existing.documented ||= declaration.documented;
    } else {
      unique.set(key, declaration);
    }
  }
  return [...unique.values()];
}

function inspectSource(file, text, dependencies = {}) {
  const sourceFile = path.resolve(repositoryRoot, file);
  const virtualSources = new Map([[sourceFile, text]]);
  for (const [dependency, source] of Object.entries(dependencies)) {
    virtualSources.set(path.resolve(repositoryRoot, dependency), source);
  }
  return inspectFiles([...virtualSources.keys()], sourceFile, virtualSources);
}

function collectCoverage() {
  const files = collectSourceFiles(path.join(repositoryRoot, 'src'));
  const declarations = inspectFiles(files);
  return {
    files: files.length,
    declarations,
    undocumented: declarations.filter((declaration) => !declaration.documented),
  };
}

if (require.main === module) {
  const { files, declarations, undocumented } = collectCoverage();

  if (undocumented.length > 0) {
    for (const declaration of undocumented) {
      console.error(
        `${declaration.file}:${declaration.line}:${declaration.column}: undocumented ${declaration.kind} ${declaration.name}`,
      );
    }
    console.error(
      `JSDoc coverage: ${declarations.length - undocumented.length}/${declarations.length} handwritten SDK declarations across ${files} files.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `JSDoc coverage: ${declarations.length}/${declarations.length} declarations across ${files} handwritten SDK files.`,
    );
  }
}

module.exports = { collectCoverage, inspectSource };
