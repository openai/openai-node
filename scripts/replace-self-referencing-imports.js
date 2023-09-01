'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

const path = require('path');
const distDir = path.resolve(__dirname, '..', 'dist');
const distSrcDir = path.join(distDir, 'src');

function replaceSelfReferencingImports({ orig, file, config }) {
  // replace self-referencing imports in source files to reduce errors users will
  // see if they go to definition
  if (!file.startsWith(distDir)) return orig;

  return orig.replace(/['"]([^"'\r\n]+)['"]/, (match, importPath) => {
    if (!importPath.startsWith('openai/')) return match;
    if (!file.startsWith(distSrcDir)) {
      const ext = file.endsWith('.d.ts') ? '' : path.extname(file);
      const { dir, base } = path.parse(importPath);
      return JSON.stringify(`${dir}/${base}${ext}`);
    }
    let relativePath = path.relative(
      path.dirname(file),
      path.join(distSrcDir, importPath.substring('openai/'.length)),
    );
    if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
    return JSON.stringify(relativePath);
  });
}
exports.default = replaceSelfReferencingImports;
