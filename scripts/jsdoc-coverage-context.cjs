const ts = require('typescript');
const { relativePath } = require('./jsdoc-coverage-compiler.cjs');
const { createCoverageRecords } = require('./jsdoc-coverage-records.cjs');
const { createCoverageTypes } = require('./jsdoc-coverage-types.cjs');
const { createCoverageProjections } = require('./jsdoc-coverage-projections.cjs');
const { createCoverageDeclarations } = require('./jsdoc-coverage-declarations.cjs');
const { createCoverageExports } = require('./jsdoc-coverage-exports.cjs');

function createCoverageContext(program, emitted, originalProgram, handwrittenFiles) {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(emitted.fileName);
  const originalChecker = originalProgram.getTypeChecker();
  const originalSourceFile = originalProgram.getSourceFile(emitted.originalFile);
  const sourceMappings = new Map();

  for (const mapping of ts.decodeMappings(emitted.declarationMap?.mappings ?? '')) {
    if (mapping.sourceLine === undefined || mapping.sourceCharacter === undefined) {
      continue;
    }
    const mappings = sourceMappings.get(mapping.generatedLine) ?? [];
    mappings.push(mapping);
    sourceMappings.set(mapping.generatedLine, mappings);
  }

  const context = {
    checker,
    sourceFile,
    moduleSymbol: checker.getSymbolAtLocation(sourceFile),
    originalChecker,
    originalSourceFile,
    originalModule: originalChecker.getSymbolAtLocation(originalSourceFile),
    originalProgram,
    handwrittenFiles,
    declarations: new Map(),
    inspected: new Map(),
    activeTypes: new Set(),
    activeValueSymbols: new Set(),
    activeNamespaces: new Set(),
    publicTargets: new Set(),
    displayFile: relativePath(emitted.originalFile),
    sourceMappings,
    semantic: { branch: '', conditional: false, intersection: false, mapper: undefined },
  };

  Object.assign(
    context,
    createCoverageRecords(context),
    createCoverageTypes(context),
    createCoverageProjections(context),
    createCoverageDeclarations(context),
    createCoverageExports(context),
  );
  return context;
}

function inspectDeclarations(program, emitted, originalProgram, handwrittenFiles) {
  return createCoverageContext(program, emitted, originalProgram, handwrittenFiles).inspectSurface();
}

module.exports = { createCoverageContext, inspectDeclarations };
