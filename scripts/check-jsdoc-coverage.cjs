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
    } else if (entry.isFile() && file.endsWith('.ts') && !generatedFiles.has(relativeFile)) {
      files.push(file);
    }
  }

  return files;
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
    return typeof part.text === 'string' && part.text.trim().length > 0;
  });
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

function isVisibleMember(node) {
  if (node.name && ts.isPrivateIdentifier(node.name)) {
    return false;
  }
  if (isInternal(node)) {
    return false;
  }

  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  return !modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

function compilerOptions(virtual) {
  if (virtual) {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      declaration: true,
      emitDeclarationOnly: true,
      noEmitOnError: false,
      noLib: true,
      noResolve: true,
      removeComments: false,
      skipLibCheck: true,
      outDir: path.join(repositoryRoot, '.jsdoc-coverage'),
      rootDir: repositoryRoot,
    };
  }

  const configPath = path.join(repositoryRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repositoryRoot);

  return {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    sourceMap: false,
    noEmitOnError: false,
    removeComments: false,
    stripInternal: false,
    outDir: path.join(repositoryRoot, '.jsdoc-coverage'),
    rootDir: repositoryRoot,
  };
}

function createProgram(files, virtualSources, options) {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);

  host.readFile = (file) => virtualSources.get(path.resolve(file)) ?? readFile(file);
  host.fileExists = (file) => virtualSources.has(path.resolve(file)) || fileExists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = virtualSources.get(path.resolve(file));
    if (source !== undefined) {
      return ts.createSourceFile(file, source, languageVersion, true);
    }
    return getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({ rootNames: files, options, host });
}

function emitDeclarations(program, files) {
  const emitted = [];

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    let declarationFile;
    const result = program.emit(
      sourceFile,
      (name, text) => {
        if (name.endsWith('.d.ts')) {
          declarationFile = { originalFile: file, fileName: path.resolve(name), text };
        }
      },
      undefined,
      true,
    );

    if (result.emitSkipped || !declarationFile) {
      const diagnostics = result.diagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('; ');
      throw new Error(`Could not emit public declarations for ${relativePath(file)}: ${diagnostics}`);
    }
    emitted.push(declarationFile);
  }

  return emitted;
}

function declarationProgram(emitted) {
  const virtualSources = new Map(emitted.map(({ fileName, text }) => [fileName, text]));
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
  };

  return createProgram([...virtualSources.keys()], virtualSources, options);
}

function inspectDeclarations(program, emitted) {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(emitted.fileName);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const declarations = new Map();
  const inspected = new Map();
  const publicTargets = new Set();
  const displayFile = relativePath(emitted.originalFile);

  if (!moduleSymbol) {
    return [];
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

  function record(node, name, kind, ...symbols) {
    if (isInternal(node)) {
      return;
    }

    const statement = ts.isVariableDeclaration(node) ? node.parent?.parent : undefined;
    const documented =
      hasNodeDocumentation(node) ||
      (statement && hasNodeDocumentation(statement)) ||
      symbols.some(symbolDocumentation);
    const key = `${kind}:${name}`;
    const existing = declarations.get(key);
    if (existing) {
      existing.documented ||= Boolean(documented);
      return;
    }

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    declarations.set(key, {
      file: displayFile,
      line: line + 1,
      column: character + 1,
      kind,
      name,
      documented: Boolean(documented),
    });
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

  function localSymbol(symbol) {
    return symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile);
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

  function inspectType(node, owner) {
    if (!node) {
      return;
    }

    if (ts.isTypeReferenceNode(node)) {
      inspectReference(node.typeName);
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

  function inspectSignature(node, owner) {
    for (const parameter of node.parameters ?? []) {
      inspectType(parameter.type, `${owner}.${parameter.name.getText(sourceFile)}`);
    }
    inspectTypeParameters(node, owner);
    inspectType(node.type, `${owner}.result`);
  }

  function inspectTypeParameters(node, owner) {
    for (const parameter of node.typeParameters ?? []) {
      const parameterName = `${owner}.${parameter.name.getText(sourceFile)}`;
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
      const name = `${owner}.${staticPrefix}${memberName(member, sourceFile)}`;
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
          inspectType(parameter.type, `${constructorName}.${parameter.name.getText(sourceFile)}`);
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
        for (const argument of inherited.typeArguments ?? []) {
          inspectType(argument, canonicalName(node));
        }
      }
    }
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
      if (localSymbol(target)) {
        inspectSymbol(target, `${prefix}${exported.getName()}`, exported);
      }
    }
  }

  inspectExports(moduleSymbol);
  return [...declarations.values()];
}

function inspectFiles(files, virtualSources = new Map()) {
  const options = compilerOptions(virtualSources.size > 0);
  const sourceProgram = createProgram(files, virtualSources, options);
  const emitted = emitDeclarations(sourceProgram, files);
  const publicProgram = declarationProgram(emitted);

  return emitted.flatMap((declaration) => inspectDeclarations(publicProgram, declaration));
}

function inspectSource(file, text) {
  const sourceFile = path.resolve(repositoryRoot, file);
  return inspectFiles([sourceFile], new Map([[sourceFile, text]]));
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
