const requireConfig = require('node:module').createRequire(__filename);

const { defineConfig } = requireConfig('oxlint');
const core = requireConfig('ultracite/oxlint/core').default;
const stainlessGeneratedFiles = requireConfig('./scripts/stainless-generated-files.cjs');

// Existing handwritten SDK patterns predate these preset rules.
const compatibilityRules = [
  'arrow-body-style',
  'class-methods-use-this',
  'complexity',
  'curly',
  'default-case',
  'eqeqeq',
  'func-name-matching',
  'func-names',
  'func-style',
  'import/consistent-type-specifier-style',
  'import/no-cycle',
  'jsdoc/no-defaults',
  'jsdoc/require-param-description',
  'no-await-in-loop',
  'no-bitwise',
  'no-eq-null',
  'no-inline-comments',
  'no-nested-ternary',
  'no-param-reassign',
  'no-plusplus',
  'no-promise-executor-return',
  'no-shadow',
  'no-sparse-arrays',
  'no-unused-vars',
  'no-use-before-define',
  'no-var',
  'node/global-require',
  'object-shorthand',
  'prefer-arrow-callback',
  'prefer-destructuring',
  'prefer-named-capture-group',
  'prefer-object-has-own',
  'prefer-template',
  'promise/avoid-new',
  'promise/prefer-await-to-callbacks',
  'promise/prefer-await-to-then',
  'require-await',
  'require-unicode-regexp',
  'sort-keys',
  'typescript/array-type',
  'typescript/ban-ts-comment',
  'typescript/ban-types',
  'typescript/consistent-indexed-object-style',
  'typescript/consistent-type-definitions',
  'typescript/consistent-type-imports',
  'typescript/method-signature-style',
  'typescript/no-dynamic-delete',
  'typescript/no-explicit-any',
  'typescript/no-import-type-side-effects',
  'typescript/no-namespace',
  'typescript/no-non-null-assertion',
  'typescript/prefer-ts-expect-error',
  'unicorn/catch-error-name',
  'unicorn/consistent-assert',
  'unicorn/consistent-function-scoping',
  'unicorn/filename-case',
  'unicorn/import-style',
  'unicorn/no-array-for-each',
  'unicorn/no-array-reduce',
  'unicorn/no-await-expression-member',
  'unicorn/no-console-spaces',
  'unicorn/no-nested-ternary',
  'unicorn/no-typeof-undefined',
  'unicorn/no-useless-undefined',
  'unicorn/numeric-separators-style',
  'unicorn/prefer-at',
  'unicorn/prefer-module',
  'unicorn/prefer-node-protocol',
  'unicorn/prefer-response-static-json',
  'unicorn/prefer-spread',
  'unicorn/prefer-string-replace-all',
  'unicorn/prefer-string-slice',
  'unicorn/switch-case-braces',
  'unicorn/text-encoding-identifier-case',
  'vars-on-top',
];

module.exports = defineConfig({
  extends: [core],
  categories: {
    correctness: 'off',
  },
  rules: {
    ...Object.fromEntries(compatibilityRules.map((rule) => [rule, 'off'])),
    'jsdoc/check-tag-names': ['error', { definedTags: ['jest-environment'] }],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: '^openai(/.*)?',
            message: 'Use a relative import, not a package import.',
          },
        ],
      },
    ],
  },
  ignorePatterns: [...core.ignorePatterns, 'dist/**', 'coverage/**', ...stainlessGeneratedFiles],
  overrides: [
    {
      // These signatures intentionally expose direct `void` for zero-argument events,
      // and the type test verifies the public `APIPromise<void>` contract.
      files: [
        'src/core/EventEmitter.ts',
        'src/lib/EventEmitter.ts',
        'src/lib/EventStream.ts',
        'tests/responses.test.ts',
      ],
      rules: {
        'typescript/no-invalid-void-type': 'off',
      },
    },
    {
      files: [
        'src/_vendor/zod-to-json-schema/index.ts',
        'src/api-promise.ts',
        'src/pagination.ts',
        'src/resource.ts',
        'src/resources.ts',
        'src/streaming.ts',
        'src/uploads.ts',
      ],
      rules: {
        'oxc/no-barrel-file': 'off',
      },
    },
    {
      // Vendored zod-to-json-schema uses `{}` for the intentionally empty schema
      // that accepts any JSON value; preserve that public type surface.
      files: [
        'src/_vendor/zod-to-json-schema/parseDef.ts',
        'src/_vendor/zod-to-json-schema/parsers/any.ts',
        'src/_vendor/zod-to-json-schema/parsers/never.ts',
        'src/_vendor/zod-to-json-schema/parsers/undefined.ts',
        'src/_vendor/zod-to-json-schema/parsers/unknown.ts',
      ],
      rules: {
        'typescript/no-empty-object-type': 'off',
      },
    },
    {
      // These SDK and test helpers intentionally use typed or Node EventEmitter APIs;
      // EventTarget would lose multi-argument events, emit chaining, or public behavior.
      files: [
        'src/beta/realtime/internal-base.ts',
        'src/core/EventEmitter.ts',
        'src/realtime/internal-base.ts',
        'tests/helpers/audio-recording.test.ts',
        'tests/internal/websocket-adapters.test.ts',
        'tests/lib/core-event-emitter.test.ts',
        'tests/lib/eventEmitter.test.ts',
        'tests/lib/responsesWebSocket.test.ts',
      ],
      rules: {
        'unicorn/prefer-event-target': 'off',
      },
    },
    {
      // These files intentionally colocate one closely related class pair.
      files: [
        'src/_vendor/partial-json-parser/parser.ts',
        'src/beta/realtime/internal-base.ts',
        'src/core/EventEmitter.ts',
        'src/core/streaming.ts',
        'src/realtime/internal-base.ts',
        'tests/internal/websocket-adapters.test.ts',
        'tests/lib/ChatCompletionRunFunctions.test.ts',
        'tests/lib/responsesWebSocket.test.ts',
      ],
      rules: {
        'max-classes-per-file': ['error', { max: 2 }],
      },
    },
    {
      // Path validation deliberately creates anonymous class-expression fixtures.
      files: ['tests/path.test.ts'],
      rules: {
        'max-classes-per-file': ['error', { ignoreExpressions: true }],
      },
    },
    {
      files: ['tests/**', 'examples/**', 'ecosystem-tests/**'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
});
