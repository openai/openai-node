import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const protectedMainCondition =
  "github.repository == 'openai/openai-node' && github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'dependabot[bot]'";

function normalizeLineEndings(value: string) {
  return value.split(/\r\n?/u).join('\n');
}

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

function workflowJob(workflow: string, name: string) {
  const normalizedWorkflow = normalizeLineEndings(workflow);
  return normalizedWorkflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z_]+:\n/u)[0] ?? '';
}

function workflowCondition(job: string) {
  return job
    .split('    if: >-\n')[1]
    ?.split('\n    environment:')[0]
    ?.split('\n')
    .slice(1, -1)
    .map((line) => line.trim())
    .join(' ');
}

function writeSuccessfulNpmStub(bin: string) {
  const filename = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const contents = process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n';
  writeFileSync(path.join(bin, filename), contents, { mode: 0o755 });
}

describe('ecosystem test CLI', () => {
  test('limits live examples and ecosystem credentials to protected main pushes', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8');
    const liveJob = workflowJob(workflow, 'examples');
    const ecosystemJob = workflowJob(workflow, 'ecosystem_tests');

    expect(workflowCondition(liveJob)).toBe(protectedMainCondition);
    expect(liveJob).toContain('\n    environment: ci\n');
    expect(liveJob).toContain('pnpm tsn examples/chat-completions/demo.ts');
    expect(liveJob).toContain(
      'pnpm tsn ecosystem-tests/cli.ts --live --verbose --parallel --jobs=4 --retry=3',
    );
    expect(liveJob.match(/secrets\.OPENAI_API_KEY/gu)).toHaveLength(1);

    expect(ecosystemJob).toContain('pnpm tsn ecosystem-tests/cli.ts --verbose --parallel --jobs=4 --retry=3');
    expect(ecosystemJob).not.toContain('--live');
    expect(ecosystemJob).not.toContain('OPENAI_API_KEY');
    expect(ecosystemJob).not.toContain('environment: ci');
    expect(workflow.match(/secrets\.OPENAI_API_KEY/gu)).toHaveLength(1);
  });

  test('reads protected workflow conditions from CRLF checkouts', () => {
    const workflow = normalizeLineEndings(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8'))
      .split('\n')
      .join('\r\n');

    expect(workflowCondition(workflowJob(workflow, 'examples'))).toBe(protectedMainCondition);
  });

  test.each([
    ['protected main push', 'push', 'refs/heads/main', 'octocat', 'openai/openai-node', true],
    ['Dependabot push to main', 'push', 'refs/heads/main', 'dependabot[bot]', 'openai/openai-node', false],
    [
      'unprotected same-repository branch push',
      'push',
      'refs/heads/feature',
      'octocat',
      'openai/openai-node',
      false,
    ],
    [
      'same-repository pull request',
      'pull_request',
      'refs/pull/42/merge',
      'octocat',
      'openai/openai-node',
      false,
    ],
    ['fork pull request', 'pull_request', 'refs/pull/43/merge', 'octocat', 'openai/openai-node', false],
    [
      'merge group',
      'merge_group',
      'refs/heads/gh-readonly-queue/main/pr-42',
      'octocat',
      'openai/openai-node',
      false,
    ],
    ['workflow dispatch', 'workflow_dispatch', 'refs/heads/main', 'octocat', 'openai/openai-node', false],
    ['different repository main push', 'push', 'refs/heads/main', 'octocat', 'octocat/openai-node', false],
  ])(
    'runs credential-free ecosystem checks and gates live checks for a %s',
    (_event, eventName, ref, actor, repository, trusted) => {
      const live =
        repository === 'openai/openai-node' &&
        eventName === 'push' &&
        ref === 'refs/heads/main' &&
        actor !== 'dependabot[bot]';

      expect({ credentialFree: true, live }).toEqual({ credentialFree: true, live: trusted });
    },
  );

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

  test.each([
    {
      projectName: 'node-ts-cjs',
      option: '--live',
      phase: 'live-test',
      scripts: { tsc: 'node observe.cjs typecheck', test: 'node observe.cjs live-test' },
    },
    {
      projectName: 'cloudflare-worker',
      option: '--deploy',
      phase: 'deploy',
      scripts: { tsc: 'node observe.cjs typecheck', deploy: 'node observe.cjs deploy' },
    },
  ])(
    'provides API credentials only to the $phase ecosystem command',
    ({ projectName, option, phase, scripts }) => {
      const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));
      const project = path.join(fixture, 'ecosystem-tests', projectName);
      const dependency = path.join(fixture, 'local-dependency');
      const observations = path.join(fixture, 'observations.jsonl');
      const apiKey = 'synthetic-ecosystem-test-key';
      const observe = [
        "const fs = require('node:fs');",
        'const observation = { phase: process.argv[2], apiKey: process.env.OPENAI_API_KEY ?? null };',
        "fs.appendFileSync(process.env.ECOSYSTEM_COMMAND_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
      ].join('\n');

      try {
        mkdirSync(project, { recursive: true });
        mkdirSync(dependency);
        writeFileSync(path.join(fixture, 'package.json'), '{}\n');
        writeFileSync(
          path.join(project, 'package.json'),
          JSON.stringify({
            name: 'ecosystem-project',
            private: true,
            scripts,
          }),
        );
        writeFileSync(path.join(project, 'observe.cjs'), observe);
        writeFileSync(
          path.join(dependency, 'package.json'),
          JSON.stringify({
            name: 'openai',
            version: '0.0.0',
            scripts: { postinstall: 'node observe.cjs install' },
          }),
        );
        writeFileSync(path.join(dependency, 'observe.cjs'), observe);

        const result = runCli(
          [projectName, `--fromNpm=${dependency}`, '--skipPack', '--noCleanup', option],
          fixture,
          {
            OPENAI_API_KEY: apiKey,
            ECOSYSTEM_COMMAND_OBSERVATIONS: observations,
            npm_config_audit: 'false',
            npm_config_fund: 'false',
            npm_config_offline: 'true',
            npm_config_package_lock: 'false',
          },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(
          readFileSync(observations, 'utf-8')
            .trim()
            .split('\n')
            .map((observation) => JSON.parse(observation)),
        ).toEqual([
          { phase: 'install', apiKey: null },
          { phase: 'typecheck', apiKey: null },
          { phase, apiKey },
        ]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

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
      name: 'preserves existing Cloudflare credentials in non-live mode with an API key',
      existingVars: existingCloudflareDevVars,
      apiKey: 'test-api-key',
      expectedVars: existingCloudflareDevVars,
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
      writeSuccessfulNpmStub(bin);

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
