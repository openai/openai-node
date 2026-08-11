const requireConfig = require('node:module').createRequire(__filename);

const { defineConfig } = requireConfig('oxlint');
const core = requireConfig('ultracite/oxlint/core').default;
const stainlessGeneratedFiles = requireConfig('./scripts/stainless-generated-files.cjs');

// Existing handwritten SDK patterns predate these preset rules.
const compatibilityRules = [
  'arrow-body-style',
  'complexity',
  'curly',
  'eqeqeq',
  'func-names',
  'func-style',
  'import/consistent-type-specifier-style',
  'import/no-cycle',
  'no-await-in-loop',
  'no-bitwise',
  'no-eq-null',
  'no-inline-comments',
  'no-param-reassign',
  'no-plusplus',
  'no-promise-executor-return',
  'no-shadow',
  'no-sparse-arrays',
  'no-unused-vars',
  'no-use-before-define',
  'no-var',
  'object-shorthand',
  'prefer-arrow-callback',
  'prefer-destructuring',
  'prefer-named-capture-group',
  'prefer-template',
  'promise/avoid-new',
  'promise/prefer-await-to-then',
  'require-await',
  'require-unicode-regexp',
  'sort-keys',
  'typescript/array-type',
  'typescript/ban-ts-comment',
  'typescript/consistent-type-definitions',
  'typescript/consistent-type-imports',
  'typescript/method-signature-style',
  'typescript/no-explicit-any',
  'typescript/no-non-null-assertion',
  'typescript/prefer-ts-expect-error',
  'unicorn/catch-error-name',
  'unicorn/consistent-assert',
  'unicorn/consistent-function-scoping',
  'unicorn/filename-case',
  'unicorn/no-useless-undefined',
  'unicorn/numeric-separators-style',
  'unicorn/prefer-module',
  'unicorn/prefer-node-protocol',
  'unicorn/prefer-response-static-json',
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
        'typescript/ban-types': 'off',
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
      // Jest matcher augmentation and the public ChatCompletionStream type surface
      // intentionally rely on TypeScript declaration-merging namespaces.
      files: [
        'ecosystem-tests/node-ts-cjs-auto/tests/test.ts',
        'ecosystem-tests/node-ts-cjs-web/tests/test-jsdom.ts',
        'ecosystem-tests/node-ts-cjs-web/tests/test-node.ts',
        'ecosystem-tests/node-ts-cjs/tests/test-jsdom.ts',
        'ecosystem-tests/node-ts-cjs/tests/test-node.ts',
        'ecosystem-tests/node-ts-esm-auto/tests/test.ts',
        'ecosystem-tests/node-ts-esm-web/tests/test.ts',
        'ecosystem-tests/node-ts-esm/tests/test-esnext.ts',
        'ecosystem-tests/node-ts-esm/tests/test.ts',
        'ecosystem-tests/node-ts4.5-jest28/tests/test.ts',
        'src/lib/ChatCompletionStream.ts',
      ],
      rules: {
        'typescript/no-namespace': 'off',
      },
    },
    {
      // Schema normalization intentionally deletes dynamic keys in place, and these
      // tests exercise deletion/restoration behavior directly.
      files: [
        'src/lib/transform.ts',
        'tests/internal/detect-platform.test.ts',
        'tests/internal/utils.test.ts',
        'tests/lib/bedrock-provider.test.ts',
      ],
      rules: {
        'typescript/no-dynamic-delete': 'off',
      },
    },
    {
      // These last-item reads intentionally stay compatible with the repository's
      // ES2020 declaration library, which does not include Array.prototype.at.
      files: [
        'scripts/check-node-version-policy.ts',
        'src/_vendor/partial-json-parser/parser.ts',
        'src/lib/AbstractChatCompletionRunner.ts',
        'src/lib/ChatCompletionStream.ts',
        'tests/_vendor/partial-json-parser/partial-json-parsing.test.ts',
        'tests/lib/ChatCompletionRunFunctions.test.ts',
        'tests/realtime-websocket.test.ts',
      ],
      rules: {
        'unicorn/prefer-at': 'off',
      },
    },
    {
      // These switches intentionally enumerate schema, event, or test fixture
      // variants; preserving their no-op behavior for unknown variants is safer.
      files: [
        'src/_vendor/zod-to-json-schema/parseDef.ts',
        'src/_vendor/zod-to-json-schema/parsers/bigint.ts',
        'src/_vendor/zod-to-json-schema/parsers/date.ts',
        'src/_vendor/zod-to-json-schema/parsers/number.ts',
        'src/_vendor/zod-to-json-schema/parsers/string.ts',
        'src/_vendor/zod-to-json-schema/parsers/union.ts',
        'src/lib/AssistantStream.ts',
        'tests/lib/AssistantStream.test.ts',
        'tests/live/bedrock.live.test.ts',
      ],
      rules: {
        'default-case': 'off',
      },
    },
    {
      // These promise callbacks are intentional entrypoint, memoization, deferred
      // execution, or Node stream callback boundaries whose timing must stay stable.
      files: [
        'ecosystem-tests/cli.ts',
        'examples/azure/assistants.ts',
        'examples/azure/chat.ts',
        'examples/azure/responses.ts',
        'examples/fine-tuning/fine-tuning.ts',
        'examples/images/image-stream.ts',
        'examples/images/picture.ts',
        'examples/responses/manual-conversation-state.ts',
        'examples/responses/websocket.ts',
        'scripts/_vendor/tsc-multi/src/worker/entry.ts',
        'src/auth/subject-token-providers.ts',
        'src/helpers/audio.ts',
        'src/lib/EventStream.ts',
        'tests/helpers/audio-recording.test.ts',
        'tests/helpers/audio.test.ts',
      ],
      rules: {
        'promise/prefer-await-to-callbacks': 'off',
      },
    },
    {
      // Function-tool fixtures intentionally give callbacks semantic names such as
      // getWeather while assigning them to the protocol function field.
      files: ['tests/lib/ChatCompletionRunFunctions.test.ts'],
      rules: {
        'func-name-matching': 'off',
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
