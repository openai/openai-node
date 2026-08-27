import type { Dirent } from 'node:fs';

const packedPackageAcorn: {
  parse: (source: string, options: { ecmaVersion: 2020; sourceType: 'module' }) => unknown;
} = require(require.resolve('acorn', { paths: [require.resolve('ts-node/package.json')] }));
const packedPackageAssert = require('node:assert/strict');
const packedPackageChildProcess = require('node:child_process');
const packedPackageFs = require('node:fs');
const packedPackageOs = require('node:os');
const packedPackagePath = require('node:path');

(() => {
  const assert = packedPackageAssert;
  const childProcess = packedPackageChildProcess;
  const fs = packedPackageFs;
  const os = packedPackageOs;
  const path = packedPackagePath;
  interface PackageMetadata {
    engines?: {
      node?: string;
    };
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  }

  interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }

  interface SourceMap {
    sourceRoot?: string;
    sources: string[];
  }

  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-node-packed-'));
  const npmCache = path.join(temporaryDirectory, '.npm-cache');
  const authExportNames = [
    'k8sServiceAccountTokenProvider',
    'azureManagedIdentityTokenProvider',
    'gcpIDTokenProvider',
    'OAuthError',
    'SubjectTokenProviderError',
  ];
  const run = (command: string, args: string[], options: RunOptions = {}): string =>
    childProcess.execFileSync(command, args, {
      cwd: temporaryDirectory,
      encoding: 'utf-8',
      stdio: 'pipe',
      ...options,
    });
  const readPackage = (file: string): PackageMetadata =>
    JSON.parse(fs.readFileSync(file, 'utf-8')) as PackageMetadata;
  const findSourceMaps = (directory: string): string[] => {
    const maps: string[] = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true }) as Dirent[];
    for (const entry of entries) {
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        maps.push(...findSourceMaps(resolved));
      } else if (entry.isFile() && entry.name.endsWith('.map')) {
        maps.push(resolved);
      }
    }
    return maps;
  };
  const standaloneZodParsers = new Set([
    '_vendor/zod-to-json-schema/parsers/any.ts',
    '_vendor/zod-to-json-schema/parsers/boolean.ts',
    '_vendor/zod-to-json-schema/parsers/never.ts',
    '_vendor/zod-to-json-schema/parsers/undefined.ts',
    '_vendor/zod-to-json-schema/parsers/unknown.ts',
  ]);
  const requiresOptionalPeer = (source: string): boolean =>
    (source.startsWith('_vendor/zod-to-json-schema/') && !standaloneZodParsers.has(source)) ||
    source === 'helpers/zod.ts' ||
    source === 'helpers/audio.ts' ||
    source === 'providers/bedrock/aws.ts' ||
    source === 'auth/x509-transport.ts' ||
    source === 'internal/auth/x509-transport-capability.ts' ||
    source === 'internal/auth/x509-token-exchange.ts' ||
    source === 'auth/index.ts' ||
    source === 'auth/subject-token-providers.ts';

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
        "const auth = require('openai/auth');",
        "if (typeof OpenAI !== 'function') throw new Error('CommonJS default export is not constructable');",
        "if (typeof bedrock !== 'function') throw new Error('CommonJS Bedrock export is unavailable');",
        ...authExportNames.map(
          (name) =>
            `if (typeof auth.${name} !== 'function') throw new Error('CommonJS auth export ${name} is unavailable');`,
        ),
        "new OpenAI({ apiKey: 'test' });",
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.mjs'),
      [
        "import OpenAI from 'openai';",
        "import { bedrock } from 'openai/providers/bedrock';",
        `import { ${authExportNames.join(', ')} } from 'openai/auth';`,
        "if (typeof OpenAI !== 'function') throw new Error('ESM default export is not constructable');",
        "if (typeof bedrock !== 'function') throw new Error('ESM Bedrock export is unavailable');",
        ...authExportNames.map(
          (name) =>
            `if (typeof ${name} !== 'function') throw new Error('ESM auth export ${name} is unavailable');`,
        ),
        "new OpenAI({ apiKey: 'test' });",
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.ts'),
      [
        "import OpenAI, { AzureOpenAI } from 'openai';",
        `import { ${authExportNames.join(', ')} } from 'openai/auth';`,
        "import type { WorkloadIdentity } from 'openai/auth';",
        "import type { ResponsesWS } from 'openai/resources/responses/ws';",
        "import type { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';",
        "import type { OpenAIRealtimeWS as RealtimeWS } from 'openai/realtime/ws';",
        "import type { OpenAIRealtimeWS as BetaRealtimeWS } from 'openai/beta/realtime/ws';",
        "new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true });",
        'void AzureOpenAI;',
        ...authExportNames.map((name) => `void ${name};`),
        'void (null as unknown as WorkloadIdentity);',
        'void (null as unknown as ResponsesWS | BetaResponsesWS | RealtimeWS | BetaRealtimeWS);',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'consumer.cts'),
      [
        `import { ${authExportNames.join(', ')} } from 'openai/auth';`,
        "import type { WorkloadIdentity } from 'openai/auth';",
        ...authExportNames.map((name) => `void ${name};`),
        'void (null as unknown as WorkloadIdentity);',
      ].join('\n'),
    );
    const websocketPeer = path.join(temporaryDirectory, 'websocket-peer.d.ts');
    fs.writeFileSync(
      websocketPeer,
      [
        "declare module 'ws' {",
        '  export interface ClientOptions {',
        '    headers?: Record<string, string> | undefined;',
        '  }',
        '  export class WebSocket {',
        '    constructor(address: string | URL, options?: ClientOptions);',
        '    readonly readyState: number;',
        '    send(data: string | ArrayBufferLike | ArrayBufferView): void;',
        '    close(code?: number, reason?: string): void;',
        '    terminate(): void;',
        "    on(event: 'message', listener: (data: ArrayBuffer | Uint8Array | Uint8Array[], isBinary: boolean) => void): this;",
        "    on(event: 'error', listener: (error: Error) => void): this;",
        "    on(event: 'redirect', listener: (url: string, request: { getHeaders(): Record<string, string | string[] | undefined> }) => void): this;",
        '    on(event: string, listener: (...args: unknown[]) => void): this;',
        '    removeListener(event: string, listener: (...args: unknown[]) => void): this;',
        '  }',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'tsconfig.json'),
      JSON.stringify({
        files: ['consumer.ts', 'consumer.cts', 'websocket-peer.d.ts'],
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
    const bundlerConfig = path.join(temporaryDirectory, 'bundler.tsconfig.json');
    fs.writeFileSync(
      bundlerConfig,
      JSON.stringify({
        extends: './tsconfig.json',
        files: ['consumer.ts', 'websocket-peer.d.ts'],
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
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

    const optionalUndici = path.join(temporaryDirectory, 'node_modules/undici');
    assert(!fs.existsSync(optionalUndici), 'Public authentication helpers must not require optional Undici');

    const isolatedEnvironment = { ...process.env };
    delete isolatedEnvironment['NODE_PATH'];
    const browserConsumer = path.join(temporaryDirectory, 'browser-consumer.mjs');
    fs.writeFileSync(browserConsumer, "import OpenAI from 'openai';\nexport default OpenAI;\n");
    const browserConfig = path.join(temporaryDirectory, 'browser.vite.config.mjs');
    fs.writeFileSync(
      browserConfig,
      [
        "import { isBuiltin } from 'node:module';",
        'export default {',
        '  plugins: [{',
        "    name: 'reject-node-builtins',",
        "    enforce: 'pre',",
        '    resolveId(source) {',
        '      if (isBuiltin(source)) {',
        '        this.error("Node-only dependency " + source + " reached the browser bundle");',
        '      }',
        '    },',
        '  }],',
        '  build: {',
        "    target: 'es2020',",
        '    minify: false,',
        "    lib: { entry: './browser-consumer.mjs', formats: ['es'], fileName: () => 'browser-bundle.mjs' },",
        '  },',
        '};',
      ].join('\n'),
    );
    const vitePackage = require.resolve('vite/package.json', {
      paths: [require.resolve('vitest/package.json')],
    });
    run(
      process.execPath,
      [
        path.join(path.dirname(vitePackage), 'bin/vite.js'),
        'build',
        '--config',
        browserConfig,
        '--logLevel',
        'error',
      ],
      { env: isolatedEnvironment },
    );
    const browserBundle = path.join(temporaryDirectory, 'dist/browser-bundle.mjs');
    assert(fs.existsSync(browserBundle), 'Packed browser consumer did not produce an ES2020 ESM bundle');
    assert.doesNotThrow(
      () =>
        packedPackageAcorn.parse(fs.readFileSync(browserBundle, 'utf-8'), {
          ecmaVersion: 2020,
          sourceType: 'module',
        }),
      'Packed browser bundle contains syntax unsupported by ES2020, including top-level await',
    );

    for (const [inputType, authenticationImport] of [
      ['commonjs', "const auth = require('openai/auth');"],
      ['module', "import * as auth from 'openai/auth';"],
    ] as const) {
      run(process.execPath, [
        `--input-type=${inputType}`,
        '--eval',
        `${authenticationImport} if (typeof auth.k8sServiceAccountTokenProvider !== 'function') throw new Error('Public authentication exports are unavailable');`,
      ]);
    }
    assert(!fs.existsSync(optionalUndici), 'Importing public authentication helpers must not install Undici');

    const privateX509Modules = [
      'openai/internal/auth/x509-transport-capability',
      'openai/internal/auth/x509-transport-capability.js',
      'openai/internal/auth/x509-transport-capability.mjs',
      'openai/internal/auth/x509-transport-registry',
      'openai/internal/auth/x509-transport-registry.js',
      'openai/internal/auth/x509-transport-registry.mjs',
      'openai/internal/auth/x509-credential-options',
      'openai/internal/auth/x509-credential-options.js',
      'openai/internal/auth/x509-credential-options.mjs',
      'openai/internal/auth/x509-api-origin',
      'openai/internal/auth/x509-api-origin.js',
      'openai/internal/auth/x509-api-origin.mjs',
      'openai/internal/auth/x509-transport-state',
      'openai/internal/auth/x509-transport-state.cjs',
      'openai/internal/auth/x509-transport-state-browser',
      'openai/internal/auth/x509-transport-state-browser.js',
      'openai/internal/auth/x509-transport-state-browser.mjs',
    ];
    const moduleNames = JSON.stringify(privateX509Modules);
    run(process.execPath, [
      '--input-type=commonjs',
      '--eval',
      `for (const name of ${moduleNames}) { try { require(name); throw new Error(name + ' is publicly accessible'); } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; } }`,
    ]);
    run(process.execPath, [
      '--input-type=module',
      '--eval',
      `for (const name of ${moduleNames}) { try { await import(name); throw new Error(name + ' is publicly accessible'); } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; } }`,
    ]);

    const unsupportedDispatcher =
      'assert.throws(direct, /Undici 5\\.2\\.0 or later/u); assert.throws(httpConnect, /Undici 5\\.2\\.0 or later/u); assert.throws(httpsConnect, /Undici 5\\.2\\.0 or later/u);';
    const unsupportedProxy =
      'assert.doesNotThrow(direct); assert.throws(httpConnect, /CONNECT.*Undici 5\\.5\\.1 or later/u); assert.throws(httpsConnect, /CONNECT.*Undici 5\\.5\\.1 or later/u);';
    const supportedTransports =
      'assert.doesNotThrow(direct); assert.doesNotThrow(httpConnect); assert.doesNotThrow(httpsConnect);';
    const certificateFixture = JSON.parse(
      run(
        process.execPath,
        [
          '-r',
          path.join(root, 'node_modules/ts-node/register/transpile-only'),
          '-e',
          [
            `const { createX509TestLab } = require(${JSON.stringify(path.join(root, 'tests/utils/x509-test-lab.ts'))});`,
            'const { firstClient } = createX509TestLab();',
            'process.stdout.write(JSON.stringify({ certificateChain: firstClient.certificate.toString(), privateKey: firstClient.privateKey.toString() }));',
          ].join(' '),
        ],
        { cwd: root },
      ),
    ) as { certificateChain: string; privateKey: string };

    for (const [undiciVersion, transportAssertions] of [
      ['5.1.1', unsupportedDispatcher],
      ['5.2.0', unsupportedProxy],
      ['5.5.0', unsupportedProxy],
      ['5.5.1', supportedTransports],
      ['6.28.0', supportedTransports],
      ['7.0.0', supportedTransports],
    ] as const) {
      const consumer = path.join(temporaryDirectory, `legacy-undici-${undiciVersion}`);
      fs.mkdirSync(consumer);
      const packedUndici = run('npm', [
        'pack',
        '--silent',
        '--ignore-scripts',
        '--cache',
        npmCache,
        '--pack-destination',
        temporaryDirectory,
        `undici@${undiciVersion}`,
      ])
        .trim()
        .split(/\r?\n/)
        .pop();
      assert(packedUndici, `npm pack did not report the genuine Undici ${undiciVersion} release`);
      fs.writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ name: `legacy-undici-${undiciVersion}-consumer`, private: true }),
      );
      const installation = childProcess.spawnSync(
        'npm',
        [
          'install',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--cache',
          npmCache,
          tarball,
          path.join(temporaryDirectory, packedUndici),
        ],
        { cwd: consumer, encoding: 'utf-8' },
      );
      assert.equal(
        installation.status,
        0,
        `An existing Undici ${undiciVersion} consumer could not install the SDK: ${installation.stderr}`,
      );
      assert.doesNotMatch(
        installation.stderr,
        /ERESOLVE/u,
        `An existing Undici ${undiciVersion} consumer encountered an optional-peer conflict`,
      );
      run(process.execPath, ['-e', "require('openai')"], { cwd: consumer });
      for (const [inputType, imports] of [
        [
          'commonjs',
          "const assert = require('node:assert/strict'); const OpenAI = require('openai'); const { Agent, ProxyAgent } = require('undici'); const { createX509Transport, fromX509, workloadIdentity } = require('openai/auth/x509-transport');",
        ],
        [
          'module',
          "import assert from 'node:assert/strict'; import OpenAI from 'openai'; import { Agent, ProxyAgent } from 'undici'; import { createX509Transport, fromX509, workloadIdentity } from 'openai/auth/x509-transport';",
        ],
      ]) {
        run(
          process.execPath,
          [
            `--input-type=${inputType}`,
            '-e',
            [
              imports,
              'const dispatcher = new Agent();',
              "const proxyDispatcher = new ProxyAgent({ uri: 'http://127.0.0.1:1' });",
              "const secureProxyDispatcher = new ProxyAgent({ uri: 'https://127.0.0.1:1' });",
              "const direct = () => createX509Transport({ runtime: 'node', dispatcher, certificateIdentity: 'static', proxy: 'direct' });",
              "const httpConnect = () => createX509Transport({ runtime: 'node', dispatcher: proxyDispatcher, certificateIdentity: 'static', proxy: 'http-connect' });",
              "const httpsConnect = () => createX509Transport({ runtime: 'node', dispatcher: secureProxyDispatcher, certificateIdentity: 'static', proxy: 'https-connect' });",
              transportAssertions,
              'assert.equal(workloadIdentity.fromX509, fromX509);',
              `const credentialOptions = { ...${JSON.stringify(certificateFixture)}, identityProviderId: 'synthetic-provider', serviceAccountId: 'synthetic-account' };`,
              undiciVersion === '5.1.1'
                ? 'assert.throws(() => fromX509(credentialOptions), /Undici 5\\.2\\.0 or later/u);'
                : 'const credential = fromX509(credentialOptions); new OpenAI({ credential }); credential.close();',
              'dispatcher.close(); proxyDispatcher.close(); secureProxyDispatcher.close();',
            ].join(' '),
          ],
          { cwd: consumer },
        );
      }
    }

    const installedPackageRoot = path.join(temporaryDirectory, 'node_modules/openai');
    const installedSourceRoot = path.join(installedPackageRoot, 'src');
    const installedSourceConfig = path.join(installedSourceRoot, 'tsconfig.json');
    const installedSourceShim = path.join(installedSourceRoot, 'tsconfig.dist-src.d.ts');

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

    const mappedSources = new Map<string, string>();
    const sourceMaps = findSourceMaps(installedPackageRoot);
    sourceMaps.sort();
    for (const mapPath of sourceMaps) {
      const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as SourceMap;
      for (const source of sourceMap.sources) {
        const resolvedSource: string = path.resolve(
          path.dirname(mapPath),
          sourceMap.sourceRoot ?? '',
          source,
        );
        const relativeSource: string = path.relative(installedSourceRoot, resolvedSource);
        assert(
          relativeSource !== '..' &&
            !relativeSource.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relativeSource),
          `Packed source map resolves outside its published source directory: ${mapPath}`,
        );
        assert(fs.existsSync(resolvedSource), `Packed source-map source is missing: ${resolvedSource}`);
        mappedSources.set(relativeSource.split(path.sep).join('/'), resolvedSource);
      }
    }

    assert.equal(
      mappedSources.get('index.ts'),
      path.join(installedSourceRoot, 'index.ts'),
      'Packed source maps no longer navigate to the installed SDK source',
    );

    for (const websocketSource of [
      'resources/responses/ws',
      'resources/beta/responses/ws',
      'realtime/ws',
      'beta/realtime/ws',
      'internal/ws-adapter-node',
    ]) {
      for (const extension of ['.d.ts.map', '.d.mts.map', '.js.map', '.mjs.map']) {
        const websocketMap = `${websocketSource}${extension}`;
        assert(
          fs.existsSync(path.join(installedPackageRoot, websocketMap)),
          `Packed websocket source map is missing: ${websocketMap}`,
        );
      }
    }

    // Zod/AWS helpers require optional peers; Node-only helpers require @types/node.
    // Validate every other mapped source without installing either in this consumer.
    const browserSafeSources = [...mappedSources.entries()]
      .filter(([source]) => !requiresOptionalPeer(source))
      .map(([, source]) => source);
    browserSafeSources.sort();
    const sourceNavigationConfig = path.join(temporaryDirectory, 'source-navigation.tsconfig.json');
    fs.writeFileSync(
      sourceNavigationConfig,
      JSON.stringify({
        extends: installedSourceConfig,
        files: [installedSourceShim, websocketPeer, ...browserSafeSources],
        include: [],
        exclude: [],
        compilerOptions: {
          types: [],
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
      }),
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
      run(process.execPath, [compiler, '--project', sourceNavigationConfig], {
        env: isolatedEnvironment,
      });
    }
    run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', bundlerConfig], {
      env: isolatedEnvironment,
    });

    run(process.execPath, ['consumer.cjs']);
    run(process.execPath, ['consumer.mjs']);

    const sourcePackage = readPackage(path.join(root, 'package.json'));
    const installedPackage = readPackage(path.join(temporaryDirectory, 'node_modules/openai/package.json'));
    assert.deepEqual(
      installedPackage.engines,
      sourcePackage.engines,
      'Packed package engine metadata differs from package.json',
    );
    assert.equal(
      fs.readFileSync(
        path.join(temporaryDirectory, 'node_modules/openai/src/_vendor/partial-json-parser/LICENSE'),
        'utf-8',
      ),
      fs.readFileSync(path.join(root, 'src/_vendor/partial-json-parser/LICENSE'), 'utf-8'),
      'Packed package must preserve the vendored partial-json license',
    );
    assert.equal(installedPackage.peerDependencies?.['undici'], '>=5 <9');
    assert.equal(installedPackage.peerDependenciesMeta?.['undici']?.optional, true);
    assert.equal(installedPackage.peerDependencies?.['ws'], '^8.21.0');
    assert.equal(installedPackage.peerDependenciesMeta?.['ws']?.optional, true);
    assert(!fs.existsSync(optionalUndici), 'Undici must remain optional for ordinary SDK consumers');
    run(process.execPath, [
      '--conditions=browser',
      '--input-type=module',
      '--eval',
      "import OpenAI from 'openai'; new OpenAI({ apiKey: 'synthetic-browser-api-key', dangerouslyAllowBrowser: true });",
    ]);
    fs.symlinkSync(path.join(root, 'node_modules/undici'), optionalUndici, 'dir');
    for (const [inputType, consumer] of [
      [
        'commonjs',
        "const OpenAI = require('openai'); const { Agent } = require('undici'); const { createX509Transport, fromX509, workloadIdentity } = require('openai/auth/x509-transport');",
      ],
      [
        'module',
        "import OpenAI from 'openai'; import { Agent } from 'undici'; import { createX509Transport, fromX509, workloadIdentity } from 'openai/auth/x509-transport';",
      ],
      [
        'module',
        "import OpenAI from 'openai'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { Agent } = require('undici'); const { createX509Transport, fromX509, workloadIdentity } = require('openai/auth/x509-transport');",
      ],
      [
        'module',
        "import { createRequire } from 'node:module'; import { Agent } from 'undici'; import { createX509Transport, fromX509, workloadIdentity } from 'openai/auth/x509-transport'; const OpenAI = createRequire(import.meta.url)('openai');",
      ],
    ]) {
      run(process.execPath, [
        `--input-type=${inputType}`,
        '-e',
        `${consumer} if (workloadIdentity.fromX509 !== fromX509) throw new Error('First-class X.509 factory is unavailable'); const credential = fromX509({ ...${JSON.stringify(certificateFixture)}, identityProviderId: 'synthetic-provider', serviceAccountId: 'synthetic-account' }); new OpenAI({ credential }); credential.close(); const dispatcher = new Agent(); const transport = createX509Transport({ runtime: 'node', dispatcher, certificateIdentity: 'static', proxy: 'direct' }); if (!Object.isFrozen(transport)) throw new Error('X.509 transport capability is not frozen'); new OpenAI({ apiKey: null, workloadIdentity: { type: 'x509', identityProviderId: 'synthetic-provider', serviceAccountId: 'synthetic-account' }, x509Transport: transport }); dispatcher.close();`,
      ]);
    }

    console.log(
      `Packed npm artifact passed CommonJS, ESM, ES2020 browser bundling, and ${browserSafeSources.length}/${mappedSources.size} source checks across ${sourceMaps.length} source maps on ${process.version}.`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
