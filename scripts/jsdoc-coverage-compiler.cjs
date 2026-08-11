const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const syntax = require('./jsdoc-coverage-syntax.cjs');
const typeSystem = require('./jsdoc-coverage-type-system.cjs');
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
    } else if (
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
    return source === undefined
      ? getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, languageVersion, true);
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
  return createProgram([...virtualSources.keys()], virtualSources, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    noEmit: true,
    lib: ['lib.es5.d.ts'],
    noResolve: true,
    skipLibCheck: true,
    types: [],
  });
}

module.exports = {
  ...syntax,
  ...typeSystem,
  collectSourceFiles,
  compilerOptions,
  createProgram,
  declarationProgram,
  emitDeclarations,
  relativePath,
};
