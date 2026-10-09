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

function expectOutput(output: string, content: string) {
  expect(readFileSync(output, 'utf-8')).toContain(content);
  expect(JSON.parse(readFileSync(`${output}.map`, 'utf-8'))).toHaveProperty('version', 3);
}

describe('tsc-multi transpile-only status', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-tsc-transpile-status-'));
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function createProject(name: string, source: string, withConfig = true) {
    const project = path.join(fixture, name);
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(path.join(project, 'src/index.ts'), source);
    if (withConfig) {
      writeFileSync(
        path.join(project, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            rootDir: 'src',
            outDir: 'dist',
            sourceMap: true,
            types: [],
            skipLibCheck: true,
          },
          include: ['src/**/*.ts'],
        }),
      );
    }
    return path.join(project, 'dist/index.js');
  }

  function runCLI(projects: string[]) {
    writeFileSync(
      path.join(fixture, 'tsc-multi.json'),
      JSON.stringify({ projects, targets: [{ transpileOnly: true }] }),
    );
    const result = spawnSync(process.execPath, ['--require', register, cli, '--maxWorkers', '1'], {
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
    return result;
  }

  test.each([
    {
      name: 'a syntax error',
      source: 'export const value = ;',
      output: 'exports.value = ;',
      status: 1,
      diagnostic: 'TS1109',
    },
    {
      name: 'valid source',
      source: 'export const value: number = 1;',
      output: 'exports.value = 1;',
      status: 0,
      diagnostic: undefined,
    },
    {
      name: 'a semantic-only type error',
      source: "export const value: number = 'not-a-number';",
      output: "exports.value = 'not-a-number';",
      status: 0,
      diagnostic: undefined,
    },
  ])('returns $status for $name without changing emitted files', ({ source, output, status, diagnostic }) => {
    const emitted = createProject('project', source);

    const result = runCLI(['project']);

    expectOutput(emitted, output);
    if (diagnostic) {
      expect(result.stderr).toContain(diagnostic);
    } else {
      expect(result.stderr).not.toMatch(/TS\d+:/u);
    }
    const syntax = spawnSync(process.execPath, ['--check', emitted], { encoding: 'utf-8', timeout: 5000 });
    expect(syntax.error).toBeUndefined();
    expect(syntax.status).toBe(status);
    expect(result.status).toBe(status);
  });

  test('preserves failure status while still emitting a later valid project', () => {
    const first = createProject('first', 'export const value = ;');
    const later = createProject('later', 'export const value = 42;');

    const result = runCLI(['first', 'later']);

    expectOutput(first, 'exports.value = ;');
    expectOutput(later, 'exports.value = 42;');
    expect(result.stderr).toContain('TS1109');
    expect(result.status).toBe(1);
  });

  test('fails when a selected project reports an unreadable tsconfig', () => {
    const output = createProject('missing-config', 'export const value = 1;', false);

    const result = runCLI(['missing-config']);

    expect(result.stderr).toContain('TS5083');
    expect(existsSync(output)).toBe(false);
    expect(result.status).toBe(1);
  });
});
