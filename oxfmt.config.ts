const requireConfig = require('node:module').createRequire(__filename);

const { defineConfig } = requireConfig('oxfmt');
const ultracite = requireConfig('ultracite/oxfmt').default;

module.exports = defineConfig({
  ...ultracite,
  arrowParens: 'always',
  printWidth: 110,
  proseWrap: 'preserve',
  singleQuote: true,
  trailingComma: 'all',
  sortImports: false,
  sortPackageJson: false,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    'CHANGELOG.md',
    'pnpm-lock.yaml',
    'ecosystem-tests/*/**',
    'node_modules/**',
    'deno/**',
    'api_reference/openapi.transformed.yml',
    'dist/**',
    'coverage/**',
  ],
});
