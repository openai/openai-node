module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'unused-imports', 'prettier'],
  rules: {
    'no-unused-vars': 'off',
    'prettier/prettier': 'error',
    'unused-imports/no-unused-imports': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['openai', 'openai/*'],
            message: 'Use a relative import, not a package import.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['tests/**'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  root: true,
};
