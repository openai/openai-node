import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import glob from 'fast-glob';
import { create } from 'ts-node';
import type { TestProject } from 'vitest/node';

/** Prepare one transpiled source snapshot for fresh-process example and CLI tests. */
export default function setup(project: TestProject) {
  const root = process.cwd();
  // The location retains normal resolution of this checkout's installed dependencies.
  const directory = mkdtempSync(path.join(root, 'node_modules/.test-fixtures-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    const compiler = create({ project: path.join(root, 'tsconfig.json'), swc: true });
    const sources = glob.sync(['src/**/*.ts', 'src/**/*.cts', 'examples/**/*.ts', 'ecosystem-tests/cli.ts'], {
      cwd: root,
      ignore: ['**/node_modules/**', '**/*.d.ts'],
    });
    for (const source of sources) {
      const filename = path.join(root, source);
      const output = path.join(directory, source.replace(/\.(?:c)?ts$/u, '.js'));
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, compiler.compile(readFileSync(filename, 'utf-8'), filename));
    }
    // Preserve private package-import routing using the same metadata projection as the SDK build.
    writeFileSync(
      path.join(directory, 'src/package.json'),
      execFileSync(process.execPath, ['scripts/utils/make-dist-package-json.cjs'], {
        cwd: root,
        env: { ...process.env, PKG_JSON_PATH: path.join(root, 'package.json') },
      }),
    );
    const config = JSON.parse(readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
    config.compilerOptions.paths = {
      openai: [path.join(directory, 'src/index.js')],
      'openai/*': [path.join(directory, 'src/*')],
    };
    writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify(config));
    project.provide('compiledFixtures', directory);
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
