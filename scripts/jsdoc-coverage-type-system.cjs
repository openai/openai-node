const ts = require('typescript');

const { isVisibleMember } = require('./jsdoc-coverage-syntax.cjs');

function isMappedType(type) {
  return Math.trunc((type.objectFlags ?? 0) / ts.ObjectFlags.Mapped) % 2 === 1;
}

function composedMapper(first, second) {
  if (!first) {
    return second;
  }
  return second ? { mapper1: first, mapper2: second } : first;
}

function referencesTypeParameter(checker, node, parameter) {
  if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === parameter) {
    return true;
  }
  return ts.forEachChild(node, (child) => referencesTypeParameter(checker, child, parameter)) ?? false;
}

function callableTypeArguments(checker, type, arguments_) {
  const exposed = new Set();
  for (const declaration of type.symbol?.declarations ?? []) {
    const parameters = declaration.typeParameters ?? [];
    for (const member of declaration.members ?? []) {
      if (!isVisibleMember(member) || !ts.isFunctionLike(member)) {
        continue;
      }
      const signature = [...(member.typeParameters ?? []), ...(member.parameters ?? []), member.type].filter(
        Boolean,
      );
      for (const [index, parameter] of parameters.entries()) {
        const symbol = checker.getSymbolAtLocation(parameter.name);
        if (symbol && signature.some((node) => referencesTypeParameter(checker, node, symbol))) {
          exposed.add(index);
        }
      }
    }
  }
  return [...exposed].map((index) => ({ type: arguments_[index] }));
}

function inheritedTypeArguments(checker, type, arguments_, handwrittenFiles, active) {
  const inherited = [];
  for (const declaration of type.symbol?.declarations ?? []) {
    const sources = (declaration.typeParameters ?? []).map((parameter) =>
      checker.getTypeAtLocation(parameter),
    );
    const mapper = { sources, targets: arguments_ };
    for (const clause of declaration.heritageClauses ?? []) {
      for (const heritage of clause.types) {
        const base = checker.getTypeAtLocation(heritage);
        const unresolved = Math.trunc(base.flags / ts.TypeFlags.Any) % 2 === 1;
        const visible = unresolved
          ? (heritage.typeArguments ?? []).map((argument) => ({ type: checker.getTypeAtLocation(argument) }))
          : externalTypeArguments(checker, base, handwrittenFiles, active);
        for (const argument of visible) {
          inherited.push({ type: argument.type, mapper: composedMapper(argument.mapper, mapper) });
        }
      }
    }
  }
  return inherited;
}

function externalTypeArguments(checker, type, handwrittenFiles, active = new Set()) {
  if (!type || active.has(type)) {
    return [];
  }
  active.add(type);
  try {
    if (type.isIntersection()) {
      return type.types.flatMap((constituent) =>
        externalTypeArguments(checker, constituent, handwrittenFiles, active),
      );
    }
    const reference = Math.trunc((type.objectFlags ?? 0) / ts.ObjectFlags.Reference) % 2 === 1;
    if (!reference || checker.isArrayType(type) || checker.isTupleType(type)) {
      return [];
    }
    const arguments_ = checker.getTypeArguments(type);
    const handwritten = type.symbol?.declarations?.some((declaration) =>
      handwrittenFiles.has(declaration.getSourceFile().fileName),
    );
    if (!handwritten) {
      return arguments_.map((argument) => ({ type: argument }));
    }
    const own = checker
      .getPropertiesOfType(type)
      .some((property) =>
        property.declarations?.some((declaration) =>
          handwrittenFiles.has(declaration.getSourceFile().fileName),
        ),
      );
    return own
      ? [
          ...callableTypeArguments(checker, type, arguments_),
          ...inheritedTypeArguments(checker, type, arguments_, handwrittenFiles, active),
        ]
      : arguments_.map((argument) => ({ type: argument }));
  } finally {
    active.delete(type);
  }
}

function mappedArgument(node, mappedDeclaration, anchor) {
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) {
    return;
  }
  const alias = ts.findAncestor(mappedDeclaration, ts.isTypeAliasDeclaration);
  const index = alias?.typeParameters?.findIndex((parameter) => parameter.name.text === node.typeName.text);
  if (index === undefined || index < 0) {
    return;
  }
  return anchor.typeArguments?.[index];
}

function handwrittenIndexDeclaration(checker, index, anchor, handwrittenFiles) {
  const direct = index.declaration;
  if (
    direct &&
    ts.isIndexSignatureDeclaration(direct) &&
    handwrittenFiles.has(direct.getSourceFile().fileName)
  ) {
    return direct;
  }
  let current = anchor;
  while (ts.isTypeReferenceNode(current) || ts.isMappedTypeNode(current)) {
    const constraint = ts.isMappedTypeNode(current) ? current.typeParameter.constraint : undefined;
    const source =
      constraint && ts.isTypeOperatorNode(constraint) ? constraint.type : current.typeArguments?.[0];
    if (!source) {
      return;
    }
    const original = checker
      .getIndexInfosOfType(checker.getTypeAtLocation(source))
      .find(
        (candidate) =>
          candidate.declaration &&
          ts.isIndexSignatureDeclaration(candidate.declaration) &&
          handwrittenFiles.has(candidate.declaration.getSourceFile().fileName) &&
          checker.isTypeAssignableTo(index.keyType, candidate.keyType),
      );
    if (original) {
      return original.declaration;
    }
    current = source;
  }
}

function visibleHandwrittenMember(property, sourceFile, handwrittenFiles, anchor, includeExternal) {
  return property.declarations?.find((declaration) => {
    if (!isVisibleMember(declaration)) {
      return false;
    }
    const declarationFile = declaration.getSourceFile();
    return (
      declarationFile === sourceFile ||
      (handwrittenFiles.has(declarationFile.fileName) &&
        (includeExternal || declarationFile === anchor.getSourceFile()))
    );
  });
}

function sourceSymbolType(checker, symbol) {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) {
    return;
  }
  return ts.isClassDeclaration(declaration) ||
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration)
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : checker.getTypeOfSymbolAtLocation(symbol, declaration);
}

function sourceSymbolAtPath(checker, moduleSymbol, name) {
  const [root, ...segments] = name.split('.');
  let symbol = checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.getName() === root);
  if (!symbol) {
    return;
  }
  if (symbol.flags === ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  let type = sourceSymbolType(checker, symbol);
  for (const segment of segments) {
    if (!type) {
      return;
    }
    if (segment === 'result') {
      type = type.getCallSignatures()[0]?.getReturnType();
      continue;
    }
    if (segment === 'static') {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      type = declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
      continue;
    }
    const property = checker.getPropertyOfType(type, segment);
    const parameter = type
      .getCallSignatures()[0]
      ?.getParameters()
      .find((candidate) => candidate.getName() === segment);
    symbol = property ?? parameter;
    if (!symbol) {
      return;
    }
    type = sourceSymbolType(checker, symbol);
  }
  return symbol;
}

function instantiateMappedType(type, mapper) {
  if (!mapper) {
    return type;
  }
  if (mapper.sources) {
    const index = mapper.sources.indexOf(type);
    if (index === -1) {
      return type;
    }
    const target = mapper.targets?.[index];
    return typeof target === 'function' ? target() : (target ?? type);
  }
  if (mapper.source) {
    return type === mapper.source ? mapper.target : type;
  }
  if (mapper.mapper1 && mapper.mapper2) {
    return instantiateMappedType(instantiateMappedType(type, mapper.mapper1), mapper.mapper2);
  }
  return mapper.func ? mapper.func(type) : type;
}

module.exports = {
  externalTypeArguments,
  handwrittenIndexDeclaration,
  instantiateMappedType,
  isMappedType,
  mappedArgument,
  sourceSymbolAtPath,
  visibleHandwrittenMember,
};
