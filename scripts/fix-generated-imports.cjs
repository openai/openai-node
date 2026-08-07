const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedFiles = require('./stainless-generated-files.cjs');
const maximumFixPasses = 10;

function requestedFiles(arguments_) {
  if (arguments_[0] !== '--file-list') return arguments_;
  if (arguments_.length !== 2) throw new Error('--file-list requires exactly one path');

  return fs.readFileSync(arguments_[1], 'utf8').split(/\r?\n/u).filter(Boolean);
}

function selectedGeneratedFiles(arguments_) {
  if (arguments_.length === 0) return generatedFiles;

  const generated = new Set(generatedFiles);
  return requestedFiles(arguments_)
    .map((file) =>
      path.relative(repositoryRoot, path.resolve(repositoryRoot, file)).split(path.sep).join('/'),
    )
    .filter((file) => generated.has(file));
}

function fingerprint(files) {
  const hash = createHash('sha256');

  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(repositoryRoot, file)));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function fixGeneratedImports(files) {
  if (files.length === 0) return;

  const oxlint = path.join(repositoryRoot, 'node_modules', 'oxlint', 'bin', 'oxlint');
  const config = path.join(__dirname, 'oxlint-generated-imports.json');

  // Oxlint applies overlapping fixes only once; ESLint repeats until they stabilize.
  // https://github.com/oxc-project/oxc/issues/16118
  for (let pass = 0; pass < maximumFixPasses; pass++) {
    const before = fingerprint(files);
    const result = spawnSync(process.execPath, [oxlint, '--config', config, '--fix', '--quiet', ...files], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }

    if (fingerprint(files) === before) return;
  }

  throw new Error(`generated import cleanup did not stabilize after ${maximumFixPasses} passes`);
}

try {
  fixGeneratedImports(selectedGeneratedFiles(process.argv.slice(2)));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
