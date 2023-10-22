import path from 'path';
import * as tm from 'ts-morph';
import { name as pkgName } from '../package.json';
import fs from 'fs';

const rootDir = path.resolve(__dirname, '..');
const denoDir = path.join(rootDir, 'deno');
const tsConfigFilePath = path.join(rootDir, 'tsconfig.deno.json');

async function denoify() {
  const project = new tm.Project({ tsConfigFilePath });

  for (const file of project.getSourceFiles()) {
    if (!file.getFilePath().startsWith(denoDir + '/')) continue;

    let addedBuffer = false,
      addedProcess = false;
    file.forEachDescendant((node) => {
      switch (node.getKind()) {
        case tm.ts.SyntaxKind.ExportDeclaration: {
          const decl: tm.ExportDeclaration = node as any;
          if (decl.isTypeOnly()) return;
          for (const named of decl.getNamedExports()) {
            // Convert `export { Foo } from './foo.ts'`
            // to `export { type Foo } from './foo.ts'`
            // if `./foo.ts` only exports types for `Foo`
            if (!named.isTypeOnly() && !hasValueDeclarations(named)) {
              named.replaceWithText(`type ${named.getText()}`);
            }
          }
          break;
        }
        case tm.ts.SyntaxKind.ImportEqualsDeclaration: {
          const decl: tm.ImportEqualsDeclaration = node as any;
          if (decl.isTypeOnly()) return;

          const ref = decl.getModuleReference();
          if (!hasValueDeclarations(ref)) {
            const params = isBuiltinType(ref.getType()) ? [] : ref.getType().getTypeArguments();
            if (params.length) {
              const paramsStr = params.map((p: tm.TypeParameter) => p.getText()).join(', ');
              const bindingsStr = params
                .map((p: tm.TypeParameter) => p.getSymbol()?.getName() || p.getText())
                .join(', ');
              decl.replaceWithText(
                `export type ${decl.getName()}<${paramsStr}> = ${ref.getText()}<${bindingsStr}>`,
              );
            } else {
              decl.replaceWithText(`export type ${decl.getName()} = ${ref.getText()}`);
            }
          }
          break;
        }
        case tm.ts.SyntaxKind.Identifier: {
          const id = node as tm.Identifier;
          if (!addedBuffer && id.getText() === 'Buffer') {
            addedBuffer = true;
            file?.addVariableStatement({
              declarations: [
                {
                  name: 'Buffer',
                  type: 'any',
                },
              ],
              hasDeclareKeyword: true,
            });
            file?.addTypeAlias({
              name: 'Buffer',
              type: 'any',
            });
          }
          if (!addedProcess && id.getText() === 'process') {
            addedProcess = true;
            file?.addVariableStatement({
              declarations: [
                {
                  name: 'process',
                  type: 'any',
                },
              ],
              hasDeclareKeyword: true,
            });
          }
        }
      }
    });
  }

  await project.save();

  for (const file of project.getSourceFiles()) {
    if (!file.getFilePath().startsWith(denoDir + '/')) continue;
    for (const decl of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      const moduleSpecifier = decl.getModuleSpecifier();
      if (!moduleSpecifier) continue;
      let specifier = moduleSpecifier.getLiteralValue().replace(/^node:/, '');
      if (!specifier || specifier.startsWith('http')) continue;

      if (nodeStdModules.has(specifier)) {
        // convert node builtins to deno.land/std
        specifier = `https://deno.land/std@0.177.0/node/${specifier}.ts`;
      } else if (specifier.startsWith(pkgName + '/')) {
        // convert self-referencing module specifiers to relative paths
        specifier = file.getRelativePathAsModuleSpecifierTo(denoDir + specifier.substring(pkgName.length));
      } else if (specifier === 'qs') {
        decl.replaceWithText(`import { qs } from "https://deno.land/x/deno_qs@0.0.1/mod.ts"`);
        continue;
      } else if (!decl.isModuleSpecifierRelative()) {
        specifier = `npm:${specifier}`;
      }

      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        // there may be CJS directory module specifiers that implicitly resolve
        // to /index.ts.  Add an explicit /index.ts to the end
        const sourceFile = decl.getModuleSpecifierSourceFile();
        if (sourceFile && /\/index\.ts$/.test(sourceFile.getFilePath()) && !/\/mod\.ts$/.test(specifier)) {
          if (/\/index(\.ts)?$/.test(specifier)) {
            specifier = specifier.replace(/\/index(\.ts)?$/, '/mod.ts');
          } else {
            specifier += '/mod.ts';
          }
        }
        // add explicit .ts file extensions to relative module specifiers
        specifier = specifier.replace(/(\.[^./]*)?$/, '.ts');
      }
      moduleSpecifier.replaceWithText(JSON.stringify(specifier));
    }
  }

  await project.save();

  await Promise.all(
    project.getSourceFiles().map(async (f) => {
      const filePath = f.getFilePath();
      if (filePath.endsWith('index.ts')) {
        const newPath = filePath.replace(/index\.ts$/, 'mod.ts');
        await fs.promises.rename(filePath, newPath);
      }
    }),
  );
}

const nodeStdModules = new Set([
  'assert',
  'assertion_error',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'global',
  'http',
  'http2',
  'https',
  'inspector',
  'module_all',
  'module_esm',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'upstream_modules',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

const typeDeclarationKinds = new Set([
  tm.ts.SyntaxKind.InterfaceDeclaration,
  tm.ts.SyntaxKind.ModuleDeclaration,
  tm.ts.SyntaxKind.TypeAliasDeclaration,
]);

const builtinTypeNames = new Set(['Array', 'Set', 'Map', 'Record', 'Promise']);

function isBuiltinType(type: tm.Type): boolean {
  const symbol = type.getSymbol();
  return (
    symbol != null &&
    builtinTypeNames.has(symbol.getName()) &&
    symbol.getDeclarations().some((d) => d.getSourceFile().getFilePath().includes('node_modules/typescript'))
  );
}

function hasValueDeclarations(nodes?: tm.Node): boolean;
function hasValueDeclarations(nodes?: tm.Node[]): boolean;
function hasValueDeclarations(nodes?: tm.Node | tm.Node[]): boolean {
  if (nodes && !Array.isArray(nodes)) {
    return (
      !isBuiltinType(nodes.getType()) && hasValueDeclarations(nodes.getType().getSymbol()?.getDeclarations())
    );
  }
  return nodes ?
      nodes.some((n) => {
        const parent = n.getParent();
        return (
          !typeDeclarationKinds.has(n.getKind()) &&
          // sometimes the node will be the right hand side of a type alias
          (!parent || !typeDeclarationKinds.has(parent.getKind()))
        );
      })
    : false;
}

denoify();
