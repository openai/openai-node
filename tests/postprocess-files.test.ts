import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sourceScript = path.resolve('scripts/utils/postprocess-files.cjs');

test.each([
  'absolute override',
  'relative override',
  'script-relative default',
  'missing cwd dist',
  'missing selected package',
  'canonical default',
] as const)('postprocesses only the selected output with %s', async (scenario) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-postprocess-'));
  const project = path.join(directory, 'project space');
  const canonical = scenario === 'canonical default';
  const cwd = canonical ? project : path.join(directory, 'caller space');
  const override = scenario !== 'script-relative default' && !canonical;
  const dist = path.join(project, override ? 'alternate dist' : 'dist');
  const script = path.join(project, 'scripts/utils/postprocess-files.cjs');
  const unrelatedPackage = path.join(cwd, 'dist/package.json');
  const unrelatedBytes = '{"name":"unrelated-package","exports":{"./untouched":"./untouched.js"}}\n';
  const hasUnrelatedPackage = !canonical && scenario !== 'missing cwd dist';
  const reference = '/// <reference lib="dom" />';
  const declaration = 'export declare const value: string;\n';
  const canonicalState =
    '"use strict";\nexports.state = {};\n//# sourceMappingURL=x509-transport-state.cjs.map\n';
  const sourceMap = '{"version":3,"sources":["src/index.ts"],"names":[],"mappings":""}\n';
  const source = 'export const value = "synthetic source";\n';

  try {
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await copyFile(sourceScript, script);
    const files = {
      'package.json': JSON.stringify({
        name: 'synthetic-target',
        version: '0.0.0',
        custom: { preserved: true },
        exports: { './stale': './stale.js' },
      }),
      'index.js': "const state = require('#x509-transport-state');\n//# sourceMappingURL=index.js.map\n",
      'index.mjs': "import state from '#x509-transport-state';\n//# sourceMappingURL=index.mjs.map\n",
      'index.d.ts': `${reference}\n${declaration}`,
      'index.js.map': sourceMap,
      'src/index.ts': source,
      'internal/auth/x509-transport-state.cjs': canonicalState,
    };
    await Promise.all(
      Object.entries(files).map(async ([file, contents]) => {
        if (file === 'package.json' && scenario === 'missing selected package') {
          return;
        }
        const target = path.join(dist, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }),
    );
    if (hasUnrelatedPackage) {
      await mkdir(path.dirname(unrelatedPackage), { recursive: true });
      await writeFile(unrelatedPackage, unrelatedBytes);
    }

    const distPath = scenario === 'relative override' ? path.relative(cwd, dist) : dist;
    const postprocess = execute(process.execPath, [script], {
      cwd,
      env: {
        CI: 'true',
        SystemRoot: process.env['SystemRoot'],
        ...(override ? { DIST_PATH: distPath } : {}),
      },
      timeout: 15_000,
    });
    if (scenario === 'missing selected package') {
      await expect(postprocess).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('ENOENT'),
      });
      expect(await readFile(unrelatedPackage, 'utf-8')).toBe(unrelatedBytes);
      return;
    }
    await postprocess;

    const manifest = JSON.parse(await readFile(path.join(dist, 'package.json'), 'utf-8'));
    expect(manifest).toMatchObject({
      name: 'synthetic-target',
      version: '0.0.0',
      custom: { preserved: true },
    });
    expect(manifest.exports['.']).toEqual({
      require: { types: './index.d.ts', default: './index.js' },
      types: './index.d.mts',
      default: './index.mjs',
    });
    expect(manifest.exports['./index']).toEqual({ import: './index.mjs', require: './index.js' });
    expect(manifest.exports['./stale']).toBeUndefined();
    expect(manifest.exports['./internal/*']).toBeUndefined();
    expect(manifest.exports['./src/*']).toBeUndefined();
    if (hasUnrelatedPackage) {
      expect(await readFile(unrelatedPackage, 'utf-8')).toBe(unrelatedBytes);
    }
    expect(await readFile(path.join(dist, 'index.js'), 'utf-8')).toBe(
      "const state = require('./internal/auth/x509-transport-state.js');\n//# sourceMappingURL=index.js.map\n",
    );
    expect(await readFile(path.join(dist, 'index.mjs'), 'utf-8')).toBe(
      "import state from './internal/auth/x509-transport-state.mjs';\n//# sourceMappingURL=index.mjs.map\n",
    );
    expect(await readFile(path.join(dist, 'index.d.ts'), 'utf-8')).toBe(
      `${' '.repeat(reference.length)}\n${declaration}`,
    );
    expect(await readFile(path.join(dist, 'index.js.map'), 'utf-8')).toBe(sourceMap);
    expect(await readFile(path.join(dist, 'src/index.ts'), 'utf-8')).toBe(source);
    expect(await readFile(path.join(dist, 'internal/auth/x509-transport-state.cjs'), 'utf-8')).toBe(
      canonicalState,
    );
    expect(await readFile(script)).toEqual(await readFile(sourceScript));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
