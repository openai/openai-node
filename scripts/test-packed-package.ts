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
    env?: NodeJS.ProcessEnv;
  }

  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-node-packed-'));
  const npmCache = path.join(temporaryDirectory, '.npm-cache');
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

    const packOutput = run(
      'npm',
      ['pack', '--silent', '--cache', npmCache, '--pack-destination', temporaryDirectory],
      { cwd: dist },
    ).trim();
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
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.ts'),
      [
        "import OpenAI, { AzureOpenAI } from 'openai';",
        "new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true });",
        'void AzureOpenAI;',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'tsconfig.json'),
      JSON.stringify({
        files: ['consumer.ts'],
        compilerOptions: {
          target: 'ES2020',
          lib: ['DOM', 'DOM.Iterable', 'ES2020'],
          module: 'Node16',
          moduleResolution: 'Node16',
          types: [],
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
      }),
    );

    run('npm', [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      npmCache,
      tarball,
    ]);

    const installedPackageRoot = path.join(temporaryDirectory, 'node_modules/openai');
    const installedSourceConfig = path.join(installedPackageRoot, 'src/tsconfig.json');
    const declarationMap = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'index.d.ts.map'), 'utf8'),
    ) as { sourceRoot?: string; sources: string[] };
    const isolatedEnvironment = { ...process.env };
    delete isolatedEnvironment['NODE_PATH'];

    assert(
      declarationMap.sources.some(
        (source) =>
          path.resolve(installedPackageRoot, declarationMap.sourceRoot ?? '', source) ===
          path.join(installedPackageRoot, 'src/index.ts'),
      ),
      'Packed declaration maps no longer navigate to the installed SDK source',
    );
    assert(
      !fs.existsSync(path.join(temporaryDirectory, 'node_modules/@types/node')),
      'Packed browser/edge consumer unexpectedly installed @types/node',
    );
    run(
      process.execPath,
      [
        '-e',
        "try { require.resolve('@types/node/package.json'); throw new Error('Unexpected inherited @types/node'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }",
      ],
      { env: isolatedEnvironment },
    );

    for (const compiler of [
      path.join(root, 'node_modules/typescript-4-9/bin/tsc'),
      path.join(root, 'node_modules/typescript/bin/tsc'),
    ]) {
      run(process.execPath, [compiler, '--project', path.join(temporaryDirectory, 'tsconfig.json')], {
        env: isolatedEnvironment,
      });
      run(process.execPath, [compiler, '--project', installedSourceConfig, '--noEmit'], {
        env: isolatedEnvironment,
      });
    }

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
