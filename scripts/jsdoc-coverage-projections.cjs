const ts = require('typescript');
const {
  externalTypeArguments,
  handwrittenIndexDeclaration,
  instantiateMappedType,
  isMappedType,
  mappedArgument,
  visibleHandwrittenMember,
} = require('./jsdoc-coverage-type-system.cjs');
const { isVisibleMember, memberName } = require('./jsdoc-coverage-syntax.cjs');

function createCoverageProjections(context) {
  const { checker, sourceFile, handwrittenFiles, declarations, activeTypes, semantic } = context;

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
        context.record(declaration, signatureOwner, 'constructor');
      } else if (callable) {
        context.record(declaration, signatureOwner, 'option');
      }

      if (handwritten) {
        context.inspectTypeParameters(declaration, signatureOwner);
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
    return !symbol || !context.localSymbol(context.resolvedSymbol(symbol));
  }

  function acceptsExternalMembers(type, anchor, inherited) {
    if (inherited || context.internalHandwrittenSymbol(type.symbol) || context.localSymbol(type.symbol)) {
      return true;
    }
    if (
      isMappedType(type) &&
      checker.getPropertiesOfType(type).some((property) => context.internalHandwrittenSymbol(property))
    ) {
      return true;
    }
    if (ts.isImportTypeNode(anchor) && context.internalImport(anchor)) {
      return true;
    }
    if (!semantic.mapper) {
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
      const branch = context.unionBranch(declaration, synthetic);
      if (
        inheritedOnly &&
        ['member', 'property', 'option'].some((memberKind) =>
          declarations.has(`${memberKind}:${name}:${branch}`),
        )
      ) {
        const instantiated = checker.getTypeOfSymbolAtLocation(property, anchor);
        inspectResolvedType(instantiated, name, declaration, kind);
        continue;
      }
      if (synthetic) {
        context.record(declaration, name, kind, null, property);
      } else {
        context.record(declaration, name, kind, property);
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

    const previousBranch = semantic.branch;
    const previousConditional = semantic.conditional;
    const previousMapper = semantic.mapper;
    semantic.conditional = true;
    semantic.mapper = previousMapper ? { mapper1: type.mapper, mapper2: previousMapper } : type.mapper;
    try {
      for (const [index, branch] of [conditional.trueType, conditional.falseType].entries()) {
        semantic.branch = `${previousBranch}:${conditional.pos}:${index}`;
        const branchType = instantiateMappedType(checker.getTypeAtLocation(branch), type.mapper);
        inspectResolvedType(branchType, owner, branch, kind);
      }
    } finally {
      semantic.branch = previousBranch;
      semantic.conditional = previousConditional;
      semantic.mapper = previousMapper;
    }
    return true;
  }

  function inspectResolvedType(type, owner, anchor, kind = 'option') {
    const mapped = instantiateMappedType(type, semantic.mapper);
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
        const previousBranch = semantic.branch;
        for (const branch of type.types) {
          semantic.branch = `${previousBranch}:${branch.id}`;
          inspectResolvedType(branch, owner, anchor, kind);
        }
        semantic.branch = previousBranch;
        return;
      }

      if (checker.isTupleType(type)) {
        inspectResolvedTuple(type, owner, anchor);
        return;
      }

      if (inspectDeferredConditional(type, owner, kind)) {
        return;
      }

      for (const { type: argument, mapper } of externalTypeArguments(checker, type, handwrittenFiles)) {
        const previousMapper = semantic.mapper;
        semantic.mapper =
          mapper && previousMapper
            ? { mapper1: mapper, mapper2: previousMapper }
            : (mapper ?? previousMapper);
        try {
          inspectResolvedType(argument, owner, anchor, kind);
        } finally {
          semantic.mapper = previousMapper;
        }
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
          context.record(declaration, indexOwner, kind);
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

  return { inspectResolvedProperties, inspectResolvedType };
}

module.exports = { createCoverageProjections };
