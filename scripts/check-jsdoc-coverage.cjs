const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const stainlessGeneratedFiles = require('./stainless-generated-files.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedFiles = new Set(stainlessGeneratedFiles);
const excludedDirectories = new Set(['_vendor']);
const excludedPaths = new Set(['src/internal/qs']);

function relativePath(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function collectSourceFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relativeFile = relativePath(file);

    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name) && !excludedPaths.has(relativeFile)) {
        files.push(...collectSourceFiles(file));
      }
      continue;
    }

    if (entry.isFile() && file.endsWith('.ts') && !generatedFiles.has(relativeFile)) {
      files.push(file);
    }
  }

  return files;
}

function modifiers(node) {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

function isExported(node) {
  return modifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function isInternal(node) {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal');
}

function hasCommentText(comment) {
  if (typeof comment === 'string') {
    return comment.trim().length > 0;
  }
  if (!Array.isArray(comment)) {
    return false;
  }

  return comment.some((part) => {
    if (typeof part === 'string') {
      return part.trim().length > 0;
    }
    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      return true;
    }
    return typeof part.getText === 'function' && part.getText().trim().length > 0;
  });
}

function hasDocumentation(node) {
  return (node.jsDoc ?? []).some(
    (comment) =>
      hasCommentText(comment.comment) ||
      (comment.tags ?? []).some((tag) => tag.tagName.text !== 'internal' && hasCommentText(tag.comment)),
  );
}

function isPublicMember(node) {
  if (
    !ts.isConstructorDeclaration(node) &&
    !ts.isMethodDeclaration(node) &&
    !ts.isPropertyDeclaration(node) &&
    !ts.isGetAccessorDeclaration(node) &&
    !ts.isSetAccessorDeclaration(node)
  ) {
    return false;
  }

  if (node.name && ts.isPrivateIdentifier(node.name)) {
    return false;
  }
  if (isInternal(node)) {
    return false;
  }

  return !modifiers(node).some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

function declarationName(node, sourceFile) {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if (!node.name) {
    return 'default';
  }
  return node.name.getText(sourceFile);
}

function inspectSource(file, text) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const localTypes = new Map(
    sourceFile.statements
      .filter((statement) => ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      .map((statement) => [statement.name.text, statement]),
  );
  const inspectedLocalTypes = new Set();

  function record(node, name, kind, documentationNode = node) {
    if (isInternal(node)) {
      return;
    }

    const key = `${kind}:${name}`;
    const declaration = declarations.get(key);
    if (declaration) {
      declaration.documented ||= hasDocumentation(documentationNode) || hasDocumentation(node);
      return;
    }

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    declarations.set(key, {
      file,
      line: line + 1,
      column: character + 1,
      kind,
      name,
      documented: hasDocumentation(documentationNode) || hasDocumentation(node),
    });
  }

  function inspectObjectTypes(node, owner) {
    if (!node) {
      return;
    }

    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const referenced = localTypes.get(node.typeName.text);
      if (referenced && !isExported(referenced) && !inspectedLocalTypes.has(referenced.name.text)) {
        inspectedLocalTypes.add(referenced.name.text);
        if (!isInternal(referenced)) {
          const name = referenced.name.text;
          record(referenced, name, 'type');
          if (ts.isInterfaceDeclaration(referenced)) {
            inspectInterface(referenced, name);
          }
          if (ts.isTypeAliasDeclaration(referenced)) {
            inspectObjectTypes(referenced.type, name);
          }
          inspectTypeParameters(referenced, name);
        }
      }
    }

    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) {
          continue;
        }
        if (isInternal(member)) {
          continue;
        }

        const name = `${owner}.${declarationName(member, sourceFile)}`;
        record(member, name, 'option');
        inspectObjectTypes(member.type, name);
        inspectParameters(member, name);
      }
      return;
    }

    ts.forEachChild(node, (child) => inspectObjectTypes(child, owner));
  }

  function inspectParameters(node, owner) {
    for (const parameter of node.parameters ?? []) {
      inspectObjectTypes(parameter.type, `${owner}.${parameter.name.getText(sourceFile)}`);
    }
  }

  function inspectTypeParameters(node, owner) {
    for (const parameter of node.typeParameters ?? []) {
      inspectObjectTypes(parameter.constraint, `${owner}.${parameter.name.getText(sourceFile)}`);
      inspectObjectTypes(parameter.default, `${owner}.${parameter.name.getText(sourceFile)}`);
    }
  }

  function inspectHeritage(node, owner) {
    for (const clause of node.heritageClauses ?? []) {
      for (const inherited of clause.types) {
        inspectObjectTypes(inherited, `${owner}.base`);
      }
    }
  }

  function inspectSignature(node, owner) {
    inspectParameters(node, owner);
    inspectTypeParameters(node, owner);
    inspectObjectTypes(node.type, `${owner}.result`);
  }

  function inspectClass(node, owner) {
    inspectTypeParameters(node, owner);
    inspectHeritage(node, owner);
    for (const member of node.members) {
      if (!isPublicMember(member)) {
        continue;
      }

      const name = `${owner}.${declarationName(member, sourceFile)}`;
      record(member, name, ts.isConstructorDeclaration(member) ? 'constructor' : 'member');
      inspectSignature(member, name);
    }
  }

  function inspectInterface(node, owner) {
    inspectTypeParameters(node, owner);
    inspectHeritage(node, owner);
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) {
        continue;
      }
      if (isInternal(member)) {
        continue;
      }

      const name = `${owner}.${declarationName(member, sourceFile)}`;
      record(member, name, 'property');
      inspectObjectTypes(member.type, name);
      inspectSignature(member, name);
    }
  }

  function inspectInitializer(node, owner) {
    if (!node) {
      return;
    }

    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isTypeAssertionExpression(node)
    ) {
      inspectInitializer(node.expression, owner);
      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      inspectSignature(node, owner);
      return;
    }

    if (!ts.isObjectLiteralExpression(node)) {
      return;
    }

    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property) &&
        !ts.isMethodDeclaration(property) &&
        !ts.isGetAccessorDeclaration(property) &&
        !ts.isSetAccessorDeclaration(property)
      ) {
        continue;
      }
      if (isInternal(property)) {
        continue;
      }

      const name = `${owner}.${declarationName(property, sourceFile)}`;
      record(property, name, 'property');
      inspectSignature(property, name);
      if (ts.isPropertyAssignment(property)) {
        inspectInitializer(property.initializer, name);
      }
    }
  }

  function inspectDeclarations(statements, namespace = '') {
    for (const statement of statements) {
      if (!isExported(statement) || isInternal(statement)) {
        continue;
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = `${namespace}${declarationName(declaration, sourceFile)}`;
          record(declaration, name, 'export', statement);
          inspectObjectTypes(declaration.type, name);
          inspectInitializer(declaration.initializer, name);
        }
        continue;
      }

      if (ts.isModuleDeclaration(statement)) {
        const name = `${namespace}${declarationName(statement, sourceFile)}`;
        record(statement, name, 'namespace');
        if (statement.body && ts.isModuleBlock(statement.body)) {
          inspectDeclarations(statement.body.statements, `${name}.`);
        }
        continue;
      }

      if (
        !ts.isFunctionDeclaration(statement) &&
        !ts.isClassDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isEnumDeclaration(statement)
      ) {
        continue;
      }

      const name = `${namespace}${declarationName(statement, sourceFile)}`;
      record(statement, name, 'export');

      if (ts.isClassDeclaration(statement)) {
        inspectClass(statement, name);
      }
      if (ts.isInterfaceDeclaration(statement)) {
        inspectInterface(statement, name);
      }
      if (ts.isTypeAliasDeclaration(statement)) {
        inspectTypeParameters(statement, name);
        inspectObjectTypes(statement.type, name);
      }
      if (ts.isFunctionDeclaration(statement)) {
        inspectSignature(statement, name);
      }
    }
  }

  inspectDeclarations(sourceFile.statements);

  return [...declarations.values()];
}

function collectCoverage() {
  const files = collectSourceFiles(path.join(repositoryRoot, 'src'));
  const declarations = files.flatMap((file) =>
    inspectSource(relativePath(file), fs.readFileSync(file, 'utf-8')),
  );
  const undocumented = declarations.filter((declaration) => !declaration.documented);

  return { files: files.length, declarations, undocumented };
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
