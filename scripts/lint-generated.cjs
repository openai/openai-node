const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedFiles = require('./stainless-generated-files.cjs');
const oxlint = path.join(repositoryRoot, 'node_modules', 'oxlint', 'bin', 'oxlint');
const generatedConfig = path.join(repositoryRoot, 'oxlint.generated.config.json');
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

function fixGeneratedFiles(files) {
  // Oxlint applies overlapping fixes only once; ESLint repeats until they stabilize.
  // https://github.com/oxc-project/oxc/issues/16118
  for (let pass = 0; pass < maximumFixPasses; pass++) {
    const before = fingerprint(files);
    const result = spawnSync(
      process.execPath,
      [oxlint, '--config', generatedConfig, '--fix', '--quiet', ...files],
      { cwd: repositoryRoot, stdio: 'inherit' },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }

    if (fingerprint(files) === before) return;
  }

  throw new Error(`generated import cleanup did not stabilize after ${maximumFixPasses} passes`);
}

function checkGeneratedFiles(files) {
  const result = spawnSync(
    process.execPath,
    [oxlint, '--config', generatedConfig, '--format', 'json', ...files],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);

  const { diagnostics } = JSON.parse(result.stdout);
  const violations = diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === 'error' ||
      (diagnostic.code === 'eslint(no-unused-vars)' && diagnostic.help === 'Consider removing this import.'),
  );

  for (const diagnostic of violations) {
    const span = diagnostic.labels?.[0]?.span;
    const location = span ? `${diagnostic.filename}:${span.line}:${span.column}` : diagnostic.filename;
    console.error(`${location}: ${diagnostic.message} (${diagnostic.code})`);
    if (diagnostic.help) console.error(`  ${diagnostic.help}`);
  }

  if (violations.length > 0 || result.status !== 0) process.exitCode = result.status || 1;
}

try {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode !== '--fix' && mode !== '--check') throw new Error('expected --fix or --check');

  const files = selectedGeneratedFiles(arguments_);
  if (files.length > 0) {
    if (mode === '--fix') fixGeneratedFiles(files);
    else checkGeneratedFiles(files);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
