(() => {
  const assert = require('node:assert/strict');
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  interface PackageMetadata {
    engines?: {
      node?: string;
    };
  }

  interface RunOptions {
    cwd?: string;
  }

  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-node-packed-'));
  const run = (command: string, args: string[], options: RunOptions = {}): string =>
    childProcess.execFileSync(command, args, {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      stdio: 'pipe',
      ...options,
    });
  const readPackage = (file: string): PackageMetadata =>
    JSON.parse(fs.readFileSync(file, 'utf8')) as PackageMetadata;

  try {
    assert(fs.existsSync(path.join(dist, 'package.json')), 'Run pnpm build before packed-package tests');

    const packOutput = run('npm', ['pack', '--silent', '--pack-destination', temporaryDirectory], {
      cwd: dist,
    }).trim();
    const tarballName = packOutput.split(/\r?\n/).pop();
    assert(tarballName, 'npm pack did not report a tarball');
    const tarball = path.join(temporaryDirectory, tarballName);
    assert(fs.existsSync(tarball), `npm pack did not create ${tarball}`);

    fs.writeFileSync(
      path.join(temporaryDirectory, 'package.json'),
      JSON.stringify({ name: 'openai-packed-consumer', private: true, type: 'module' }),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.cjs'),
      [
        "const OpenAI = require('openai');",
        "const { bedrock } = require('openai/providers/bedrock');",
        "if (typeof OpenAI !== 'function') throw new Error('CommonJS default export is not constructable');",
        "if (typeof bedrock !== 'function') throw new Error('CommonJS Bedrock export is unavailable');",
        "new OpenAI({ apiKey: 'test' });",
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.mjs'),
      [
        "import OpenAI from 'openai';",
        "import { bedrock } from 'openai/providers/bedrock';",
        "if (typeof OpenAI !== 'function') throw new Error('ESM default export is not constructable');",
        "if (typeof bedrock !== 'function') throw new Error('ESM Bedrock export is unavailable');",
        "new OpenAI({ apiKey: 'test' });",
      ].join('\n'),
    );

    run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
    run(process.execPath, ['consumer.cjs']);
    run(process.execPath, ['consumer.mjs']);

    const sourcePackage = readPackage(path.join(root, 'package.json'));
    const installedPackage = readPackage(path.join(temporaryDirectory, 'node_modules/openai/package.json'));
    assert.deepEqual(
      installedPackage.engines,
      sourcePackage.engines,
      'Packed package engine metadata differs from package.json',
    );

    console.log(`Packed npm artifact passed CommonJS and ESM checks on ${process.version}.`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
