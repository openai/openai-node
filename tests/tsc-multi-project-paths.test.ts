import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const cli = path.join(repoRoot, 'scripts/_vendor/tsc-multi/src/cli.ts');
const register = createRequire(path.join(repoRoot, 'package.json')).resolve(
  'ts-node/register/transpile-only',
);

describe('tsc-multi project path resolution', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-tsc-project-paths-'));
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function createProject(relative: string, marker: string) {
    const project = path.join(fixture, relative);
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(
      path.join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2020',
          module: 'commonjs',
          rootDir: 'src',
          outDir: 'dist',
          types: [],
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    );
    writeFileSync(path.join(project, 'src/index.ts'), `export const selected = ${JSON.stringify(marker)};`);
    return path.join(project, 'dist/index.js');
  }

  function writeConfig(relative: string, projects: string[]) {
    const config = path.join(fixture, relative);
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ projects }));
  }

  function runCLI(args: string[] = []) {
    const result = spawnSync(process.execPath, ['--require', register, cli, '--maxWorkers', '1', ...args], {
      cwd: fixture,
      encoding: 'utf-8',
      timeout: 15_000,
      env: {
        ...process.env,
        TS_NODE_SKIP_PROJECT: 'true',
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
          esModuleInterop: true,
          module: 'commonjs',
          moduleResolution: 'bundler',
          target: 'es2020',
        }),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  }

  test.each(['selected', 'selected/tsconfig.json'])(
    'resolves nested config project %s relative to the config, not a same-name caller project',
    (project) => {
      const intended = createProject('nested/selected', 'INTENDED_NESTED_PROJECT');
      const decoy = createProject('selected', 'WRONG_CALLER_DIRECTORY_PROJECT');
      writeConfig('nested/tsc-multi.json', [project]);

      runCLI(['--config', 'nested/tsc-multi.json']);

      expect({ intended: existsSync(intended), decoy: existsSync(decoy) }).toEqual({
        intended: true,
        decoy: false,
      });
      expect(readFileSync(intended, 'utf-8')).toContain('INTENDED_NESTED_PROJECT');
    },
  );

  test('builds projects from the default config alongside the caller', () => {
    const output = createProject('selected', 'DEFAULT_CONFIG_PROJECT');
    writeConfig('tsc-multi.json', ['selected']);

    runCLI();

    expect(readFileSync(output, 'utf-8')).toContain('DEFAULT_CONFIG_PROJECT');
  });

  test('resolves positional projects from the caller and lets them override nested config projects', () => {
    const configured = createProject('nested/configured', 'CONFIGURED_PROJECT');
    const positional = createProject('override', 'POSITIONAL_PROJECT');
    writeConfig('nested/tsc-multi.json', ['configured']);

    runCLI(['--config', 'nested/tsc-multi.json', 'override']);

    expect(readFileSync(positional, 'utf-8')).toContain('POSITIONAL_PROJECT');
    expect(existsSync(configured)).toBe(false);
  });
});
