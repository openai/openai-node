import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = process.cwd();
const cli = path.join(repoRoot, 'scripts/_vendor/tsc-multi/src/cli.ts');
const register = createRequire(path.join(repoRoot, 'package.json')).resolve(
  'ts-node/register/transpile-only',
);

describe('tsc-multi declaration-file specifiers', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-tsc-declaration-specifiers-'));
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function writeFixture(relative: string, contents: string) {
    const file = path.join(fixture, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  test.each([
    { module: 'commonjs', extname: '.js', declaration: '.d.ts' },
    { module: 'esnext', extname: '.mjs', declaration: '.d.mts' },
  ])('preserves explicit declaration paths in $module output', ({ module, extname, declaration }) => {
    writeFixture('types/plain.d.ts', 'export interface Plain { plain: true }');
    writeFixture('types/module.d.mts', 'export interface Module { module: true }');
    writeFixture('types/common.d.cts', 'export interface Common { common: true }');
    writeFixture('src/value.ts', 'export const value = 7;');
    for (const suffix of ['.d.ts', '.d.mts', '.d.cts']) {
      writeFixture(`src/directory${suffix}/index.ts`, 'export const value = 8;');
    }
    writeFixture(
      'src/index.ts',
      [
        "import type { Plain } from '../types/plain.d.ts';",
        "import { value } from './value.js';",
        'export interface UsesPlain { value: Plain }',
        "export type { Plain } from '../types/plain.d.ts';",
        "export type Module = import('../types/module.d.mts', { with: { 'resolution-mode': 'import' } }).Module;",
        "export type Common = import('../types/common.d.cts').Common;",
        'export const staticValue = value;',
        "export { value as reexportedValue } from './value.js';",
        "export async function dynamicValue() { return (await import('./value.js')).value; }",
        "export { value as tsDirectoryValue } from './directory.d.ts';",
        "export { value as mtsDirectoryValue } from './directory.d.mts';",
        "export { value as ctsDirectoryValue } from './directory.d.cts';",
      ].join('\n'),
    );
    writeFixture(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'es2020',
          moduleResolution: 'bundler',
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
          types: [],
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    );
    writeFixture(
      'tsc-multi.json',
      JSON.stringify({ projects: ['tsconfig.json'], targets: [{ module, extname }] }),
    );

    const build = spawnSync(process.execPath, ['-r', register, cli, '--cwd', fixture, '--maxWorkers', '1'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    expect(build.error).toBeUndefined();
    expect(build.signal).toBeNull();
    expect(build.status).toBe(0);
    expect(build.stderr).toContain('Found 0 errors.');

    const declarationPath = path.join(fixture, `dist/index${declaration}`);
    const specifiers = ts
      .preProcessFile(readFileSync(declarationPath, 'utf-8'))
      .importedFiles.map(({ fileName }) => fileName);
    expect(new Set(specifiers)).toEqual(
      new Set([
        '../types/plain.d.ts',
        '../types/module.d.mts',
        '../types/common.d.cts',
        `./value${extname}`,
        `./directory.d.ts/index${extname}`,
        `./directory.d.mts/index${extname}`,
        `./directory.d.cts/index${extname}`,
      ]),
    );

    writeFixture(
      'consumer.ts',
      [
        `import type { Plain, Module, Common } from './dist/index${extname}';`,
        'const plain: Plain = { plain: true };',
        'const module: Module = { module: true };',
        'const common: Common = { common: true };',
        'void [plain, module, common];',
      ].join('\n'),
    );
    const consumer = ts.createProgram([path.join(fixture, 'consumer.ts')], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      strict: true,
      types: [],
    });
    expect(ts.getPreEmitDiagnostics(consumer)).toEqual([]);

    const artifact = path.join(fixture, `dist/index${extname}`);
    const program =
      module === 'commonjs'
        ? '(async () => { const artifact = require(process.argv[1]); console.log(JSON.stringify([artifact.staticValue, artifact.reexportedValue, await artifact.dynamicValue(), artifact.tsDirectoryValue, artifact.mtsDirectoryValue, artifact.ctsDirectoryValue])); })();'
        : '(async () => { const artifact = await import(process.argv[1]); console.log(JSON.stringify([artifact.staticValue, artifact.reexportedValue, await artifact.dynamicValue(), artifact.tsDirectoryValue, artifact.mtsDirectoryValue, artifact.ctsDirectoryValue])); })();';
    const runtime = spawnSync(
      process.execPath,
      [
        ...(module === 'esnext' ? ['--input-type=module'] : []),
        '-e',
        program,
        module === 'commonjs' ? artifact : pathToFileURL(artifact).href,
      ],
      { cwd: fixture, encoding: 'utf-8', timeout: 15_000 },
    );
    expect(runtime.error).toBeUndefined();
    expect(runtime.signal).toBeNull();
    expect(runtime.status).toBe(0);
    expect(JSON.parse(runtime.stdout)).toEqual([7, 7, 7, 8, 8, 8]);
  });
});
