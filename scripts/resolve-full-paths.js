'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

const path = require('path');

// tsc-alias --resolveFullPaths is buggy, it replaces 'formdata-node'
// with 'formdata-node.js' because we have a file with that name
function resolveFullPaths({ orig, file, config }) {
  return orig.replace(/['"]([^"'\r\n]+)['"]/, (match, importPath) => {
    if (!importPath.startsWith('.')) return match;
    const { dir, name } = path.parse(importPath);
    const ext = /\.mjs$/.test(file) ? '.mjs' : '.js';
    return JSON.stringify(`${dir}/${name}${ext}`);
  });
}
exports.default = resolveFullPaths;
