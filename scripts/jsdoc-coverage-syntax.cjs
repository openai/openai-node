const ts = require('typescript');

function hasCommentText(comment) {
  if (typeof comment === 'string') {
    return comment.trim().length > 0;
  }
  return Array.isArray(comment)
    ? comment.some((part) =>
        typeof part === 'string'
          ? part.trim().length > 0
          : typeof part.text === 'string' && part.text.trim().length > 0,
      )
    : false;
}

function hasNodeDocumentation(node) {
  return (node.jsDoc ?? []).some(
    (comment) =>
      hasCommentText(comment.comment) ||
      (comment.tags ?? []).some((tag) => tag.tagName.text !== 'internal' && hasCommentText(tag.comment)),
  );
}

function isInternal(node) {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal');
}

function isVisibleMember(node) {
  if ((node.name && ts.isPrivateIdentifier(node.name)) || isInternal(node)) {
    return false;
  }
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  return !modifiers.some(
    ({ kind }) => kind === ts.SyntaxKind.PrivateKeyword || kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

function memberName(node, sourceFile) {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if (ts.isIndexSignatureDeclaration(node)) {
    return `[${node.parameters.map((parameter) => parameter.getText(sourceFile)).join(', ')}]`;
  }
  if (ts.isCallSignatureDeclaration(node)) {
    return '[call]';
  }
  if (ts.isConstructSignatureDeclaration(node)) {
    return '[new]';
  }
  return node.name?.getText(sourceFile) ?? 'default';
}

function canonicalName(node) {
  const names = [node.name?.text ?? 'default'];
  let { parent } = node;
  while (parent) {
    if (ts.isModuleDeclaration(parent)) {
      names.unshift(parent.name.text);
    }
    ({ parent } = parent);
  }
  return names.join('.');
}

function overloadedSignature(node) {
  if (node.symbol?.declarations?.filter((declaration) => declaration.kind === node.kind).length > 1) {
    return true;
  }
  const siblings = node.parent?.members ?? node.parent?.statements;
  if (!siblings) {
    return false;
  }
  const name = node.name?.getText(node.getSourceFile());
  return (
    siblings.filter(
      (sibling) => sibling.kind === node.kind && sibling.name?.getText(sibling.getSourceFile()) === name,
    ).length > 1
  );
}

function genericParameterBranch(parent, child) {
  if (!ts.isTypeParameterDeclaration(parent) || !parent.constraint || !parent.default) {
    return;
  }
  if (child === parent.constraint) {
    return `${parent.pos}:constraint`;
  }
  if (child === parent.default) {
    return `${parent.pos}:default`;
  }
}

function callableIntersectionBranch(parent, child) {
  if (ts.isIntersectionTypeNode(parent)) {
    let constituent = child;
    while (ts.isParenthesizedTypeNode(constituent)) {
      constituent = constituent.type;
    }
    return ts.isFunctionTypeNode(constituent) || ts.isConstructorTypeNode(constituent)
      ? `${parent.pos}:${parent.types.indexOf(child)}`
      : undefined;
  }
  if (
    !ts.isFunctionLike(parent) ||
    (child !== parent.type && !parent.parameters?.includes(child) && !parent.typeParameters?.includes(child))
  ) {
    return;
  }
  let constituent = parent.parent;
  if (!ts.isTypeLiteralNode(constituent)) {
    return;
  }
  while (ts.isParenthesizedTypeNode(constituent.parent)) {
    constituent = constituent.parent;
  }
  const intersection = constituent.parent;
  if (ts.isIntersectionTypeNode(intersection)) {
    return `${intersection.pos}:${intersection.types.indexOf(constituent)}`;
  }
}

function typeArgumentBranch(parent, child) {
  if (
    !ts.isTypeReferenceNode(parent) &&
    !ts.isImportTypeNode(parent) &&
    !ts.isExpressionWithTypeArguments(parent)
  ) {
    return;
  }
  const index = parent.typeArguments?.indexOf(child) ?? -1;
  if (index !== -1) {
    return `${parent.pos}:${index}`;
  }
}

function positionalBranch(parent, child) {
  if (ts.isUnionTypeNode(parent)) {
    return `${parent.pos}:${parent.types.indexOf(child)}`;
  }
  if (ts.isTupleTypeNode(parent)) {
    return `${parent.pos}:${parent.elements.indexOf(child)}`;
  }
  const callable = callableIntersectionBranch(parent, child);
  if (callable !== undefined) {
    return callable;
  }
  const generic = genericParameterBranch(parent, child);
  if (generic !== undefined) {
    return generic;
  }
  if (ts.isConditionalTypeNode(parent)) {
    if (child === parent.trueType) {
      return `${parent.pos}:0`;
    }
    if (child === parent.falseType) {
      return `${parent.pos}:1`;
    }
  }
  if (
    ts.isFunctionLike(parent) &&
    (child === parent.type || parent.parameters?.includes(child) || parent.typeParameters?.includes(child)) &&
    overloadedSignature(parent)
  ) {
    return `${parent.pos}:signature`;
  }
  return typeArgumentBranch(parent, child);
}

module.exports = {
  canonicalName,
  hasCommentText,
  hasNodeDocumentation,
  isInternal,
  isVisibleMember,
  memberName,
  positionalBranch,
};
