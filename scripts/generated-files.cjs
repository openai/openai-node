const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedHeader = '// File generated from our OpenAPI spec by Castiron.';
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);
// Preserve the existing lightweight lint profile for these legacy SDK files.
const legacyFiles = new Set([
  'src/core/api-promise.ts',
  'src/core/error.ts',
  'src/core/pagination.ts',
  'src/core/resource.ts',
  'src/index.ts',
  'src/internal/builtin-types.ts',
  'src/internal/detect-platform.ts',
  'src/internal/errors.ts',
  'src/internal/headers.ts',
  'src/internal/parse.ts',
  'src/internal/request-options.ts',
  'src/internal/shim-types.ts',
  'src/internal/shims.ts',
  'src/internal/types.ts',
  'src/internal/utils.ts',
  'src/internal/utils/base64.ts',
  'src/internal/utils/env.ts',
  'src/internal/utils/log.ts',
  'src/internal/utils/query.ts',
  'src/internal/utils/sleep.ts',
  'src/internal/utils/uuid.ts',
  'src/internal/utils/values.ts',
  'src/resources/beta/realtime.ts',
  'src/resources/beta/realtime/index.ts',
  'src/resources/beta/realtime/realtime.ts',
  'src/resources/beta/realtime/sessions.ts',
  'src/resources/beta/realtime/transcription-sessions.ts',
  'tests/api-resources/webhooks.test.ts',
  'tests/backwards-compat-resource-exports.test.ts',
  'tests/index.test.ts',
  'tests/stringifyQuery.test.ts',
]);

function findGeneratedFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : findGeneratedFiles(file);
    }
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) {
      return [];
    }
    const relativePath = path.relative(repositoryRoot, file).split(path.sep).join('/');
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.startsWith(generatedHeader) && !legacyFiles.has(relativePath)) {
      return [];
    }

    return [relativePath];
  });
}

const generatedFiles = findGeneratedFiles(repositoryRoot);
generatedFiles.sort();

module.exports = generatedFiles;
