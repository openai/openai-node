const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedHeader = '// File generated from our OpenAPI spec by Castiron.';
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);

function findGeneratedFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : findGeneratedFiles(file);
    }
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) {
      return [];
    }
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.startsWith(generatedHeader)) {
      return [];
    }

    return [path.relative(repositoryRoot, file).split(path.sep).join('/')];
  });
}

const generatedFiles = findGeneratedFiles(repositoryRoot);
generatedFiles.sort();

module.exports = generatedFiles;
