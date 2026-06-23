import { readFile } from 'fs/promises';
import ts from 'typescript';

export function trimPrefix(input: string, prefix: string): string {
  if (input.startsWith(prefix)) {
    return input.substring(prefix.length);
  }

  return input;
}

export function trimSuffix(input: string, suffix: string): string {
  if (input.endsWith(suffix)) {
    return input.substring(0, input.length - suffix.length);
  }

  return input;
}

export async function readJSON(path: string): Promise<any> {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

export async function tryReadJSON(path: string): Promise<any> {
  try {
    return await readJSON(path);
  } catch (err: any) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function mergeArray<T>(target: T[] = [], source: T[] = []): T[] {
  return [...target, ...source];
}

export function mergeCustomTransformers(
  target: ts.CustomTransformers,
  source: ts.CustomTransformers,
): ts.CustomTransformers {
  return {
    before: mergeArray(target.before, source.before),
    after: mergeArray(target.after, source.after),
    afterDeclarations: mergeArray(target.afterDeclarations, source.afterDeclarations),
  };
}

export function isIncrementalCompilation(options: ts.CompilerOptions): boolean {
  return !!(options.incremental || options.composite);
}
