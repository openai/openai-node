#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'examples');
const manifestPath = path.join(examplesDir, 'manifest.json');
const readmePath = path.join(examplesDir, 'README.md');
const allowedLifecycles = new Set(['current', 'preview', 'deprecated']);
const requiredStringFields = ['path', 'title', 'category', 'api', 'runtime', 'lifecycle'];
const errors = [];

function collectTypeScriptFiles(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' ?
            []
          : collectTypeScriptFiles(path.join(dir, entry.name), relativePath);
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [relativePath] : [];
    })
    .sort();
}

function formatList(values) {
  return values.map((value) => `  - ${value}`).join('\n');
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Unable to read ${path.relative(root, manifestPath)}: ${error.message}`);
  process.exit(1);
}

if (!manifest || !Array.isArray(manifest.examples)) {
  console.error('examples/manifest.json must contain an "examples" array.');
  process.exit(1);
}

const entriesByPath = new Map();
for (const [index, entry] of manifest.examples.entries()) {
  const location = `examples[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${location} must be an object.`);
    continue;
  }

  for (const field of requiredStringFields) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      errors.push(`${location}.${field} must be a non-empty string.`);
    }
  }

  for (const field of ['credentials', 'dependencies']) {
    if (!Array.isArray(entry[field]) || entry[field].some((value) => typeof value !== 'string')) {
      errors.push(`${location}.${field} must be an array of strings.`);
    }
  }

  if (typeof entry.path !== 'string') continue;
  if (
    path.isAbsolute(entry.path) ||
    entry.path.includes('..') ||
    !entry.path.endsWith('.ts') ||
    entry.path.startsWith('/')
  ) {
    errors.push(`${location}.path must be a relative TypeScript path below examples/.`);
  }

  if (entriesByPath.has(entry.path)) {
    errors.push(`${location}.path duplicates ${entry.path}.`);
  } else {
    entriesByPath.set(entry.path, entry);
  }

  if (!allowedLifecycles.has(entry.lifecycle)) {
    errors.push(`${location}.lifecycle must be one of ${Array.from(allowedLifecycles).join(', ')}.`);
  }

  const expectedRun = `pnpm tsn examples/${entry.path}`;
  if (entry.run !== null && entry.run !== expectedRun) {
    errors.push(`${location}.run must be null or "${expectedRun}".`);
  }
}

const files = collectTypeScriptFiles(examplesDir);
const manifestPaths = Array.from(entriesByPath.keys()).sort();
const missingFromManifest = files.filter((file) => !entriesByPath.has(file));
const missingFromDisk = manifestPaths.filter((file) => !files.includes(file));

if (missingFromManifest.length > 0) {
  errors.push(`TypeScript examples missing from manifest:\n${formatList(missingFromManifest)}`);
}
if (missingFromDisk.length > 0) {
  errors.push(`Manifest paths missing from examples/:\n${formatList(missingFromDisk)}`);
}

const readme = fs.readFileSync(readmePath, 'utf8');
for (const file of manifestPaths) {
  if (!readme.includes(`](./${file})`)) {
    errors.push(`README.md does not link to ${file}.`);
  }
}

for (const match of readme.matchAll(/\]\(\.\/([^)]*\.ts)\)/g)) {
  const file = match[1];
  if (!files.includes(file)) {
    errors.push(`README.md links to a missing example: ${file}.`);
  }
}

if (errors.length > 0) {
  console.error('Example catalog check failed:\n');
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Checked ${files.length} TypeScript examples in examples/manifest.json.`);
