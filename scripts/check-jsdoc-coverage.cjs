const path = require('node:path');
const {
  collectSourceFiles,
  compilerOptions,
  createProgram,
  declarationProgram,
  emitDeclarations,
} = require('./jsdoc-coverage-compiler.cjs');
const { inspectDeclarations } = require('./jsdoc-coverage-context.cjs');

const repositoryRoot = path.resolve(__dirname, '..');

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
