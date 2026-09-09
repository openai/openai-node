import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { create } from 'ts-node';

/** Compile a subprocess fixture once while retaining the repository's ts-node/SWC settings. */
export function compileTestScript(source: string) {
  const root = process.cwd();
  const compiler = create({ project: path.join(root, 'tsconfig.json'), swc: true });
  const code = compiler.compile(readFileSync(source, 'utf-8'), source);
  // Keep normal Node dependency resolution without inheriting NODE_PATH or installing another package.
  const directory = mkdtempSync(path.join(root, 'node_modules/.test-script-'));
  const file = path.join(directory, `${path.basename(source, '.ts')}.cjs`);
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    writeFileSync(file, code);
    return { file, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
