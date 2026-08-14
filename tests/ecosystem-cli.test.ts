import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();

function runCli(args: string[], cwd = root, env: Partial<NodeJS.ProcessEnv> = {}) {
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
        ...env,
      },
      timeout: 15_000,
    },
  );
}

function workflowCondition(step: string) {
  return step
    .split('        if: >-\n')[1]
    ?.split('\n        run:')[0]
    ?.split('\n')
    .slice(1, -1)
    .map((line) => line.trim())
    .join(' ');
}

describe('ecosystem test CLI', () => {
  test('limits live ecosystem CI and credentials to trusted events', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8');
    const ecosystemJob = workflow.split('\n  ecosystem_tests:\n')[1] ?? '';
    const steps = ecosystemJob.split('\n      - name: ');
    const liveStep =
      steps.find((step) => step.startsWith('Run ecosystem tests with live credentials\n')) ?? '';
    const nonLiveStep =
      steps.find((step) => step.startsWith('Run ecosystem tests without live credentials\n')) ?? '';

    expect(workflowCondition(liveStep)).toBe(
      "github.actor != 'dependabot[bot]' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)",
    );
    expect(liveStep).toContain(
      'pnpm tsn ecosystem-tests/cli.ts --live --verbose --parallel --jobs=4 --retry=3',
    );
    expect(liveStep).toContain('OPENAI_API_KEY:');
    expect(liveStep).toContain('secrets.OPENAI_API_KEY');

    expect(workflowCondition(nonLiveStep)).toBe(
      "github.actor == 'dependabot[bot]' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository)",
    );
    expect(nonLiveStep).toContain('pnpm tsn ecosystem-tests/cli.ts --verbose --parallel --jobs=4 --retry=3');
    expect(nonLiveStep).not.toContain('--live');
    expect(nonLiveStep).not.toContain('OPENAI_API_KEY');
    expect(ecosystemJob.split('OPENAI_API_KEY:')).toHaveLength(2);
  });

  test.each([
    ['Dependabot push', 'dependabot[bot]', 'push', undefined, false],
    ['Dependabot pull request', 'dependabot[bot]', 'pull_request', 'openai/openai-node', false],
    ['human push', 'octocat', 'push', undefined, true],
    ['merge group', 'octocat', 'merge_group', undefined, true],
    ['workflow dispatch', 'octocat', 'workflow_dispatch', undefined, true],
    ['same-repository pull request', 'octocat', 'pull_request', 'openai/openai-node', true],
    ['fork pull request', 'octocat', 'pull_request', 'octocat/openai-node', false],
    ['pull request with a missing head', 'octocat', 'pull_request', undefined, false],
  ])('selects exactly one ecosystem mode for a %s', (_event, actor, eventName, headRepository, trusted) => {
    const repository = 'openai/openai-node';
    const keyless =
      actor === 'dependabot[bot]' || (eventName === 'pull_request' && headRepository !== repository);
    const live =
      actor !== 'dependabot[bot]' && (eventName !== 'pull_request' || headRepository === repository);

    expect({ keyless, live }).toEqual({ keyless: !trusted, live: trusted });
    expect([keyless, live].filter(Boolean)).toHaveLength(1);
  });

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

  const existingCloudflareDevVars = "OPENAI_API_KEY='existing-test-secret'\nANOTHER_VAR='keep-me'\n";

  test.each([
    {
      name: 'preserves existing Cloudflare credentials without an API key',
      existingVars: existingCloudflareDevVars,
      apiKey: undefined,
      expectedVars: existingCloudflareDevVars,
    },
    {
      name: 'does not create Cloudflare credentials without an API key',
      existingVars: undefined,
      apiKey: undefined,
      expectedVars: undefined,
    },
    {
      name: 'preserves existing Cloudflare credentials when the API key is empty',
      existingVars: existingCloudflareDevVars,
      apiKey: '',
      expectedVars: existingCloudflareDevVars,
    },
    {
      name: 'updates Cloudflare credentials when an API key is available',
      existingVars: existingCloudflareDevVars,
      apiKey: 'test-api-key',
      expectedVars: "OPENAI_API_KEY='test-api-key'",
    },
  ])('$name', ({ existingVars, apiKey, expectedVars }) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));
    const worker = path.join(fixture, 'ecosystem-tests', 'cloudflare-worker');
    const bin = path.join(fixture, 'bin');
    const devVars = path.join(worker, '.dev.vars');

    try {
      mkdirSync(worker, { recursive: true });
      mkdirSync(bin);
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');
      writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      if (existingVars !== undefined) {
        writeFileSync(devVars, existingVars);
      }

      const result = runCli(['cloudflare-worker', '--fromNpm=openai', '--skipPack', '--noCleanup'], fixture, {
        PATH: bin,
        OPENAI_API_KEY: apiKey,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);

      if (expectedVars === undefined) {
        expect(existsSync(devVars)).toBe(false);
      } else {
        const actualVars = readFileSync(devVars, 'utf-8');
        expect(actualVars).toBe(expectedVars);
        expect(actualVars).not.toContain('undefined');
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
