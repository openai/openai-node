const fs = require('node:fs');
const path = require('node:path');

const indexJs = process.env['DIST_PATH']
  ? path.resolve(process.env['DIST_PATH'], 'index.js')
  : path.resolve(__dirname, '..', '..', 'dist', 'index.js');

const before = fs.readFileSync(indexJs, 'utf-8');
const after = before.replace(
  /^(\s*Object\.defineProperty\s*\(exports,\s*["']__esModule["'].+)$/m,
  `exports = module.exports = function (...args) {
    return Reflect.construct(exports.default, args, new.target || exports.default)
  }
  $1`.replaceAll(/^ {2}/gm, ''),
);
// Retain the callable CommonJS export while sharing the SDK class's inheritance.
fs.writeFileSync(
  indexJs,
  `${after}
Object.setPrototypeOf(exports, exports.default);
exports.prototype = exports.default.prototype;
`,
  'utf-8',
);
