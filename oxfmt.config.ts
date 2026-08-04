const { defineConfig } = require('oxfmt');
const ultracite = require('ultracite/oxfmt').default;

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
