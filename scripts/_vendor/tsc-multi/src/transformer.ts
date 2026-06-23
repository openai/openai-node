import { resolve, dirname, extname, relative } from 'path';
import type ts from 'typescript';
import { trimSuffix } from './utils';
import assert from 'assert';

const JS_EXT = '.js';
const MJS_EXT = '.mjs';
const CJS_EXT = '.cjs';
const JSON_EXT = '.json';

function isRelativePath(path: string): boolean {
  return path.startsWith('./') || path.startsWith('../');
}

export interface TransformerOptions {
  extname: string;
  getResolvedShareHelpers(): string | undefined;
  pureClassAssignment: boolean;
  helpersNeeded: Set<string>;
  system: ts.System;
  ts: typeof ts;
}

function positionIsSynthesized(pos: number): boolean {
  // This is a fast way of testing the following conditions:
  //  pos === undefined || pos === null || isNaN(pos) || pos < 0;
  return !(pos >= 0);
}

function nodeIsSynthesized(range: ts.TextRange): boolean {
  return positionIsSynthesized(range.pos) || positionIsSynthesized(range.end);
}

export function createTransformer<T extends ts.SourceFile | ts.Bundle>(
  options: TransformerOptions,
): ts.TransformerFactory<T> {
  const {
    sys,
    factory,
    isStringLiteral,
    isImportDeclaration,
    isCallExpression,
    SyntaxKind,
    visitNode,
    visitEachChild,
    isIdentifier,
    isExportDeclaration,
    isVariableStatement,
    isSourceFile,
    isImportTypeNode,
    isLiteralTypeNode,
  } = options.ts;

  function isDirectory(sourceFile: ts.SourceFile, path: string): boolean {
    const sourcePath = sourceFile.fileName;
    const fullPath = resolve(dirname(sourcePath), path);

    return sys.directoryExists(fullPath);
  }

  function fileExists(sourceFile: ts.SourceFile, path: string): boolean {
    const sourcePath = sourceFile.fileName;
    const fullPath = resolve(dirname(sourcePath), path);

    return sys.fileExists(fullPath);
  }

  function updateModuleSpecifier<T extends ts.Node>(
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
    node: T,
  ): ts.LiteralExpression | T {
    if (!isStringLiteral(node) || !isRelativePath(node.text)) return node;

    const ext = extname(node.text);

    if (ext === MJS_EXT || ext === CJS_EXT) {
      return node;
    }

    if (ext === JSON_EXT && ctx.getCompilerOptions().resolveJsonModule) {
      return node;
    }

    const base = ext === JS_EXT ? trimSuffix(node.text, JS_EXT) : node.text;

    if (
      !(fileExists(sourceFile, `${base}.ts`) || fileExists(sourceFile, `${base}.js`)) &&
      isDirectory(sourceFile, node.text)
    ) {
      return factory.createStringLiteral(`${node.text}/index${options.extname}`);
    }

    return factory.createStringLiteral(`${base}${options.extname}`);
  }

  const tslibRequires = new WeakSet<ts.Node>();

  return (ctx) => {
    const resolvedShareHelpers = options.getResolvedShareHelpers();
    let sourceFile: ts.SourceFile;

    function getRelativeImport(mod: string) {
      const r = relative(dirname(sourceFile.fileName), mod);
      return /^\.?\.?\//.test(r) ? r : './' + r;
    }

    const visitor: ts.Visitor = (node) => {
      if (resolvedShareHelpers && isSourceFile(node)) {
        for (const helper of ((node as any).emitNode?.helpers as any[]) ?? []) {
          if (!helper.scoped) {
            options.helpersNeeded.add(helper.importName);
          }
        }
      }

      if (resolvedShareHelpers) {
        if (
          isImportDeclaration(node) &&
          nodeIsSynthesized(node) &&
          isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === 'tslib'
        ) {
          return factory.createImportDeclaration(
            node.modifiers,
            node.importClause,
            factory.createStringLiteral(getRelativeImport(resolvedShareHelpers)),
            node.attributes,
          );
        }
        if (isVariableStatement(node)) {
          const requireCall = node.declarationList.declarations[0]?.initializer;
          let original: ts.Node;
          if (
            requireCall &&
            isCallExpression(requireCall) &&
            isIdentifier(requireCall.expression) &&
            requireCall.expression.escapedText === 'require' &&
            'original' in node &&
            typeof node.original === 'object' &&
            node.original !== null &&
            ((original = node.original as ts.Node), nodeIsSynthesized(original)) &&
            (isImportDeclaration(original) ?
              isStringLiteral(original.moduleSpecifier) && original.moduleSpecifier.text === 'tslib'
            : options.ts.isImportEqualsDeclaration(original) &&
              options.ts.isExternalModuleReference(original.moduleReference) &&
              isStringLiteral(original.moduleReference.expression) &&
              original.moduleReference.expression.text === 'tslib')
          ) {
            tslibRequires.add(requireCall);
          }
        }
      }

      // ESM import
      if (isImportDeclaration(node)) {
        return factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          updateModuleSpecifier(ctx, sourceFile, node.moduleSpecifier),
          node.attributes,
        );
      }

      // ESM export
      if (isExportDeclaration(node)) {
        if (!node.moduleSpecifier) return node;

        return factory.updateExportDeclaration(
          node,
          node.modifiers,
          node.isTypeOnly,
          node.exportClause,
          updateModuleSpecifier(ctx, sourceFile, node.moduleSpecifier),
          node.attributes,
        );
      }

      // ESM dynamic import
      if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
        const [firstArg, ...restArg] = node.arguments;
        if (!firstArg) return node;

        return factory.updateCallExpression(node, node.expression, node.typeArguments, [
          updateModuleSpecifier(ctx, sourceFile, firstArg),
          ...restArg,
        ]);
      }

      // CommonJS require
      if (
        isCallExpression(node) &&
        isIdentifier(node.expression) &&
        node.expression.escapedText === 'require'
      ) {
        const [firstArg, ...restArgs] = node.arguments;
        if (!firstArg) return node;

        return factory.updateCallExpression(node, node.expression, node.typeArguments, [
          resolvedShareHelpers && tslibRequires.has(node) ?
            factory.createStringLiteral(getRelativeImport(resolvedShareHelpers))
          : updateModuleSpecifier(ctx, sourceFile, firstArg),
          ...restArgs,
        ]);
      }

      if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
        return factory.updateImportTypeNode(
          node,
          factory.createLiteralTypeNode(updateModuleSpecifier(ctx, sourceFile, node.argument.literal)),
          node.attributes,
          node.qualifier,
          node.typeArguments,
          node.isTypeOf,
        );
      }

      return visitEachChild(node, visitor, ctx);
    };

    const pureClassAssignment = (sourceFile: ts.SourceFile) => {
      if (!options.pureClassAssignment) return sourceFile;
      const newStatements = [];
      const classes: Record<
        string,
        [ts.ClassDeclaration & { name: ts.Identifier }, ...ts.ExpressionStatement[]]
      > = Object.create(null);
      const shouldGroupExpression = (expression: ts.Expression): string | undefined => {
        if (options.ts.isBinaryExpression(expression)) {
          if (expression.operatorToken.kind === SyntaxKind.EqualsToken) {
            if (
              options.ts.isPropertyAccessExpression(expression.left) &&
              options.ts.isIdentifier(expression.left.expression) &&
              classes[expression.left.expression.text]
            ) {
              return expression.left.expression.text;
            } else if (
              options.ts.isIdentifier(expression.left) &&
              options.ts.isIdentifier(expression.right) &&
              classes[expression.right.text] &&
              (expression.left as any)?.emitNode?.autoGenerate
            ) {
              return expression.right.text;
            } else if (options.ts.isIdentifier(expression.left)) {
              // _BaseCloudflare_encoder = new WeakMap();
              const cls = (expression.left as any)?.emitNode?.autoGenerate?.prefix?.node?.text;
              if (classes[cls]) {
                return cls;
              }
            }
          } else if (expression.operatorToken.kind === SyntaxKind.CommaToken) {
            return shouldGroupExpression(expression.right) || shouldGroupExpression(expression.left);
          }
        }
      };
      for (const statement of sourceFile.statements) {
        if (options.ts.isClassDeclaration(statement) && statement.name && !classes[statement.name.text]) {
          newStatements.push(
            (classes[statement.name.text] = [statement as typeof statement & { name: ts.Identifier }]),
          );
          continue;
        } else if (options.ts.isExpressionStatement(statement)) {
          const cls = shouldGroupExpression(statement.expression);
          if (cls) {
            classes[cls].push(statement);
            continue;
          }
        }
        newStatements.push(statement);
      }
      return ctx.factory.updateSourceFile(
        sourceFile,
        newStatements.map((group) =>
          Array.isArray(group) ?
            (
              group.length === 1 &&
              !(
                group[0].members.some((member) => member.name?.kind === SyntaxKind.ComputedPropertyName) ||
                group[0].heritageClauses?.some(
                  (e) =>
                    e.token === SyntaxKind.ExtendsKeyword &&
                    isIdentifier(e.types[0].expression) &&
                    /^(Object|Function|Array|Number|Boolean|String|Symbol|Date|Promise|RegExp|Error|AggregateError|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|ArrayBuffer|Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|Uint8ClampedArray|BigUint64Array|BigInt64Array|DataView|Map|BigInt|Set|WeakMap|WeakSet|Proxy|FinalizationRegistry|WeakRef|URL|URLSearchParams|Event|EventTarget|Iterator|SharedArrayBuffer|CustomEvent)$/.test(
                      e.types[0].expression.text,
                    ),
                )
              )
            ) ?
              group[0]
            : ctx.factory.createVariableStatement(group[0].modifiers, [
                ctx.factory.createVariableDeclaration(
                  group[0].name.text,
                  undefined,
                  undefined,
                  options.ts.addSyntheticLeadingComment(
                    ctx.factory.createImmediatelyInvokedArrowFunction([
                      ctx.factory.updateClassDeclaration(
                        group[0],
                        [],
                        group[0].name,
                        group[0].typeParameters,
                        group[0].heritageClauses,
                        group[0].members,
                      ),
                      ...group.slice(1),
                      ctx.factory.createReturnStatement(ctx.factory.createIdentifier(group[0].name.text)),
                    ]),
                    SyntaxKind.MultiLineCommentTrivia,
                    ' @__PURE__ ',
                    false,
                  ),
                ),
              ])
          : group,
        ),
      );
    };

    return (file) => {
      if (options.ts.isSourceFile(file)) {
        sourceFile = file;
        return pureClassAssignment(visitNode(file, visitor) as ts.SourceFile);
      } else if (options.ts.isBundle(file)) {
        return ctx.factory.createBundle(
          file.sourceFiles.map((file) => {
            sourceFile = file;
            return pureClassAssignment(visitNode(file, visitor) as ts.SourceFile);
          }),
        ) as any;
      } else {
        assert(false);
      }
    };
  };
}
