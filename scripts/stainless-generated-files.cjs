const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedHeaders = [
  '// File generated from our OpenAPI spec by Stainless.',
  '// File generated from our OpenAPI spec by Castiron.',
];
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);

function findGeneratedFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : findGeneratedFiles(file);
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    const content = fs.readFileSync(file, 'utf8');
    if (!generatedHeaders.some((header) => content.startsWith(header))) return [];

    return [path.relative(repositoryRoot, file).split(path.sep).join('/')];
  });
}

module.exports = findGeneratedFiles(repositoryRoot).sort();
