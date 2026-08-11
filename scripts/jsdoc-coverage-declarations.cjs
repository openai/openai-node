const ts = require('typescript');
const { canonicalName, isInternal, isVisibleMember, memberName } = require('./jsdoc-coverage-syntax.cjs');
const { isMappedType } = require('./jsdoc-coverage-type-system.cjs');

function createCoverageDeclarations(context) {
  const { checker, sourceFile, inspected } = context;

  function inspectSignature(node, owner) {
    for (const parameter of node.parameters ?? []) {
      context.inspectType(parameter.type, `${owner}.${parameter.name.getText(parameter.getSourceFile())}`);
    }
    inspectTypeParameters(node, owner);
    context.inspectType(node.type, `${owner}.result`);
  }

  function inspectTypeParameters(node, owner) {
    for (const parameter of node.typeParameters ?? []) {
      const parameterName = `${owner}.${parameter.name.getText(parameter.getSourceFile())}`;
      context.inspectType(parameter.constraint, parameterName);
      context.inspectType(parameter.default, parameterName);
    }
  }

  function inspectMembers(members, owner, kind, instanceOnly = false) {
    for (const member of members) {
      if (!isVisibleMember(member)) {
        continue;
      }

      const staticPrefix =
        ts.canHaveModifiers(member) &&
        (ts.getModifiers(member) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
          ? 'static.'
          : '';
      if (instanceOnly && (ts.isConstructorDeclaration(member) || staticPrefix)) {
        continue;
      }
      const name = `${owner}.${staticPrefix}${memberName(member, member.getSourceFile())}`;
      context.record(member, name, ts.isConstructorDeclaration(member) ? 'constructor' : kind);

      if (
        ts.isPropertySignature(member) ||
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member)
      ) {
        context.inspectType(member.type, name);
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
        context.record(member, constructorName, 'constructor');
        for (const parameter of member.parameters) {
          context.inspectType(
            parameter.type,
            `${constructorName}.${parameter.name.getText(parameter.getSourceFile())}`,
          );
        }
        context.inspectType(member.type, owner);
      } else {
        inspectMembers([member], `${owner}.static`, 'member');
      }
    }
  }

  function inspectHeritage(node) {
    for (const clause of node.heritageClauses ?? []) {
      for (const inherited of clause.types) {
        context.inspectReference(inherited.expression);
        const inheritedType = checker.getTypeAtLocation(inherited);
        const reference = checker.getSymbolAtLocation(inherited.expression);
        const target = reference && context.resolvedSymbol(reference);
        const kind = ts.isClassDeclaration(node) ? 'member' : 'property';
        if (context.inspectExternalReference(inheritedType, target, inherited, canonicalName(node), kind)) {
          continue;
        }
        if (isMappedType(inheritedType)) {
          context.inspectResolvedType(inheritedType, canonicalName(node), inherited);
          context.inspectMappedArguments(inherited.typeArguments ?? [], canonicalName(node));
          continue;
        }
        for (const argument of inherited.typeArguments ?? []) {
          context.inspectType(argument, canonicalName(node));
        }
      }
    }
  }

  function inspectInheritedClass(symbol, node, owner) {
    const instance = checker.getDeclaredTypeOfSymbol(symbol);
    const constructor = checker.getTypeOfSymbolAtLocation(symbol, node);
    context.inspectResolvedProperties(instance, owner, node, 'member', false, true);
    context.inspectResolvedProperties(constructor, owner, node, 'member', true, true);
  }

  function inspectNode(node, symbol, owner, exportSymbol, kind) {
    if (isInternal(node)) {
      return;
    }

    const declarationKind = ts.isModuleDeclaration(node) ? 'namespace' : kind;
    context.record(node, owner, declarationKind, exportSymbol, symbol);

    if (ts.isModuleDeclaration(node)) {
      context.inspectExports(symbol, `${owner}.`);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const instanceOnly = ts.isClassDeclaration(node) && kind === 'type';
      inspectTypeParameters(node, owner);
      inspectHeritage(node);
      inspectMembers(node.members, owner, ts.isClassDeclaration(node) ? 'member' : 'property', instanceOnly);
      if (ts.isClassDeclaration(node)) {
        if (instanceOnly) {
          const instance = checker.getDeclaredTypeOfSymbol(symbol);
          context.inspectResolvedProperties(instance, owner, node, 'member', false, true);
        } else {
          inspectInheritedClass(symbol, node, owner);
        }
      } else {
        const inherited = checker.getDeclaredTypeOfSymbol(symbol);
        context.inspectResolvedProperties(inherited, owner, node, 'property', false, true);
      }
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      inspectMembers(node.members, owner, 'member');
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      inspectTypeParameters(node, owner);
      context.inspectType(node.type, owner);
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
        context.inspectType(node.type, owner);
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

  return { inspectSignature, inspectTypeParameters, inspectMembers, inspectSymbol };
}

module.exports = { createCoverageDeclarations };
