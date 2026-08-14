import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();

function runCli(args: string[], cwd = root) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'ecosystem-tests/cli.ts'),
      ...args,
    ],
    {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OPENAI_API_KEY: undefined,
        DISABLE_V8_COMPILE_CACHE: '1',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
      },
      timeout: 15_000,
    },
  );
}

describe('ecosystem test CLI', () => {
  test.each(['--live', '--deploy'])('rejects keyless %s before running projects', (option) => {
    const result = runCli([option]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPENAI_API_KEY');
    expect(result.stderr).not.toContain('running projects:');
    expect(result.stdout).not.toContain('[run]:');
  });

  test('shows help without credentials', () => {
    const result = runCli(['--help']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('run tests using various different project setups');
    expect(result.stdout).toContain('--live');
    expect(result.stderr).not.toContain('OPENAI_API_KEY');
  });

  test('permits bounded keyless non-live project checks', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));

    try {
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');

      const result = runCli(['node-ts-cjs', '--skip=node-ts-cjs', '--skipPack', '--noCleanup'], fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('running projects:');
      expect(result.stderr).not.toContain('▶️');
      expect(result.stderr).not.toContain('OPENAI_API_KEY');
      expect(result.stdout).not.toContain('[run]:');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
