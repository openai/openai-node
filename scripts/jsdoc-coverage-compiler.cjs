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

function generatedSource(file, relativeFile) {
  if (generatedFiles.has(relativeFile)) {
    return true;
  }
  const [firstLine] = fs.readFileSync(file, 'utf-8').split('\n', 1);
  return /^\/\/ File generated from our OpenAPI spec by (?:Stainless|Castiron)\./u.test(firstLine);
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
    if (
      entry.isFile() &&
      ts.isSupportedSourceFileName(file, { allowJs: false }) &&
      !ts.isDeclarationFileName(file) &&
      !generatedSource(file, relativeFile)
    ) {
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
  const declarations = node.symbol?.declarations;
  if (declarations?.filter((declaration) => declaration.kind === node.kind).length > 1) {
    return true;
  }
  const siblings = node.parent?.members ?? node.parent?.statements;
  if (!siblings) {
    return false;
  }

  const name = node.name?.getText(node.getSourceFile());
  let matches = 0;
  for (const sibling of siblings) {
    if (sibling.kind === node.kind && sibling.name?.getText(sibling.getSourceFile()) === name) {
      matches += 1;
      if (matches > 1) {
        return true;
      }
    }
  }
  return false;
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

function positionalBranch(parent, child) {
  if (ts.isUnionTypeNode(parent)) {
    return `${parent.pos}:${parent.types.indexOf(child)}`;
  }
  if (ts.isTupleTypeNode(parent)) {
    return `${parent.pos}:${parent.elements.indexOf(child)}`;
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
  if (
    ts.isTypeReferenceNode(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isExpressionWithTypeArguments(parent)
  ) {
    const index = parent.typeArguments?.indexOf(child) ?? -1;
    if (index !== -1) {
      return `${parent.pos}:${index}`;
    }
  }
}

function isMappedType(type) {
  return Math.trunc((type.objectFlags ?? 0) / ts.ObjectFlags.Mapped) % 2 === 1;
}

function externalTypeArguments(checker, type, handwrittenFiles) {
  const reference = Math.trunc((type.objectFlags ?? 0) / ts.ObjectFlags.Reference) % 2 === 1;
  if (!reference || checker.isArrayType(type) || checker.isTupleType(type)) {
    return [];
  }
  const handwritten = type.symbol?.declarations?.some((declaration) =>
    handwrittenFiles.has(declaration.getSourceFile().fileName),
  );
  if (!handwritten) {
    return checker.getTypeArguments(type);
  }
  const own = checker
    .getPropertiesOfType(type)
    .some((property) =>
      property.declarations?.some((declaration) =>
        handwrittenFiles.has(declaration.getSourceFile().fileName),
      ),
    );
  return own ? [] : checker.getTypeArguments(type);
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

function compilerOptions(virtual) {
  if (virtual) {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      noEmitOnError: false,
      jsx: ts.JsxEmit.Preserve,
      lib: ['lib.es5.d.ts'],
      noResolve: true,
      removeComments: false,
      skipLibCheck: true,
      types: [],
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
    declarationMap: true,
    sourceMap: false,
    noEmitOnError: false,
    jsx: parsed.options.jsx ?? ts.JsxEmit.Preserve,
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
  const directoryExists = host.directoryExists?.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const virtualDirectories = new Set();

  for (const file of virtualSources.keys()) {
    let directory = path.dirname(file);
    while (!virtualDirectories.has(directory)) {
      virtualDirectories.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }

  host.readFile = (file) => virtualSources.get(path.resolve(file)) ?? readFile(file);
  host.fileExists = (file) => virtualSources.has(path.resolve(file)) || fileExists(file);
  host.directoryExists = (directory) =>
    virtualDirectories.has(path.resolve(directory)) || Boolean(directoryExists?.(directory));
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
    let declarationMap;
    const result = program.emit(
      sourceFile,
      (name, text) => {
        if (ts.isDeclarationFileName(name)) {
          declarationFile = { originalFile: file, fileName: path.resolve(name), text };
        } else if (name.endsWith('.map') && ts.isDeclarationFileName(name.slice(0, -4))) {
          declarationMap = JSON.parse(text);
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
    emitted.push({ ...declarationFile, declarationMap });
  }

  return emitted;
}

function declarationProgram(emitted) {
  const virtualSources = new Map(emitted.map(({ fileName, text }) => [fileName, text]));
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    noEmit: true,
    lib: ['lib.es5.d.ts'],
    noResolve: true,
    skipLibCheck: true,
    types: [],
  };

  return createProgram([...virtualSources.keys()], virtualSources, options);
}

function sourceSymbolType(checker, symbol) {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) {
    return;
  }

  if (
    ts.isClassDeclaration(declaration) ||
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration)
  ) {
    return checker.getDeclaredTypeOfSymbol(symbol);
  }
  return checker.getTypeOfSymbolAtLocation(symbol, declaration);
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
};
