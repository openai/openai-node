const fs = require('node:fs');
const path = require('node:path');

const indexJs = process.env['DIST_PATH']
  ? path.resolve(process.env['DIST_PATH'], 'index.js')
  : path.resolve(__dirname, '..', '..', 'dist', 'index.js');

const before = fs.readFileSync(indexJs, 'utf-8');
const after = before.replace(
  /^(\s*Object\.defineProperty\s*\(exports,\s*["']__esModule["'].+)$/m,
  `exports = module.exports = function (...args) {
    return new exports.default(...args)
  }
  $1`.replaceAll(/^ {2}/gm, ''),
);
fs.writeFileSync(indexJs, after, 'utf-8');
